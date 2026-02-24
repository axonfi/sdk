// ============================================================================
// @axon/sdk — Treasury and payment infrastructure for autonomous AI agents
// ============================================================================

// Main client
export { AxonClient } from './client.js'

// Types
export type {
  SpendingLimit,
  BotConfig,
  BotConfigParams,
  OperatorCeilings,
  PaymentIntent,
  PayInput,
  PaymentResult,
  PaymentStatus,
  AxonClientConfig,
} from './types.js'

// Constants
export {
  NATIVE_ETH,
  USDC,
  WINDOW,
  PAYMENT_INTENT_TYPEHASH,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  SUPPORTED_CHAIN_IDS,
  DEFAULT_DEADLINE_SECONDS,
  PaymentErrorCode,
} from './constants.js'
export type { SupportedChainId } from './constants.js'

// Signing utilities
export { signPayment, encodeRef } from './signer.js'

// Vault read helpers
export {
  getBotConfig,
  isBotActive,
  getOperatorCeilings,
  operatorMaxDrainPerDay,
  isVaultPaused,
  getDomainSeparator,
  getVaultVersion,
  deployVault,
  createAxonPublicClient,
  createAxonWalletClient,
  getChain,
} from './vault.js'

// ABIs (useful for wagmi/viem integrations in frontends/dashboards)
export { AxonVaultAbi } from './abis/AxonVault.js'
export { AxonVaultFactoryAbi } from './abis/AxonVaultFactory.js'
export { AxonRegistryAbi } from './abis/AxonRegistry.js'
