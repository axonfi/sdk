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
  VaultValueResult,
  DestinationCheckResult,
  RebalanceTokensResult,
  TosStatus,
} from './types.js';
import type { X402HandleResult } from './x402.js';
import { signPayment, signExecuteIntent, signSwapIntent, encodeRef } from './signer.js';
import { createAxonWalletClient } from './vault.js';
import { DEFAULT_DEADLINE_SECONDS, RELAYER_API, USDC } from './constants.js';
import { KNOWN_TOKENS, resolveToken } from './tokens.js';
import type { KnownTokenSymbol } from './tokens.js';
import { parseAmount, resolveTokenDecimals } from './amounts.js';
import { generateUuid } from './utils.js';
import { keccak256 } from 'viem';
import { parsePaymentRequired, findMatchingOption, extractX402Metadata, formatPaymentSignature } from './x402.js';
import { signTransferWithAuthorization, randomNonce, USDC_EIP712_DOMAIN } from './eip3009.js';
import { signPermit2WitnessTransfer, randomPermit2Nonce, PERMIT2_ADDRESS, X402_PROXY_ADDRESS } from './permit2.js';

// ============================================================================
// Helpers
// ============================================================================

/** Known burn / dead addresses that should never be used as destinations. */
const BURN_ADDRESSES = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x0000000000000000000000000000000000000001',
  '0x000000000000000000000000000000000000dead',
  '0xdead000000000000000000000000000000000000',
  '0xdeaddeaddeaddeaddeaddeaddeaddeaddead0000',
  '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
]);

function _rejectBurnAddress(address: string, label: string): void {
  if (BURN_ADDRESSES.has(address.toLowerCase())) {
    throw new Error(`${label} cannot be a burn/dead address (${address})`);
  }
}

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
 * import { AxonClient, USDC } from '@axonfi/sdk'
 *
 * const client = new AxonClient({
 *   vaultAddress: '0x...',
 *   chainId: 84532,           // Base Sepolia
 *   botPrivateKey: '0x...',
 * })
 *
 * const result = await client.pay({
 *   to: '0x...recipient...',
 *   token: 'USDC',
 *   amount: 5,                // 5 USDC — SDK handles decimals
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
  private readonly botPrivateKey: Hex;

  constructor(config: AxonClientConfig) {
    this.vaultAddress = config.vaultAddress;
    this.chainId = config.chainId;
    this.relayerUrl = config.relayerUrl ?? 'https://relay.axonfi.xyz';

    if (!config.botPrivateKey) {
      throw new Error('botPrivateKey is required in AxonClientConfig');
    }
    this.botPrivateKey = config.botPrivateKey;
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
  // Token address helpers
  // ============================================================================

  /** Returns the USDC address for this client's chain. Throws if USDC is not available on the chain. */
  get usdcAddress(): Address {
    const addr = USDC[this.chainId];
    if (!addr) {
      throw new Error(`No USDC address for chain ${this.chainId}`);
    }
    return addr;
  }

  /**
   * Returns the on-chain address for a known token symbol on this client's chain.
   *
   * @param symbol - A token symbol from the `Token` enum or `KNOWN_TOKENS` (e.g. `'WETH'`, `'USDC'`).
   * @throws If the symbol is unknown or has no address on this chain.
   *
   * @example
   * ```ts
   * axon.tokenAddress('WETH')  // "0x4200000000000000000000000000000000000006"
   * axon.tokenAddress('USDC')  // "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
   * ```
   */
  tokenAddress(symbol: string): Address {
    const entry = KNOWN_TOKENS[symbol as KnownTokenSymbol];
    if (!entry) {
      throw new Error(`Unknown token symbol: ${symbol}`);
    }
    const addr = (entry.addresses as Record<number, Address | undefined>)[this.chainId];
    if (!addr) {
      throw new Error(`Token ${symbol} is not available on chain ${this.chainId}`);
    }
    return addr;
  }

  /**
   * Returns the number of decimals for a known token symbol.
   *
   * @param symbol - A token symbol (e.g. `'USDC'`, `'WETH'`).
   * @throws If the symbol is unknown.
   *
   * @example
   * ```ts
   * axon.tokenDecimals('USDC')  // 6
   * axon.tokenDecimals('WETH')  // 18
   * ```
   */
  tokenDecimals(symbol: string): number {
    return resolveTokenDecimals(symbol as KnownTokenSymbol);
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
   *
   * If the vault doesn't hold enough of the payment token, the relayer returns
   * `errorCode: 'SWAP_REQUIRED'`. The SDK automatically signs a SwapIntent and
   * resubmits the payment with swap fields — no action needed from the caller.
   */
  async pay(input: PayInput): Promise<PaymentResult> {
    const intent = this._buildPaymentIntent(input);
    const signature = await signPayment(this.walletClient, this.vaultAddress, this.chainId, intent);
    const result = await this._submitPayment(intent, signature, input);

    // If vault needs a token swap first, sign a SwapIntent and resubmit.
    // Bot must sign fromToken + maxFromAmount — caller provides via swapFromToken/swapMaxFromAmount.
    if (result.status === 'rejected' && result.errorCode === 'SWAP_REQUIRED') {
      if (!input.swapFromToken || !input.swapMaxFromAmount) {
        throw new Error(
          'Vault lacks the payment token (SWAP_REQUIRED). ' +
          'Provide swapFromToken and swapMaxFromAmount in PayInput to enable auto-swap.',
        );
      }
      const swapIntent: SwapIntent = {
        bot: this.botAddress,
        toToken: intent.token, // swap TO the payment token
        minToAmount: intent.amount, // need at least the payment amount
        fromToken: resolveToken(input.swapFromToken, this.chainId),
        maxFromAmount: parseAmount(input.swapMaxFromAmount, input.swapFromToken, this.chainId),
        deadline: intent.deadline, // same deadline
        ref: intent.ref,
      };
      const swapSig = await signSwapIntent(this.walletClient, this.vaultAddress, this.chainId, swapIntent);
      return this._submitPaymentWithSwap(intent, signature, input, swapIntent, swapSig);
    }

    return result;
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
   *
   * **Approval rules for default tokens** (USDC, WETH, etc.): when calling
   * `approve()` on a default token, the spender must be an approved protocol
   * or swap router — the contract rejects arbitrary addresses. The approve
   * amount is capped by the bot's `maxPerTxAmount` and counts toward
   * spending limits.
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

  /** Returns high-level vault info (owner, operator, paused, version) via relayer. */
  async getVaultInfo(): Promise<VaultInfo> {
    const path = RELAYER_API.vaultInfo(this.vaultAddress, this.chainId);
    return this._get(path) as Promise<VaultInfo>;
  }

  // ============================================================================
  // getVaultValue() — via relayer
  // ============================================================================

  /**
   * Returns the total USD value of the vault with a per-token breakdown (via relayer).
   *
   * Includes all ERC-20 holdings with non-zero balances, their USD prices,
   * and the aggregate vault value.
   */
  async getVaultValue(): Promise<VaultValueResult> {
    const path = RELAYER_API.vaultValue(this.vaultAddress, this.chainId);
    return this._get(path) as Promise<VaultValueResult>;
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
  // isContractApproved() — via relayer
  // ============================================================================

  /** Returns whether a contract address (protocol or token) is approved for executeProtocol() calls (via relayer). */
  async isContractApproved(protocol: Address): Promise<boolean> {
    const path = RELAYER_API.protocolCheck(this.vaultAddress, protocol, this.chainId);
    const data = await this._get(path);
    return data.approved;
  }

  // ============================================================================
  // getRebalanceTokens() — via relayer
  // ============================================================================

  /**
   * Returns the effective rebalance token whitelist for this vault.
   *
   * If the owner set tokens on-chain, those override entirely.
   * If no on-chain whitelist, returns relayer defaults (USDC, WETH, USDT).
   * Use this before calling swap() to check which output tokens are allowed.
   */
  async getRebalanceTokens(): Promise<RebalanceTokensResult> {
    const path = RELAYER_API.rebalanceTokens(this.vaultAddress, this.chainId);
    return this._get(path) as Promise<RebalanceTokensResult>;
  }

  // ============================================================================
  // isRebalanceTokenAllowed() — via relayer
  // ============================================================================

  /** Check if a specific token is allowed for rebalancing (executeSwap output) on this vault. */
  async isRebalanceTokenAllowed(token: Address): Promise<{ allowed: boolean; source: 'default' | 'on_chain' }> {
    const path = RELAYER_API.rebalanceTokenCheck(this.vaultAddress, token, this.chainId);
    return this._get(path) as Promise<{ allowed: boolean; source: 'default' | 'on_chain' }>;
  }

  // ============================================================================
  // TOS (Terms of Service)
  // ============================================================================

  /** Check if a wallet has accepted the current TOS version. */
  async getTosStatus(wallet: string): Promise<TosStatus> {
    return this._get(RELAYER_API.tosStatus(wallet)) as Promise<TosStatus>;
  }

  /**
   * Sign and submit TOS acceptance. Uses the owner's wallet (not the bot key).
   *
   * @param signer - Object with a `signMessage` method (e.g. a viem WalletClient
   *   or ethers Signer). This should be the vault owner's wallet, not the bot key.
   * @param wallet - The owner's wallet address (must match the signer).
   */
  async acceptTos(
    signer: { signMessage: (args: { message: string }) => Promise<Hex> },
    wallet: string,
  ): Promise<TosStatus> {
    // 1. Get current TOS version from relayer
    const { tosVersion } = await this.getTosStatus(wallet);

    // 2. Construct and sign the acceptance message
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `I accept the Axon Terms of Service (${tosVersion}).\nWallet: ${wallet}\nTimestamp: ${timestamp}`;
    const signature = await signer.signMessage({ message });

    // 3. Submit to relayer
    const url = `${this.relayerUrl}${RELAYER_API.TOS_ACCEPT}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet, signature, tosVersion, timestamp }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`TOS acceptance failed [${response.status}]: ${body}`);
    }

    return response.json() as Promise<TosStatus>;
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
  // x402 — HTTP 402 Payment Required
  // ============================================================================

  /**
   * x402 utilities for handling HTTP 402 Payment Required responses.
   *
   * The x402 flow:
   * 1. Bot hits an API that returns HTTP 402 + PAYMENT-REQUIRED header
   * 2. SDK parses the header, finds a matching payment option
   * 3. SDK funds the bot's EOA from the vault (full Axon pipeline applies)
   * 4. Bot signs an EIP-3009 or Permit2 authorization
   * 5. SDK returns a PAYMENT-SIGNATURE header for the bot to retry with
   *
   * @example
   * ```ts
   * const response = await fetch('https://api.example.com/data');
   * if (response.status === 402) {
   *   const result = await client.x402.handlePaymentRequired(response.headers);
   *   const data = await fetch('https://api.example.com/data', {
   *     headers: { 'PAYMENT-SIGNATURE': result.paymentSignature },
   *   });
   * }
   * ```
   */
  readonly x402 = {
    /**
     * Fund the bot's EOA from the vault for x402 settlement.
     *
     * This is a regular Axon payment (to = bot's own address) that goes through
     * the full pipeline: policy engine, AI scan, human review if needed.
     *
     * @param amount - Amount in token base units
     * @param token - Token address (defaults to USDC on this chain)
     * @param metadata - Optional metadata for the payment record
     */
    fund: async (
      amount: bigint,
      token?: Address,
      metadata?: { resourceUrl?: string; memo?: string; recipientLabel?: string; metadata?: Record<string, string> },
    ): Promise<PaymentResult> => {
      const tokenAddress = token ?? USDC[this.chainId];
      if (!tokenAddress) {
        throw new Error(`No default USDC address for chain ${this.chainId}`);
      }

      return this.pay({
        to: this.botAddress,
        token: tokenAddress,
        amount,
        x402Funding: true,
        ...metadata,
      });
    },

    /**
     * Handle a full x402 flow: parse header, fund bot, sign authorization, return header.
     *
     * Supports both EIP-3009 (USDC) and Permit2 (any ERC-20) settlement.
     * The bot's EOA is funded from the vault first (full Axon pipeline applies).
     *
     * @param headers - Response headers from the 402 response (must contain PAYMENT-REQUIRED)
     * @param maxTimeoutMs - Maximum time to wait for pending_review resolution (default: 120s)
     * @param pollIntervalMs - Polling interval for pending_review (default: 5s)
     * @returns Payment signature header value + funding details
     */
    handlePaymentRequired: async (
      headers: Headers | Record<string, string>,
      maxTimeoutMs: number = 120_000,
      pollIntervalMs: number = 5_000,
    ): Promise<X402HandleResult> => {
      // 1. Parse the PAYMENT-REQUIRED header
      const headerValue =
        headers instanceof Headers
          ? (headers.get('payment-required') ?? headers.get('PAYMENT-REQUIRED'))
          : (headers['payment-required'] ?? headers['PAYMENT-REQUIRED']);

      if (!headerValue) {
        throw new Error('x402: no PAYMENT-REQUIRED header found');
      }

      const parsed = parsePaymentRequired(headerValue);

      // 2. Find a matching payment option for this chain
      const option = findMatchingOption(parsed.accepts, this.chainId);
      if (!option) {
        throw new Error(
          `x402: no payment option matches chain ${this.chainId}. ` +
            `Available: ${parsed.accepts.map((a) => a.network).join(', ')}`,
        );
      }

      // 3. Extract metadata for the payment record
      const x402Meta = extractX402Metadata(parsed, option);

      // 4. Fund the bot's EOA from the vault
      const amount = BigInt(option.amount);
      const tokenAddress = option.asset as Address;

      const payInput: PayInput = {
        to: this.botAddress,
        token: tokenAddress,
        amount,
        x402Funding: true,
        resourceUrl: x402Meta.resourceUrl,
        metadata: x402Meta.metadata,
      };
      if (x402Meta.memo) payInput.memo = x402Meta.memo;
      if (x402Meta.recipientLabel) payInput.recipientLabel = x402Meta.recipientLabel;

      let fundingResult = await this.pay(payInput);

      // 5. If pending_review, poll until resolved or timeout
      if (fundingResult.status === 'pending_review') {
        const deadline = Date.now() + maxTimeoutMs;
        while (fundingResult.status === 'pending_review' && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          fundingResult = await this.poll(fundingResult.requestId);
        }
        if (fundingResult.status === 'pending_review') {
          throw new Error(`x402: funding timed out after ${maxTimeoutMs}ms (still pending_review)`);
        }
      }

      if (fundingResult.status === 'rejected') {
        throw new Error(`x402: funding rejected — ${fundingResult.reason ?? 'unknown reason'}`);
      }

      // 6. Sign the appropriate authorization
      const botPrivateKey = this.botPrivateKey;

      const payTo = option.payTo as Address;
      const usdcAddress = USDC[this.chainId]?.toLowerCase();
      const isUsdc = tokenAddress.toLowerCase() === usdcAddress;

      let signaturePayload: Record<string, unknown>;

      if (isUsdc && USDC_EIP712_DOMAIN[this.chainId]) {
        // EIP-3009 path (USDC — gasless)
        const nonce = randomNonce();
        const validAfter = 0n;
        const validBefore = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 min

        const sig = await signTransferWithAuthorization(botPrivateKey, this.chainId, {
          from: this.botAddress,
          to: payTo,
          value: amount,
          validAfter,
          validBefore,
          nonce,
        });

        signaturePayload = {
          scheme: 'exact',
          signature: sig,
          authorization: {
            from: this.botAddress,
            to: payTo,
            value: amount.toString(),
            validAfter: validAfter.toString(),
            validBefore: validBefore.toString(),
            nonce,
          },
        };
      } else {
        // Permit2 path (any ERC-20)
        const nonce = randomPermit2Nonce();
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

        const sig = await signPermit2WitnessTransfer(botPrivateKey, this.chainId, {
          token: tokenAddress,
          amount,
          spender: X402_PROXY_ADDRESS,
          nonce,
          deadline,
          witnessTo: payTo,
          witnessRequestedAmount: amount,
        });

        signaturePayload = {
          scheme: 'permit2',
          signature: sig,
          permit: {
            permitted: { token: tokenAddress, amount: amount.toString() },
            spender: X402_PROXY_ADDRESS,
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
          witness: {
            to: payTo,
            requestedAmount: amount.toString(),
          },
        };
      }

      // 7. Format the PAYMENT-SIGNATURE header
      const paymentSignature = formatPaymentSignature(signaturePayload);

      const handleResult: X402HandleResult = {
        paymentSignature,
        selectedOption: option,
        fundingResult: {
          requestId: fundingResult.requestId,
          status: fundingResult.status,
        },
      };
      if (fundingResult.txHash) {
        handleResult.fundingResult.txHash = fundingResult.txHash;
      }
      return handleResult;
    },
  };

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
    _rejectBurnAddress(input.to, 'Payment recipient');
    return {
      bot: this.botAddress,
      to: input.to,
      token: resolveToken(input.token, this.chainId),
      amount: parseAmount(input.amount, input.token, this.chainId),
      deadline: input.deadline ?? this._defaultDeadline(),
      ref: this._resolveRef(input.memo, input.ref),
    };
  }

  private _buildExecuteIntent(input: ExecuteInput): ExecuteIntent {
    _rejectBurnAddress(input.protocol, 'Protocol address');
    const inputTokens = input.tokens ?? [];
    const inputAmounts = input.amounts ?? [];
    if (inputTokens.length !== inputAmounts.length) {
      throw new Error(`tokens length (${inputTokens.length}) must match amounts length (${inputAmounts.length})`);
    }
    if (inputTokens.length > 5) {
      throw new Error(`Too many tokens (${inputTokens.length}): maximum 5 allowed. Contact Axon if you need more.`);
    }
    const resolvedTokens = inputTokens.map((t) => resolveToken(t, this.chainId));
    const zeroAddr = '0x0000000000000000000000000000000000000000';
    for (const t of resolvedTokens) {
      if (t.toLowerCase() === zeroAddr) throw new Error('Zero address not allowed in tokens array');
    }
    const uniqueTokens = new Set(resolvedTokens.map((t) => t.toLowerCase()));
    if (uniqueTokens.size !== resolvedTokens.length) {
      throw new Error('Duplicate token addresses in tokens array');
    }
    return {
      bot: this.botAddress,
      protocol: input.protocol,
      calldataHash: keccak256(input.callData),
      tokens: resolvedTokens,
      amounts: inputTokens.map((t, i) => parseAmount(inputAmounts[i]!, t, this.chainId)),
      value: input.value ?? 0n,
      deadline: input.deadline ?? this._defaultDeadline(),
      ref: this._resolveRef(input.memo, input.ref),
    };
  }

  private _buildSwapIntent(input: SwapInput): SwapIntent {
    return {
      bot: this.botAddress,
      toToken: resolveToken(input.toToken, this.chainId),
      minToAmount: parseAmount(input.minToAmount, input.toToken, this.chainId),
      fromToken: resolveToken(input.fromToken, this.chainId),
      maxFromAmount: parseAmount(input.maxFromAmount, input.fromToken, this.chainId),
      deadline: input.deadline ?? this._defaultDeadline(),
      ref: this._resolveRef(input.memo, input.ref),
    };
  }

  private async _submitPaymentWithSwap(
    intent: PaymentIntent,
    signature: Hex,
    input: PayInput,
    swapIntent: SwapIntent,
    swapSignature: Hex,
  ): Promise<PaymentResult> {
    // New idempotency key for the retry (original was consumed by the SWAP_REQUIRED rejection)
    const idempotencyKey = generateUuid();

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

      // Swap fields (all bot-signed)
      swapSignature,
      swapToToken: swapIntent.toToken,
      swapMinToAmount: swapIntent.minToAmount.toString(),
      swapFromToken: swapIntent.fromToken,
      swapMaxFromAmount: swapIntent.maxFromAmount.toString(),
      swapDeadline: swapIntent.deadline.toString(),
      swapRef: swapIntent.ref,

      // Off-chain metadata
      idempotencyKey,
      ...(input.memo !== undefined && { memo: input.memo }),
      ...(input.resourceUrl !== undefined && { resourceUrl: input.resourceUrl }),
      ...(input.invoiceId !== undefined && { invoiceId: input.invoiceId }),
      ...(input.orderId !== undefined && { orderId: input.orderId }),
      ...(input.recipientLabel !== undefined && { recipientLabel: input.recipientLabel }),
      ...(input.metadata !== undefined && { metadata: input.metadata }),
      ...(input.x402Funding !== undefined && { x402Funding: input.x402Funding }),
    };

    return this._post(RELAYER_API.PAYMENTS, idempotencyKey, body);
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
      ...(input.x402Funding !== undefined && { x402Funding: input.x402Funding }),
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
      tokens: intent.tokens,
      amounts: intent.amounts.map((a) => a.toString()),
      value: intent.value.toString(),
      deadline: intent.deadline.toString(),
      ref: intent.ref,
      signature,

      // Protocol calldata
      callData: input.callData,

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

      // Flat intent fields (all bot-signed)
      bot: intent.bot,
      toToken: intent.toToken,
      minToAmount: intent.minToAmount.toString(),
      fromToken: intent.fromToken,
      maxFromAmount: intent.maxFromAmount.toString(),
      deadline: intent.deadline.toString(),
      ref: intent.ref,
      signature,

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
