import { erc20Abi } from 'viem';
import type { PublicClient, WalletClient, Address, Hex } from 'viem';
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
import {
  isBotActive,
  isVaultPaused,
  getVaultOwner,
  getVaultOperator,
  getVaultVersion,
  getTrackUsedIntents,
  isDestinationAllowed,
  createAxonPublicClient,
  createAxonWalletClient,
} from './vault.js';
import { AxonVaultAbi } from './abis/AxonVault.js';
import { DEFAULT_DEADLINE_SECONDS, RELAYER_API } from './constants.js';
import { keccak256 } from 'viem';

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
 *   relayerUrl: 'https://relay.axonfi.xyz',
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
  private readonly vaultAddress: Address;
  private readonly chainId: number;
  private readonly relayerUrl: string;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;

  constructor(config: AxonClientConfig) {
    this.vaultAddress = config.vaultAddress;
    this.chainId = config.chainId;
    this.relayerUrl = config.relayerUrl.replace(/\/$/, ''); // strip trailing slash

    this.publicClient = createAxonPublicClient(config.chainId, config.rpcUrl);

    if (!config.botPrivateKey) {
      throw new Error('botPrivateKey is required in AxonClientConfig');
    }
    this.walletClient = createAxonWalletClient(config.botPrivateKey, config.chainId, config.rpcUrl);
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
   * - `"pending_review"`: AI scan or human review in progress — poll or await webhook
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
  // getBalance()
  // ============================================================================

  /** Read the vault's ERC-20 balance for a given token (on-chain read). */
  async getBalance(token: Address): Promise<bigint> {
    return this.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [this.vaultAddress],
    });
  }

  // ============================================================================
  // isActive()
  // ============================================================================

  /** Returns whether this bot is registered and active in the vault. */
  async isActive(): Promise<boolean> {
    return isBotActive(this.publicClient, this.vaultAddress, this.botAddress);
  }

  // ============================================================================
  // isPaused()
  // ============================================================================

  /** Returns whether the vault is currently paused. */
  async isPaused(): Promise<boolean> {
    return isVaultPaused(this.publicClient, this.vaultAddress);
  }

  // ============================================================================
  // getVaultInfo()
  // ============================================================================

  /** Returns high-level vault info (owner, operator, paused, version, trackUsedIntents). */
  async getVaultInfo(): Promise<VaultInfo> {
    const [owner, operator, paused, version, trackUsedIntents] = await Promise.all([
      getVaultOwner(this.publicClient, this.vaultAddress),
      getVaultOperator(this.publicClient, this.vaultAddress),
      isVaultPaused(this.publicClient, this.vaultAddress),
      getVaultVersion(this.publicClient, this.vaultAddress),
      getTrackUsedIntents(this.publicClient, this.vaultAddress),
    ]);
    return { owner, operator, paused, version, trackUsedIntents };
  }

  // ============================================================================
  // canPayTo()
  // ============================================================================

  /**
   * Check whether this bot can pay to a given destination address.
   * Checks blacklist → global whitelist → bot whitelist, matching on-chain logic.
   */
  async canPayTo(destination: Address): Promise<DestinationCheckResult> {
    return isDestinationAllowed(this.publicClient, this.vaultAddress, this.botAddress, destination);
  }

  // ============================================================================
  // isProtocolApproved()
  // ============================================================================

  /** Returns whether a protocol address is approved for executeProtocol() calls. */
  async isProtocolApproved(protocol: Address): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.vaultAddress,
      abi: AxonVaultAbi,
      functionName: 'isProtocolApproved',
      args: [protocol],
    });
  }

  // ============================================================================
  // getBalances()
  // ============================================================================

  /**
   * Read the vault's ERC-20 balances for multiple tokens in a single multicall.
   * Returns a record mapping token address → balance.
   */
  async getBalances(tokens: Address[]): Promise<Record<Address, bigint>> {
    const results = await this.publicClient.multicall({
      contracts: tokens.map((token) => ({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [this.vaultAddress],
      })),
    });

    const balances: Record<Address, bigint> = {};
    for (let i = 0; i < tokens.length; i++) {
      const result = results[i];
      balances[tokens[i]!] = result?.status === 'success' ? (result.result as bigint) : 0n;
    }
    return balances;
  }

  // ============================================================================
  // poll() / pollExecute() / pollSwap()
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
    return this._poll(RELAYER_API.payment(requestId));
  }

  /** Poll the relayer for the status of an async protocol execution. */
  async pollExecute(requestId: string): Promise<PaymentResult> {
    return this._poll(RELAYER_API.execute(requestId));
  }

  /** Poll the relayer for the status of an async swap. */
  async pollSwap(requestId: string): Promise<PaymentResult> {
    return this._poll(RELAYER_API.swap(requestId));
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

  private async _poll(path: string): Promise<PaymentResult> {
    const url = `${this.relayerUrl}${path}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Relayer poll failed [${response.status}]: ${body}`);
    }

    return response.json() as Promise<PaymentResult>;
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

// ============================================================================
// Tiny UUID v4 generator (no external dependency)
// ============================================================================

function generateUuid(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Node.js fallback
    const { randomBytes } = require('crypto') as typeof import('crypto');
    const buf = randomBytes(16);
    for (let i = 0; i < 16; i++) bytes[i] = buf[i] ?? 0;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant bits
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
