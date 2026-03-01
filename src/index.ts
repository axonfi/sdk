// ============================================================================
// @axonfi/sdk — Treasury and payment infrastructure for autonomous AI agents
// ============================================================================

// Main client
export { AxonClient } from './client.js';

// Types
export type {
  SpendingLimit,
  BotConfig,
  BotConfigParams,
  OperatorCeilings,
  PaymentIntent,
  ExecuteIntent,
  SwapIntent,
  PayInput,
  ExecuteInput,
  SwapInput,
  PaymentResult,
  PaymentStatus,
  AxonClientConfig,
  VaultInfo,
  DestinationCheckResult,
  RebalanceTokensResult,
  TosStatus,
  TokenInput,
  AmountInput,
} from './types.js';

// Constants
export {
  Chain,
  NATIVE_ETH,
  USDC,
  WINDOW,
  CHAIN_NAMES,
  EXPLORER_TX,
  EXPLORER_ADDR,
  PAYMENT_INTENT_TYPEHASH,
  EXECUTE_INTENT_TYPEHASH,
  SWAP_INTENT_TYPEHASH,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  SUPPORTED_CHAIN_IDS,
  DEFAULT_DEADLINE_SECONDS,
  PaymentErrorCode,
  RELAYER_API,
} from './constants.js';
export type { SupportedChainId } from './constants.js';

// Signing utilities
export { signPayment, signExecuteIntent, signSwapIntent, encodeRef } from './signer.js';

// Vault helpers (for dashboards and tooling that need direct chain access)
export {
  isBotActive,
  getBotConfig,
  getOperatorCeilings,
  operatorMaxDrainPerDay,
  isVaultPaused,
  getDomainSeparator,
  getVaultVersion,
  getVaultOwner,
  getVaultOperator,
  getTrackUsedIntents,
  isDestinationAllowed,
  getRebalanceTokenCount,
  isRebalanceTokenWhitelisted,
  deployVault,
  createAxonPublicClient,
  createAxonWalletClient,
  getChain,
} from './vault.js';

// Keystore utilities
export { encryptKeystore, decryptKeystore } from './keystore.js';
export type { KeystoreV3 } from './keystore.js';

// Token registry (shared by dashboard, relayer, and SDK consumers)
export { Token, KNOWN_TOKENS, getKnownTokensForChain, getTokenSymbolByAddress, resolveToken } from './tokens.js';
export type { KnownToken, KnownTokenSymbol } from './tokens.js';

// Amount conversion utilities
export { parseAmount, resolveTokenDecimals } from './amounts.js';

// ABIs (useful for wagmi/viem integrations in frontends/dashboards)
export { AxonVaultAbi } from './abis/AxonVault.js';
export { AxonVaultFactoryAbi } from './abis/AxonVaultFactory.js';
export { AxonRegistryAbi } from './abis/AxonRegistry.js';
