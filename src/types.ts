import type { Address, Hex } from 'viem';
import type { Token, KnownTokenSymbol } from './tokens.js';
import type { Chain } from './constants.js';

// ============================================================================
// Flexible input types for human-friendly API
// ============================================================================

/**
 * Accepts any way to identify a token:
 * - `Address` ('0x...') — raw contract address
 * - `Token` enum (Token.USDC) — type-safe symbol
 * - `KnownTokenSymbol` string ('USDC') — bare string shorthand
 */
export type TokenInput = Address | Token | KnownTokenSymbol;

/**
 * Accepts amounts in any format:
 * - `bigint` — raw base units (e.g. 5_000_000n for 5 USDC). Passed through as-is.
 * - `number` — human-readable (e.g. 5.2 for 5.2 USDC). SDK converts using token decimals.
 * - `string` — human-readable string (e.g. '5.2'). Recommended for computed values to avoid float precision issues.
 */
export type AmountInput = bigint | number | string;

// ============================================================================
// On-chain structs (mirror Solidity exactly)
// ============================================================================

/** Rolling window spending limit. Stored on-chain, enforced by relayer. */
export interface SpendingLimit {
  /** Max spend in this window (token base units, e.g. USDC has 6 decimals). */
  amount: bigint;
  /** Max number of transactions in this window. 0 = no count limit. */
  maxCount: bigint;
  /** Window size: 3600=1h, 86400=1d, 604800=1w, 2592000=30d */
  windowSeconds: bigint;
}

/** Per-bot configuration returned by getBotConfig(). */
export interface BotConfig {
  isActive: boolean;
  registeredAt: bigint;
  /** Hard per-tx cap for payments, enforced on-chain. 0 = no cap. */
  maxPerTxAmount: bigint;
  /** Hard cap for rebalancing (executeSwap) input amount in USD. 0 = no cap. */
  maxRebalanceAmount: bigint;
  /** Rolling window limits — stored on-chain, enforced by relayer. */
  spendingLimits: SpendingLimit[];
  /** Relayer triggers AI scan above this amount. 0 = never by amount alone. */
  aiTriggerThreshold: bigint;
  /** Relayer always requires AI scan for this bot regardless of amount. */
  requireAiVerification: boolean;
}

/** Parameters for addBot / updateBotConfig (raw on-chain format). */
export interface BotConfigParams {
  maxPerTxAmount: bigint;
  /** Hard cap for rebalancing (executeSwap) input amount in USD. 0 = no cap (default). */
  maxRebalanceAmount: bigint;
  spendingLimits: SpendingLimit[];
  aiTriggerThreshold: bigint;
  requireAiVerification: boolean;
}

/** Human-friendly spending limit input. SDK converts dollar amounts to 6-decimal base units. */
export interface SpendingLimitInput {
  /** Max spend in this window in USD (e.g. 1000 = $1,000). */
  amount: number;
  /** Max transactions in this window. 0 = no count limit. */
  maxCount: number;
  /** Window size in seconds: 3600=1h, 86400=1d, 604800=1w. Use WINDOW constants. */
  windowSeconds: number;
}

/**
 * Human-friendly bot config input for addBot / updateBotConfig.
 *
 * Dollar amounts are plain numbers (e.g. 100 = $100). The SDK converts
 * to 6-decimal base units (USDC precision) before sending to the contract.
 */
export interface BotConfigInput {
  /** Hard per-tx cap in USD (e.g. 100 = $100). 0 = no cap. */
  maxPerTxAmount: number;
  /** Hard rebalance cap in USD (e.g. 50 = $50). 0 = no cap. */
  maxRebalanceAmount: number;
  /** Rolling window spending limits. Up to 5. */
  spendingLimits: SpendingLimitInput[];
  /** AI scan trigger threshold in USD (e.g. 50 = $50). 0 = never by amount. */
  aiTriggerThreshold: number;
  /** Always require AI scan regardless of amount. */
  requireAiVerification: boolean;
}

/** Owner-set ceilings bounding operator actions. */
export interface OperatorCeilings {
  /** Operator cannot set a bot's maxPerTxAmount above this. 0 = no ceiling. */
  maxPerTxAmount: bigint;
  /** Operator cannot set a bot's daily limit above this. 0 = no ceiling. */
  maxBotDailyLimit: bigint;
  /** 0 = operator CANNOT add bots. Must be explicitly set by owner. */
  maxOperatorBots: bigint;
  /** Total vault daily outflow cap — relayer reads and enforces. 0 = none. */
  vaultDailyAggregate: bigint;
  /** Operator cannot set aiTriggerThreshold above this. 0 = no floor. */
  minAiTriggerFloor: bigint;
}

/**
 * Signed payment intent. This is the core signed data unit.
 *
 * The bot signs this struct using EIP-712. The relayer submits it to
 * executePayment() on-chain. The bot never interacts with the chain directly.
 *
 * Domain: { name: "AxonVault", version: "1", chainId, verifyingContract: vaultAddress }
 * TypeHash: keccak256("PaymentIntent(address bot,address to,address token,uint256 amount,uint256 deadline,bytes32 ref)")
 */
export interface PaymentIntent {
  /** Bot's own address. Must be registered in the vault. */
  bot: Address;
  /** Payment recipient address. */
  to: Address;
  /** Desired output token address (e.g. USDC). Vault may hold this directly
   *  or the relayer may swap to it transparently. */
  token: Address;
  /** Token amount in base units (USDC: 6 decimals, so 1 USDC = 1_000_000n). */
  amount: bigint;
  /** Unix timestamp after which this intent is invalid. */
  deadline: bigint;
  /** keccak256 of the off-chain memo. Full memo text stored by relayer. */
  ref: Hex;
}

// ============================================================================
// SDK input/output types (higher-level than on-chain structs)
// ============================================================================

/**
 * Input for AxonClient.pay(). The SDK fills in bot address, deadline,
 * and ref (from memo). You provide the payment destination and metadata.
 */
export interface PayInput {
  /** Payment recipient. */
  to: Address;
  /** Desired output token — an address, Token enum, or bare symbol string ('USDC'). */
  token: TokenInput;
  /** Amount: bigint (raw base units), number (human-readable), or string (human-readable). */
  amount: AmountInput;

  /**
   * Human-readable payment description. Stored in relayer's PostgreSQL.
   * Gets keccak256-hashed to populate the on-chain `ref` field.
   * Example: "API call #1234 — weather data lookup"
   */
  memo?: string;

  /**
   * Mandatory per-request unique key for idempotency. The relayer uses
   * this to deduplicate retries — submitting the same idempotencyKey twice
   * is safe and returns the original result. If omitted, the SDK generates
   * a UUID automatically.
   */
  idempotencyKey?: string;

  /**
   * For x402 / HTTP 402 flows: the URL whose resource is being unlocked
   * by this payment. Stored off-chain, not signed.
   */
  resourceUrl?: string;

  /** Your external invoice ID. Stored off-chain for reconciliation. */
  invoiceId?: string;

  /** Your external order ID. Stored off-chain for reconciliation. */
  orderId?: string;

  /**
   * Human-readable name for the recipient. Displayed on dashboards instead of
   * the raw address. Example: "Weather Bot", "Alice", "OpenAI API".
   */
  recipientLabel?: string;

  /** Arbitrary key-value metadata. Stored off-chain. Values must be strings. */
  metadata?: Record<string, string>;

  /**
   * Intent expiry. Defaults to 5 minutes from now.
   * Must be within the relayer's acceptance window (typically ±5 min).
   */
  deadline?: bigint;

  /**
   * Override the on-chain ref bytes32 directly. Use this when you need to
   * match an exact ref value (e.g. for cross-chain deposit tracking).
   * If set, `memo` is ignored for ref generation but still stored off-chain.
   */
  ref?: Hex;

  /**
   * Marks this payment as x402 bot-EOA funding. When true, the relayer
   * records the flag for audit/context (e.g. "bot self-payment for x402").
   * Does NOT bypass any policy checks — full pipeline still applies.
   */
  x402Funding?: boolean;
}

/**
 * Signed execute intent for DeFi protocol interactions.
 *
 * The bot signs this struct using EIP-712. The relayer submits it to
 * executeProtocol() on-chain. The contract approves `token` to `protocol`,
 * calls it with `callData`, then revokes the approval.
 *
 * TypeHash: keccak256("ExecuteIntent(address bot,address protocol,bytes32 calldataHash,address token,uint256 amount,uint256 deadline,bytes32 ref)")
 */
export interface ExecuteIntent {
  /** Bot's own address. Must be registered in the vault. */
  bot: Address;
  /** Target contract address (protocol or token). Must be approved via approveProtocol() or be a registry default token. */
  protocol: Address;
  /** keccak256 of the callData bytes. Verified by relayer before submission. */
  calldataHash: Hex;
  /** Token to approve to the protocol before calling. */
  token: Address;
  /** Amount to approve (in token base units). */
  amount: bigint;
  /** Unix timestamp after which this intent is invalid. */
  deadline: bigint;
  /** keccak256 of the off-chain memo. Full memo text stored by relayer. */
  ref: Hex;
}

/**
 * Signed swap intent for in-vault token rebalancing.
 *
 * The bot signs this struct using EIP-712. The relayer submits it to
 * executeSwap() on-chain. Tokens stay in the vault (no recipient).
 *
 * TypeHash: keccak256("SwapIntent(address bot,address toToken,uint256 minToAmount,uint256 deadline,bytes32 ref)")
 */
export interface SwapIntent {
  /** Bot's own address. Must be registered in the vault. */
  bot: Address;
  /** Desired output token. */
  toToken: Address;
  /** Minimum output amount (slippage floor). */
  minToAmount: bigint;
  /** Unix timestamp after which this intent is invalid. */
  deadline: bigint;
  /** keccak256 of the off-chain memo. Full memo text stored by relayer. */
  ref: Hex;
}

/**
 * Input for AxonClient.execute(). Signs an ExecuteIntent and submits to
 * the relayer's POST /v1/execute endpoint.
 */
export interface ExecuteInput {
  /** Target protocol contract address. */
  protocol: Address;
  /** The actual calldata bytes to send to the protocol. */
  callData: Hex;
  /** Token to approve to the protocol — an address, Token enum, or bare symbol string ('USDC'). */
  token: TokenInput;
  /** Amount to approve: bigint (raw base units), number (human-readable), or string (human-readable). */
  amount: AmountInput;

  /** Human-readable description. Gets keccak256-hashed to ref. */
  memo?: string;
  /**
   * Human-readable name for the protocol interaction. Displayed on dashboards
   * instead of the raw contract address. Example: "Uniswap Swap", "Aave Borrow".
   */
  protocolName?: string;
  /** Override ref bytes32 directly. */
  ref?: Hex;
  /** Idempotency key (auto-generated if omitted). */
  idempotencyKey?: string;
  /** Intent expiry (defaults to 5 min). */
  deadline?: bigint;
  /** Arbitrary metadata stored off-chain. */
  metadata?: Record<string, string>;

  // Pre-swap fields (if vault doesn't hold the required token)
  /** Source token for pre-swap — an address, Token enum, or bare symbol string. */
  fromToken?: TokenInput;
  /** Max input for pre-swap: bigint (raw), number (human), or string (human). */
  maxFromAmount?: AmountInput;
}

/**
 * Input for AxonClient.swap(). Signs a SwapIntent and submits to
 * the relayer's POST /v1/swap endpoint.
 */
export interface SwapInput {
  /** Desired output token — an address, Token enum, or bare symbol string ('WETH'). */
  toToken: TokenInput;
  /** Minimum output amount (slippage floor): bigint (raw), number (human), or string (human). */
  minToAmount: AmountInput;

  /** Human-readable description. Gets keccak256-hashed to ref. */
  memo?: string;
  /** Override ref bytes32 directly. */
  ref?: Hex;
  /** Idempotency key (auto-generated if omitted). */
  idempotencyKey?: string;
  /** Intent expiry (defaults to 5 min). */
  deadline?: bigint;

  // Swap source (relayer resolves if omitted)
  /** Source token to swap from — an address, Token enum, or bare symbol string. */
  fromToken?: TokenInput;
  /** Max input amount for swap: bigint (raw), number (human), or string (human). */
  maxFromAmount?: AmountInput;
}

/** Possible statuses returned by the relayer. */
export type PaymentStatus =
  | 'approved' // Submitted on-chain. txHash available.
  | 'pending_review' // Held for human or AI review. Poll for status.
  | 'rejected'; // Rejected. reason field explains why.

/** Result of AxonClient.pay() or AxonClient.poll(). */
export interface PaymentResult {
  requestId: string;
  status: PaymentStatus;
  /** On-chain transaction hash. Present when status === 'approved'. */
  txHash?: Hex;
  /** URL to poll for async results. */
  pollUrl?: string;
  /** Estimated milliseconds until resolution (relayer hint). */
  estimatedResolutionMs?: number;
  /** Rejection reason. Present when status === 'rejected'. */
  reason?: string;
}

/** High-level vault info returned by AxonClient.getVaultInfo(). */
export interface VaultInfo {
  owner: Address;
  operator: Address;
  paused: boolean;
  version: number;
}

/** Result of a destination check (canPayTo / isDestinationAllowed). */
export interface DestinationCheckResult {
  allowed: boolean;
  reason?: string;
}

/** Result of getRebalanceTokens() — the effective rebalance token whitelist. */
export interface RebalanceTokensResult {
  /** "default" = relayer defaults (no on-chain whitelist), "on_chain" = owner-set override. */
  source: 'default' | 'on_chain';
  /** Lowercase token addresses allowed for rebalancing (executeSwap output). */
  tokens: Address[];
  /** Number of tokens set on-chain. 0 = using relayer defaults. */
  rebalanceTokenCount: number;
}

/** TOS acceptance status for a wallet. */
export interface TosStatus {
  accepted: boolean;
  tosVersion: string;
}

/** Configuration for AxonClient. */
export interface AxonClientConfig {
  /** Vault contract address to sign against. */
  vaultAddress: Address;

  /** Chain ID — a number or a Chain enum value (e.g. Chain.Base). */
  chainId: Chain | number;

  /**
   * Bot's private key (hex, 0x-prefixed). Used to sign payment intents.
   * The SDK constructs a local signer internally — no RPC connection needed.
   * Provide either this or `account`.
   */
  botPrivateKey?: Hex;

  /** Override the relayer URL (defaults to https://relay.axonfi.xyz). */
  relayerUrl?: string;
}
