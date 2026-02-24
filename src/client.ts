import type { PublicClient, WalletClient, Address, Hex } from 'viem'
import type {
  AxonClientConfig,
  BotConfig,
  PayInput,
  PaymentIntent,
  PaymentResult,
} from './types.js'
import { signPayment, encodeRef } from './signer.js'
import { getBotConfig, createAxonPublicClient, createAxonWalletClient } from './vault.js'
import { DEFAULT_DEADLINE_SECONDS, RELAYER_API } from './constants.js'

// ============================================================================
// AxonClient
// ============================================================================

/**
 * Main entry point for bots interacting with Axon.
 *
 * Handles EIP-712 signing, on-chain reads, and relayer API communication.
 * Bots never submit transactions directly — they sign intents and the relayer
 * handles all on-chain execution.
 *
 * @example
 * ```ts
 * import { AxonClient, USDC } from '@axon/sdk'
 *
 * const client = new AxonClient({
 *   vaultAddress: '0x...',
 *   chainId: 84532,           // Base Sepolia
 *   botPrivateKey: '0x...',
 *   relayerUrl: 'https://relay.axon.xyz',
 *   rpcUrl: 'https://sepolia.base.org',
 * })
 *
 * const result = await client.pay({
 *   to: '0x...recipient...',
 *   token: USDC[84532],
 *   amount: 5_000_000n,       // 5 USDC
 *   memo: 'API call #1234 — weather data',
 * })
 *
 * console.log(result.status, result.txHash)
 * ```
 */
export class AxonClient {
  private readonly vaultAddress: Address
  private readonly chainId: number
  private readonly relayerUrl: string
  private readonly publicClient: PublicClient
  private readonly walletClient: WalletClient

  constructor(config: AxonClientConfig) {
    this.vaultAddress = config.vaultAddress
    this.chainId = config.chainId
    this.relayerUrl = config.relayerUrl.replace(/\/$/, '') // strip trailing slash

    this.publicClient = createAxonPublicClient(config.chainId, config.rpcUrl)

    if (!config.botPrivateKey) {
      throw new Error('botPrivateKey is required in AxonClientConfig')
    }
    this.walletClient = createAxonWalletClient(
      config.botPrivateKey,
      config.chainId,
      config.rpcUrl,
    )
  }

  // ============================================================================
  // Bot address
  // ============================================================================

  /** Returns the bot's address derived from the configured private key. */
  get botAddress(): Address {
    const account = this.walletClient.account
    if (!account) throw new Error('No account on walletClient')
    return account.address
  }

  // ============================================================================
  // pay()
  // ============================================================================

  /**
   * Create, sign, and submit a payment intent to the Axon relayer.
   *
   * The SDK:
   * 1. Builds the PaymentIntent struct (filling in bot address, deadline, ref)
   * 2. Signs it with EIP-712 (bot private key)
   * 3. POSTs to POST /v1/payments on the relayer
   * 4. Returns the relayer's response
   *
   * Three possible outcomes (all included in PaymentResult.status):
   * - `"approved"`: fast path — txHash available immediately
   * - `"pending_review"`: AI scan or human review in progress — poll or await webhook
   * - `"rejected"`: payment was rejected — reason field explains why
   */
  async pay(input: PayInput): Promise<PaymentResult> {
    const intent = this._buildIntent(input)
    const signature = await signPayment(
      this.walletClient,
      this.vaultAddress,
      this.chainId,
      intent,
    )
    return this._submitToRelayer(intent, signature, input)
  }

  // ============================================================================
  // getBotConfig()
  // ============================================================================

  /**
   * Read this bot's current configuration from the vault on-chain.
   * Returns the full BotConfig including spending limits and AI thresholds.
   */
  async getBotConfig(): Promise<BotConfig> {
    return getBotConfig(this.publicClient, this.vaultAddress, this.botAddress)
  }

  // ============================================================================
  // poll()
  // ============================================================================

  /**
   * Poll the relayer for the status of an async payment.
   *
   * Use this when pay() returns `status: "pending_review"`. Poll until
   * status is `"approved"` or `"rejected"`. Alternatively, register a
   * `webhookUrl` in pay() to receive push notification instead.
   *
   * Recommended polling interval: 5–10 seconds.
   */
  async poll(requestId: string): Promise<PaymentResult> {
    const url = `${this.relayerUrl}${RELAYER_API.payment(requestId)}`
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Relayer poll failed [${response.status}]: ${body}`)
    }

    return response.json() as Promise<PaymentResult>
  }

  // ============================================================================
  // signPayment() — low-level access
  // ============================================================================

  /**
   * Sign a PaymentIntent directly without submitting to the relayer.
   *
   * Use this if you want to build the intent yourself and pass the signature
   * to another system (e.g. a custom relayer integration).
   */
  async signPayment(intent: PaymentIntent): Promise<Hex> {
    return signPayment(this.walletClient, this.vaultAddress, this.chainId, intent)
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  private _buildIntent(input: PayInput): PaymentIntent {
    const deadline =
      input.deadline ?? BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS)

    let ref: Hex
    if (input.ref) {
      ref = input.ref
    } else if (input.memo) {
      ref = encodeRef(input.memo)
    } else {
      ref = '0x0000000000000000000000000000000000000000000000000000000000000000'
    }

    return {
      bot: this.botAddress,
      to: input.to,
      token: input.token,
      amount: input.amount,
      deadline,
      ref,
    }
  }

  private async _submitToRelayer(
    intent: PaymentIntent,
    signature: Hex,
    input: PayInput,
  ): Promise<PaymentResult> {
    const url = `${this.relayerUrl}${RELAYER_API.PAYMENTS}`

    const idempotencyKey = input.idempotencyKey ?? generateUuid()

    const body = {
      // Routing — tells relayer which chain and vault to use
      chainId: this.chainId,
      vaultAddress: this.vaultAddress,

      // Signed intent
      intent: {
        bot: intent.bot,
        to: intent.to,
        token: intent.token,
        amount: intent.amount.toString(), // JSON can't handle bigint
        deadline: intent.deadline.toString(),
        ref: intent.ref,
      },
      signature,

      // Off-chain metadata (not signed, stored in relayer PostgreSQL)
      idempotencyKey,
      ...(input.memo !== undefined && { memo: input.memo }),
      ...(input.resourceUrl !== undefined && { resourceUrl: input.resourceUrl }),
      ...(input.invoiceId !== undefined && { invoiceId: input.invoiceId }),
      ...(input.orderId !== undefined && { orderId: input.orderId }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const responseBody = await response.text()
      throw new Error(`Relayer request failed [${response.status}]: ${responseBody}`)
    }

    return response.json() as Promise<PaymentResult>
  }
}

// ============================================================================
// Tiny UUID v4 generator (no external dependency)
// ============================================================================

function generateUuid(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    // Node.js fallback
    const { randomBytes } = require('crypto') as typeof import('crypto')
    const buf = randomBytes(16)
    for (let i = 0; i < 16; i++) bytes[i] = buf[i] ?? 0
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // variant bits
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
