import { type Address, type Hex, encodePacked, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { USDC } from './constants.js';

// ============================================================================
// EIP-3009 TransferWithAuthorization — USDC only
// ============================================================================

/**
 * Per-chain EIP-712 domain parameters for USDC's EIP-3009 implementation.
 * These differ between testnets and mainnets (Circle uses different `name` values).
 *
 * Verified on-chain via `cast call <usdc> "name()(string)"` and
 * `cast call <usdc> "version()(string)"`.
 */
export const USDC_EIP712_DOMAIN: Record<number, { name: string; version: string }> = {
  // Base mainnet
  8453: { name: 'USD Coin', version: '2' },
  // Base Sepolia
  84532: { name: 'USDC', version: '2' },
  // Arbitrum One
  42161: { name: 'USD Coin', version: '2' },
  // Arbitrum Sepolia (same as mainnet convention)
  421614: { name: 'USDC', version: '2' },
};

/** EIP-712 types for TransferWithAuthorization (EIP-3009). */
const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

/** Parameters for EIP-3009 TransferWithAuthorization. */
export interface TransferAuthorization {
  /** Token holder (sender). */
  from: Address;
  /** Recipient of the transfer. */
  to: Address;
  /** Amount in token base units (USDC: 6 decimals). */
  value: bigint;
  /** Unix timestamp — transfer is invalid before this time. Usually 0. */
  validAfter: bigint;
  /** Unix timestamp — transfer is invalid after this time. */
  validBefore: bigint;
  /** Random bytes32 nonce (must not have been used before for this sender). */
  nonce: Hex;
}

/**
 * Generate a random bytes32 nonce for EIP-3009.
 * Uses crypto.getRandomValues for cryptographic randomness.
 */
export function randomNonce(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex;
}

/**
 * Sign an EIP-3009 TransferWithAuthorization for USDC.
 *
 * The resulting signature can be submitted to a facilitator contract that calls
 * `USDC.transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, v, r, s)`.
 *
 * @param privateKey - Signer's private key (must match auth.from)
 * @param chainId - Chain ID (determines USDC domain name/version)
 * @param auth - Transfer authorization parameters
 * @returns EIP-712 signature (65 bytes, 0x-prefixed)
 */
export async function signTransferWithAuthorization(
  privateKey: Hex,
  chainId: number,
  auth: TransferAuthorization,
): Promise<Hex> {
  const domainConfig = USDC_EIP712_DOMAIN[chainId];
  if (!domainConfig) {
    throw new Error(`EIP-3009 not configured for chain ${chainId}`);
  }

  const usdcAddress = USDC[chainId];
  if (!usdcAddress) {
    throw new Error(`USDC address not known for chain ${chainId}`);
  }

  const account = privateKeyToAccount(privateKey);

  return account.signTypedData({
    domain: {
      name: domainConfig.name,
      version: domainConfig.version,
      chainId,
      verifyingContract: usdcAddress,
    },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: {
      from: auth.from,
      to: auth.to,
      value: auth.value,
      validAfter: auth.validAfter,
      validBefore: auth.validBefore,
      nonce: auth.nonce,
    },
  });
}
