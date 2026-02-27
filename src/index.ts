// ============================================================================
// @axon/sdk — Treasury and payment infrastructure for autonomous AI agents
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
} from './types.js';

// Constants
export {
  NATIVE_ETH,
  USDC,
  WINDOW,
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

// Vault read helpers
// NOTE: getBotConfig is intentionally NOT exported. Bots must not learn their
// own spending limits or AI thresholds, as a compromised bot could use this
// information to craft attacks that stay just below detection thresholds.
// Dashboard/relayer read bot config directly from the chain via their own clients.
export {
  isBotActive,
  getOperatorCeilings,
  operatorMaxDrainPerDay,
  isVaultPaused,
  getDomainSeparator,
  getVaultVersion,
  getVaultOwner,
  getVaultOperator,
  getTrackUsedIntents,
  isDestinationAllowed,
  deployVault,
  createAxonPublicClient,
  createAxonWalletClient,
  getChain,
} from './vault.js';

// Keystore utilities
export { encryptKeystore, decryptKeystore } from './keystore.js';
export type { KeystoreV3 } from './keystore.js';

// ABIs (useful for wagmi/viem integrations in frontends/dashboards)
export { AxonVaultAbi } from './abis/AxonVault.js';
export { AxonVaultFactoryAbi } from './abis/AxonVaultFactory.js';
export { AxonRegistryAbi } from './abis/AxonRegistry.js';
