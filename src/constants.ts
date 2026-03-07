import { keccak256, stringToBytes } from 'viem';
import type { Address } from 'viem';

// ============================================================================
// EIP-712 type hashes
// ============================================================================

/**
 * keccak256 of the PaymentIntent type string — used for manual digest
 * verification. viem's signTypedData computes this internally; you don't
 * need this value for signing, only for low-level verification.
 */
export const PAYMENT_INTENT_TYPEHASH: `0x${string}` = keccak256(
  stringToBytes('PaymentIntent(address bot,address to,address token,uint256 amount,uint256 deadline,bytes32 ref)'),
);

/** keccak256 of the ExecuteIntent type string for DeFi protocol interactions. */
export const EXECUTE_INTENT_TYPEHASH: `0x${string}` = keccak256(
  stringToBytes(
    'ExecuteIntent(address bot,address protocol,bytes32 calldataHash,address token,uint256 amount,uint256 value,uint256 deadline,bytes32 ref)',
  ),
);

/** keccak256 of the SwapIntent type string for in-vault token rebalancing. */
export const SWAP_INTENT_TYPEHASH: `0x${string}` = keccak256(
  stringToBytes('SwapIntent(address bot,address toToken,uint256 minToAmount,uint256 deadline,bytes32 ref)'),
);

/** EIP-712 domain name and version for AxonVault. Matches the constructor. */
export const EIP712_DOMAIN_NAME = 'AxonVault' as const;
export const EIP712_DOMAIN_VERSION = '1' as const;

// ============================================================================
// Native ETH sentinel
// ============================================================================

/** Sentinel address representing native ETH in PaymentIntents and deposits. */
export const NATIVE_ETH: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

// ============================================================================
// USDC addresses per chain
// ============================================================================

export const USDC: Record<number, Address> = {
  // Base mainnet
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  // Base Sepolia
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  // Arbitrum One
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  // Arbitrum Sepolia
  421614: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
};

// ============================================================================
// Chain enum & supported chain IDs
// ============================================================================

export enum Chain {
  Base = 8453,
  BaseSepolia = 84532,
  Arbitrum = 42161,
  ArbitrumSepolia = 421614,
}

export const SUPPORTED_CHAIN_IDS = [8453, 84532, 42161, 421614] as const;
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

// ============================================================================
// Chain metadata (names & block explorers)
// ============================================================================

/** Human-readable chain names. */
export const CHAIN_NAMES: Record<number, string> = {
  [Chain.Base]: 'Base',
  [Chain.BaseSepolia]: 'Base Sepolia',
  [Chain.Arbitrum]: 'Arbitrum One',
  [Chain.ArbitrumSepolia]: 'Arbitrum Sepolia',
};

/** Block explorer TX URL prefix per chain. */
export const EXPLORER_TX: Record<number, string> = {
  [Chain.Base]: 'https://basescan.org/tx/',
  [Chain.BaseSepolia]: 'https://sepolia.basescan.org/tx/',
  [Chain.Arbitrum]: 'https://arbiscan.io/tx/',
  [Chain.ArbitrumSepolia]: 'https://sepolia.arbiscan.io/tx/',
};

/** Block explorer address URL prefix per chain. */
export const EXPLORER_ADDR: Record<number, string> = {
  [Chain.Base]: 'https://basescan.org/address/',
  [Chain.BaseSepolia]: 'https://sepolia.basescan.org/address/',
  [Chain.Arbitrum]: 'https://arbiscan.io/address/',
  [Chain.ArbitrumSepolia]: 'https://sepolia.arbiscan.io/address/',
};

// ============================================================================
// Time constants (seconds)
// ============================================================================

/** Default intent validity window when no deadline is specified. */
export const DEFAULT_DEADLINE_SECONDS = 300; // 5 minutes

/** Window presets for SpendingLimit.windowSeconds. */
export const WINDOW = {
  ONE_HOUR: 3600n,
  ONE_DAY: 86400n,
  ONE_WEEK: 604800n,
  THIRTY_DAYS: 2592000n,
} as const;

// ============================================================================
// Payment rejection error codes
// ============================================================================

/**
 * Structured error codes returned by the relayer when a payment is rejected.
 * Bots should import these to programmatically handle failures.
 */
export const PaymentErrorCode = {
  /** Payment destination is the vault itself */
  SELF_PAYMENT: 'SELF_PAYMENT',
  /** Payment destination is the zero address */
  ZERO_ADDRESS: 'ZERO_ADDRESS',
  /** Payment amount is zero */
  ZERO_AMOUNT: 'ZERO_AMOUNT',
  /** Vault does not hold enough of the requested token */
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  /** EIP-712 signature verification failed */
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  /** Payment intent deadline has passed */
  DEADLINE_EXPIRED: 'DEADLINE_EXPIRED',
  /** Bot is temporarily paused by the operator */
  BOT_PAUSED: 'BOT_PAUSED',
  /** Bot address is not registered/active in the vault */
  BOT_NOT_ACTIVE: 'BOT_NOT_ACTIVE',
  /** Destination address is on the global or vault blacklist */
  BLACKLISTED: 'BLACKLISTED',
  /** Rolling-window spending limit (USD amount) exceeded */
  SPENDING_LIMIT_EXCEEDED: 'SPENDING_LIMIT_EXCEEDED',
  /** Rolling-window transaction count limit exceeded */
  TX_COUNT_EXCEEDED: 'TX_COUNT_EXCEEDED',
  /** Single transaction exceeds the bot's on-chain maxPerTxAmount */
  MAX_PER_TX_EXCEEDED: 'MAX_PER_TX_EXCEEDED',
  /** Vault-level daily aggregate spending limit exceeded */
  VAULT_AGGREGATE_EXCEEDED: 'VAULT_AGGREGATE_EXCEEDED',
  /** eth_call simulation of the on-chain transaction reverted */
  SIMULATION_FAILED: 'SIMULATION_FAILED',
  /** Routed to human review (AI scan flagged or no consensus) */
  PENDING_REVIEW: 'PENDING_REVIEW',
  /** Relayer wallet has insufficient gas to submit the transaction */
  RELAYER_OUT_OF_GAS: 'RELAYER_OUT_OF_GAS',
  /** On-chain transaction submission failed */
  SUBMISSION_FAILED: 'SUBMISSION_FAILED',
  /** Destination not in the vault/bot whitelist */
  DESTINATION_NOT_WHITELISTED: 'DESTINATION_NOT_WHITELISTED',
  /** Vault address is not a valid AxonVault or was not deployed by a known factory */
  INVALID_VAULT: 'INVALID_VAULT',
  /** Rebalance output token is not in the whitelist (on-chain or relayer default) */
  REBALANCE_TOKEN_NOT_ALLOWED: 'REBALANCE_TOKEN_NOT_ALLOWED',
  /** Rebalance input amount exceeds the bot's maxRebalanceAmount cap */
  MAX_REBALANCE_AMOUNT_EXCEEDED: 'MAX_REBALANCE_AMOUNT_EXCEEDED',
  /** Unknown or internal error */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type PaymentErrorCode = (typeof PaymentErrorCode)[keyof typeof PaymentErrorCode];

// ============================================================================
// Relayer API paths
// ============================================================================

export const RELAYER_API = {
  PAYMENTS: '/v1/payments',
  payment: (requestId: string) => `/v1/payments/${requestId}`,
  EXECUTE: '/v1/execute',
  execute: (requestId: string) => `/v1/execute/${requestId}`,
  SWAP: '/v1/swap',
  swap: (requestId: string) => `/v1/swap/${requestId}`,

  // Vault read endpoints (relayer reads chain on behalf of bots)
  vaultBalance: (vault: string, token: string, chainId: number) =>
    `/v1/vault/${vault}/balance/${token}?chainId=${chainId}`,
  vaultBalances: (vault: string, chainId: number) => `/v1/vault/${vault}/balances`,
  vaultInfo: (vault: string, chainId: number) => `/v1/vault/${vault}/info?chainId=${chainId}`,
  botStatus: (vault: string, bot: string, chainId: number) => `/v1/vault/${vault}/bot/${bot}/status?chainId=${chainId}`,
  destinationCheck: (vault: string, bot: string, destination: string, chainId: number) =>
    `/v1/vault/${vault}/bot/${bot}/destination/${destination}?chainId=${chainId}`,
  protocolCheck: (vault: string, protocol: string, chainId: number) =>
    `/v1/vault/${vault}/protocol/${protocol}?chainId=${chainId}`,
  rebalanceTokens: (vault: string, chainId: number) => `/v1/vault/${vault}/rebalance-tokens?chainId=${chainId}`,
  rebalanceTokenCheck: (vault: string, token: string, chainId: number) =>
    `/v1/vault/${vault}/rebalance-token/${token}?chainId=${chainId}`,

  // TOS endpoints
  tosStatus: (wallet: string) => `/v1/tos/status?wallet=${wallet}`,
  TOS_ACCEPT: '/v1/tos/accept',
} as const;
