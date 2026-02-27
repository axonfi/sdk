import type { WalletClient, Address, Hex } from 'viem';
import type {
  AxonClientConfig,
  PayInput,
  PaymentIntent,
  PaymentResult,
  ExecuteInput,
  ExecuteIntent,
  SwapInput,
  SwapIntent,
  VaultInfo,
  DestinationCheckResult,
} from './types.js';
import { signPayment, signExecuteIntent, signSwapIntent, encodeRef } from './signer.js';
import { createAxonWalletClient } from './vault.js';
import { DEFAULT_DEADLINE_SECONDS, RELAYER_API } from './constants.js';
import { generateUuid } from './utils.js';
import { keccak256 } from 'viem';

// ============================================================================
// AxonClient
// ============================================================================

/**
 * Main entry point for bots interacting with Axon.
 *
 * Handles EIP-712 signing, relayer communication, and status polling.
 * Bots never submit transactions directly — they sign intents and the relayer
 * handles all on-chain execution.
 *
 * All chain reads (balances, bot status, vault info) go through the relayer
 * API — bots never need an RPC endpoint.
 *
 * @example
 * ```ts
 * import { AxonClient, USDC } from '@axon/sdk'
 *
 * const client = new AxonClient({
 *   vaultAddress: '0x...',
 *   chainId: 84532,           // Base Sepolia
 *   botPrivateKey: '0x...',
 *   relayerUrl: 'https://relay.axonfi.xyz',
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
  private readonly vaultAddress: Address;
  private readonly chainId: number;
  private readonly relayerUrl: string;
  private readonly walletClient: WalletClient;

  constructor(config: AxonClientConfig) {
    this.vaultAddress = config.vaultAddress;
    this.chainId = config.chainId;
    this.relayerUrl = config.relayerUrl.replace(/\/$/, ''); // strip trailing slash

    if (!config.botPrivateKey) {
      throw new Error('botPrivateKey is required in AxonClientConfig');
    }
    this.walletClient = createAxonWalletClient(config.botPrivateKey, config.chainId);
  }

  // ============================================================================
  // Bot address
  // ============================================================================

  /** Returns the bot's address derived from the configured private key. */
  get botAddress(): Address {
    const account = this.walletClient.account;
    if (!account) throw new Error('No account on walletClient');
    return account.address;
  }

  // ============================================================================
  // pay()
  // ============================================================================

  /**
   * Create, sign, and submit a payment intent to the Axon relayer.
   *
   * Three possible outcomes (all included in PaymentResult.status):
   * - `"approved"`: fast path — txHash available immediately
   * - `"pending_review"`: AI scan or human review in progress — poll for status
   * - `"rejected"`: payment was rejected — reason field explains why
   */
  async pay(input: PayInput): Promise<PaymentResult> {
    const intent = this._buildPaymentIntent(input);
    const signature = await signPayment(this.walletClient, this.vaultAddress, this.chainId, intent);
    return this._submitPayment(intent, signature, input);
  }

  // ============================================================================
  // execute()
  // ============================================================================

  /**
   * Sign and submit a DeFi protocol execution to the Axon relayer.
   *
   * The vault approves `token` to `protocol`, calls it with `callData`,
   * then revokes the approval. Tokens stay in the vault or go to the protocol
   * as specified by the calldata.
   */
  async execute(input: ExecuteInput): Promise<PaymentResult> {
    const intent = this._buildExecuteIntent(input);
    const signature = await signExecuteIntent(this.walletClient, this.vaultAddress, this.chainId, intent);
    return this._submitExecute(intent, signature, input);
  }

  // ============================================================================
  // swap()
  // ============================================================================

  /**
   * Sign and submit an in-vault token swap to the Axon relayer.
   *
   * Swaps tokens within the vault (no external recipient). Useful for
   * rebalancing vault holdings.
   */
  async swap(input: SwapInput): Promise<PaymentResult> {
    const intent = this._buildSwapIntent(input);
    const signature = await signSwapIntent(this.walletClient, this.vaultAddress, this.chainId, intent);
    return this._submitSwap(intent, signature, input);
  }

  // ============================================================================
  // getBalance() — via relayer
  // ============================================================================

  /** Read the vault's ERC-20 balance for a given token (via relayer). */
  async getBalance(token: Address): Promise<bigint> {
    const path = RELAYER_API.vaultBalance(this.vaultAddress, token, this.chainId);
    const data = await this._get(path);
    return BigInt(data.balance);
  }

  // ============================================================================
  // getBalances() — via relayer
  // ============================================================================

  /**
   * Read the vault's ERC-20 balances for multiple tokens in a single call (via relayer).
   * Returns a record mapping token address → balance.
   */
  async getBalances(tokens: Address[]): Promise<Record<Address, bigint>> {
    const path = RELAYER_API.vaultBalances(this.vaultAddress, this.chainId);
    const url = `${this.relayerUrl}${path}?chainId=${this.chainId}&tokens=${tokens.join(',')}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Relayer request failed [${response.status}]: ${body}`);
    }

    const data = (await response.json()) as { balances: Record<string, string> };
    const result: Record<Address, bigint> = {};
    for (const [addr, val] of Object.entries(data.balances)) {
      result[addr as Address] = BigInt(val);
    }
    return result;
  }

  // ============================================================================
  // isActive() — via relayer
  // ============================================================================

  /** Returns whether this bot is registered and active in the vault (via relayer). */
  async isActive(): Promise<boolean> {
    const path = RELAYER_API.botStatus(this.vaultAddress, this.botAddress, this.chainId);
    const data = await this._get(path);
    return data.isActive;
  }

  // ============================================================================
  // isPaused() — via relayer
  // ============================================================================

  /** Returns whether the vault is currently paused (via relayer). */
  async isPaused(): Promise<boolean> {
    const path = RELAYER_API.vaultInfo(this.vaultAddress, this.chainId);
    const data = await this._get(path);
    return data.paused;
  }

  // ============================================================================
  // getVaultInfo() — via relayer
  // ============================================================================

  /** Returns high-level vault info (owner, operator, paused, version, trackUsedIntents) via relayer. */
  async getVaultInfo(): Promise<VaultInfo> {
    const path = RELAYER_API.vaultInfo(this.vaultAddress, this.chainId);
    return this._get(path) as Promise<VaultInfo>;
  }

  // ============================================================================
  // canPayTo() — via relayer
  // ============================================================================

  /**
   * Check whether this bot can pay to a given destination address (via relayer).
   * Checks blacklist → global whitelist → bot whitelist, matching on-chain logic.
   */
  async canPayTo(destination: Address): Promise<DestinationCheckResult> {
    const path = RELAYER_API.destinationCheck(this.vaultAddress, this.botAddress, destination, this.chainId);
    return this._get(path) as Promise<DestinationCheckResult>;
  }

  // ============================================================================
  // isProtocolApproved() — via relayer
  // ============================================================================

  /** Returns whether a protocol address is approved for executeProtocol() calls (via relayer). */
  async isProtocolApproved(protocol: Address): Promise<boolean> {
    const path = RELAYER_API.protocolCheck(this.vaultAddress, protocol, this.chainId);
    const data = await this._get(path);
    return data.approved;
  }

  // ============================================================================
  // poll() / pollExecute() / pollSwap()
  // ============================================================================

  /**
   * Poll the relayer for the status of an async payment.
   *
   * Use this when pay() returns `status: "pending_review"`. Poll until
   * status is `"approved"` or `"rejected"`.
   *
   * Recommended polling interval: 5–10 seconds.
   */
  async poll(requestId: string): Promise<PaymentResult> {
    return this._get(RELAYER_API.payment(requestId)) as Promise<PaymentResult>;
  }

  /** Poll the relayer for the status of an async protocol execution. */
  async pollExecute(requestId: string): Promise<PaymentResult> {
    return this._get(RELAYER_API.execute(requestId)) as Promise<PaymentResult>;
  }

  /** Poll the relayer for the status of an async swap. */
  async pollSwap(requestId: string): Promise<PaymentResult> {
    return this._get(RELAYER_API.swap(requestId)) as Promise<PaymentResult>;
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
    return signPayment(this.walletClient, this.vaultAddress, this.chainId, intent);
  }

  // ============================================================================
  // Internal helpers
  // ============================================================================

  private async _get(path: string): Promise<any> {
    const url = `${this.relayerUrl}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Relayer request failed [${response.status}]: ${body}`);
    }

    return response.json();
  }

  private _defaultDeadline(): bigint {
    return BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SECONDS);
  }

  private _resolveRef(memo?: string, ref?: Hex): Hex {
    if (ref) return ref;
    if (memo) return encodeRef(memo);
    return '0x0000000000000000000000000000000000000000000000000000000000000000';
  }

  private _buildPaymentIntent(input: PayInput): PaymentIntent {
    return {
      bot: this.botAddress,
      to: input.to,
      token: input.token,
      amount: input.amount,
      deadline: input.deadline ?? this._defaultDeadline(),
      ref: this._resolveRef(input.memo, input.ref),
    };
  }

  private _buildExecuteIntent(input: ExecuteInput): ExecuteIntent {
    return {
      bot: this.botAddress,
      protocol: input.protocol,
      calldataHash: keccak256(input.callData),
      token: input.token,
      amount: input.amount,
      deadline: input.deadline ?? this._defaultDeadline(),
      ref: this._resolveRef(input.memo, input.ref),
    };
  }

  private _buildSwapIntent(input: SwapInput): SwapIntent {
    return {
      bot: this.botAddress,
      toToken: input.toToken,
      minToAmount: input.minToAmount,
      deadline: input.deadline ?? this._defaultDeadline(),
      ref: this._resolveRef(input.memo, input.ref),
    };
  }

  private async _submitPayment(intent: PaymentIntent, signature: Hex, input: PayInput): Promise<PaymentResult> {
    const idempotencyKey = input.idempotencyKey ?? generateUuid();

    const body = {
      // Routing
      chainId: this.chainId,
      vaultAddress: this.vaultAddress,

      // Flat intent fields (matches relayer DTO)
      bot: intent.bot,
      to: intent.to,
      token: intent.token,
      amount: intent.amount.toString(),
      deadline: intent.deadline.toString(),
      ref: intent.ref,
      signature,

      // Off-chain metadata
      idempotencyKey,
      ...(input.memo !== undefined && { memo: input.memo }),
      ...(input.resourceUrl !== undefined && { resourceUrl: input.resourceUrl }),
      ...(input.invoiceId !== undefined && { invoiceId: input.invoiceId }),
      ...(input.orderId !== undefined && { orderId: input.orderId }),
      ...(input.recipientLabel !== undefined && { recipientLabel: input.recipientLabel }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    };

    return this._post(RELAYER_API.PAYMENTS, idempotencyKey, body);
  }

  private async _submitExecute(intent: ExecuteIntent, signature: Hex, input: ExecuteInput): Promise<PaymentResult> {
    const idempotencyKey = input.idempotencyKey ?? generateUuid();

    const body = {
      chainId: this.chainId,
      vaultAddress: this.vaultAddress,

      // Flat intent fields
      bot: intent.bot,
      protocol: intent.protocol,
      calldataHash: intent.calldataHash,
      token: intent.token,
      amount: intent.amount.toString(),
      deadline: intent.deadline.toString(),
      ref: intent.ref,
      signature,

      // Protocol calldata
      callData: input.callData,

      // Optional pre-swap
      ...(input.fromToken !== undefined && { fromToken: input.fromToken }),
      ...(input.maxFromAmount !== undefined && { maxFromAmount: input.maxFromAmount.toString() }),

      // Off-chain metadata
      idempotencyKey,
      ...(input.memo !== undefined && { memo: input.memo }),
      ...(input.protocolName !== undefined && { protocolName: input.protocolName }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
    };

    return this._post(RELAYER_API.EXECUTE, idempotencyKey, body);
  }

  private async _submitSwap(intent: SwapIntent, signature: Hex, input: SwapInput): Promise<PaymentResult> {
    const idempotencyKey = input.idempotencyKey ?? generateUuid();

    const body = {
      chainId: this.chainId,
      vaultAddress: this.vaultAddress,

      // Flat intent fields
      bot: intent.bot,
      toToken: intent.toToken,
      minToAmount: intent.minToAmount.toString(),
      deadline: intent.deadline.toString(),
      ref: intent.ref,
      signature,

      // Optional source token
      ...(input.fromToken !== undefined && { fromToken: input.fromToken }),
      ...(input.maxFromAmount !== undefined && { maxFromAmount: input.maxFromAmount.toString() }),

      // Off-chain metadata
      idempotencyKey,
      ...(input.memo !== undefined && { memo: input.memo }),
    };

    return this._post(RELAYER_API.SWAP, idempotencyKey, body);
  }

  private async _post(path: string, idempotencyKey: string, body: Record<string, unknown>): Promise<PaymentResult> {
    const url = `${this.relayerUrl}${path}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Relayer request failed [${response.status}]: ${responseBody}`);
    }

    return response.json() as Promise<PaymentResult>;
  }
}
