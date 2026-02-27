import type { Address, Hex } from 'viem';

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
  /** Hard per-tx cap enforced on-chain. 0 = no cap. */
  maxPerTxAmount: bigint;
  /** Rolling window limits — stored on-chain, enforced by relayer. */
  spendingLimits: SpendingLimit[];
  /** Relayer triggers AI scan above this amount. 0 = never by amount alone. */
  aiTriggerThreshold: bigint;
  /** Relayer always requires AI scan for this bot regardless of amount. */
  requireAiVerification: boolean;
}

/** Parameters for addBot / updateBotConfig. */
export interface BotConfigParams {
  maxPerTxAmount: bigint;
  spendingLimits: SpendingLimit[];
  aiTriggerThreshold: bigint;
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
  /** Desired output token (e.g. USDC[chainId]). */
  token: Address;
  /** Amount in token base units. For USDC: 1 USDC = 1_000_000n. */
  amount: bigint;

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
  /** Target DeFi protocol contract address. Must be in vault's approvedProtocols. */
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
  /** Token to approve to the protocol. */
  token: Address;
  /** Amount to approve (in token base units). */
  amount: bigint;

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
  /** Source token for pre-swap (relayer resolves automatically if omitted). */
  fromToken?: Address;
  /** Max input for pre-swap. */
  maxFromAmount?: bigint;
}

/**
 * Input for AxonClient.swap(). Signs a SwapIntent and submits to
 * the relayer's POST /v1/swap endpoint.
 */
export interface SwapInput {
  /** Desired output token. */
  toToken: Address;
  /** Minimum output amount (slippage floor). */
  minToAmount: bigint;

  /** Human-readable description. Gets keccak256-hashed to ref. */
  memo?: string;
  /** Override ref bytes32 directly. */
  ref?: Hex;
  /** Idempotency key (auto-generated if omitted). */
  idempotencyKey?: string;
  /** Intent expiry (defaults to 5 min). */
  deadline?: bigint;

  // Swap source (relayer resolves if omitted)
  /** Source token to swap from. */
  fromToken?: Address;
  /** Max input amount for swap. */
  maxFromAmount?: bigint;
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
  trackUsedIntents: boolean;
}

/** Result of a destination check (canPayTo / isDestinationAllowed). */
export interface DestinationCheckResult {
  allowed: boolean;
  reason?: string;
}

/** Configuration for AxonClient. */
export interface AxonClientConfig {
  /** Vault contract address to sign against. */
  vaultAddress: Address;

  /** Chain ID of the network the vault is deployed on. */
  chainId: number;

  /**
   * Bot's private key (hex, 0x-prefixed). Used to sign payment intents.
   * The SDK constructs a wallet client internally.
   * Provide either this or `account`.
   */
  botPrivateKey?: Hex;

  /**
   * Relayer base URL. Required for pay() and poll().
   * Example: "https://relay.axonfi.xyz"
   */
  relayerUrl: string;

  /**
   * JSON-RPC endpoint. Used for on-chain reads (getBotConfig, etc.).
   * Example: "https://mainnet.base.org"
   */
  rpcUrl: string;
}
