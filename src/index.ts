// ============================================================================
// @axonfi/sdk — Treasury and payment infrastructure for autonomous AI agents
// ============================================================================

// Main client
export { AxonClient } from './client.js';

// Types
export type {
  SpendingLimit,
  SpendingLimitInput,
  BotConfig,
  BotConfigParams,
  BotConfigInput,
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
  toBotConfigParams,
  isBotActive,
  getBotConfig,
  getOperatorCeilings,
  operatorMaxDrainPerDay,
  isVaultPaused,
  getDomainSeparator,
  getVaultVersion,
  getVaultOwner,
  getVaultOperator,
  isDestinationAllowed,
  getRebalanceTokenCount,
  isRebalanceTokenWhitelisted,
  deployVault,
  addBot,
  updateBotConfig,
  removeBot,
  deposit,
  createAxonPublicClient,
  createAxonWalletClient,
  getChain,
} from './vault.js';

// Keystore utilities
export { encryptKeystore, decryptKeystore } from './keystore.js';
export type { KeystoreV3 } from './keystore.js';

// Token registry (shared by dashboard, relayer, and SDK consumers)
export { Token, KNOWN_TOKENS, DEFAULT_APPROVED_TOKENS, getKnownTokensForChain, getDefaultApprovedTokens, getTokenSymbolByAddress, resolveToken } from './tokens.js';
export type { KnownToken, KnownTokenSymbol } from './tokens.js';

// Amount conversion utilities
export { parseAmount, resolveTokenDecimals } from './amounts.js';

// EIP-3009 (USDC TransferWithAuthorization)
export { signTransferWithAuthorization, randomNonce, USDC_EIP712_DOMAIN } from './eip3009.js';
export type { TransferAuthorization } from './eip3009.js';

// Permit2 (universal ERC-20 approvals)
export {
  signPermit2WitnessTransfer,
  randomPermit2Nonce,
  PERMIT2_ADDRESS,
  X402_PROXY_ADDRESS,
  WITNESS_TYPE_STRING,
} from './permit2.js';
export type { Permit2Authorization } from './permit2.js';

// x402 protocol utilities
export {
  parsePaymentRequired,
  parseChainId,
  findMatchingOption,
  extractX402Metadata,
  formatPaymentSignature,
} from './x402.js';
export type { X402Resource, X402PaymentOption, X402PaymentRequired, X402HandleResult } from './x402.js';

// ABIs (useful for wagmi/viem integrations in frontends/dashboards)
export { AxonVaultAbi } from './abis/AxonVault.js';
export { AxonVaultFactoryAbi } from './abis/AxonVaultFactory.js';
export { AxonRegistryAbi } from './abis/AxonRegistry.js';
