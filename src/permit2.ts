import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ============================================================================
// Permit2 — Universal token approvals (any ERC-20)
// ============================================================================

/** Canonical Permit2 contract address (same on all EVM chains). */
export const PERMIT2_ADDRESS: Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';

/** x402 facilitator proxy contract address (same on all supported chains). */
export const X402_PROXY_ADDRESS: Address = '0x4020CD856C882D5fb903D99CE35316A085Bb0001';

/**
 * Witness type string for x402's PermitWitnessTransferFrom.
 * Must match what the x402 facilitator contract expects.
 */
export const WITNESS_TYPE_STRING =
  'TransferDetails witness)TokenPermissions(address token,uint256 amount)TransferDetails(address to,uint256 requestedAmount)' as const;

/** EIP-712 types for Permit2 PermitWitnessTransferFrom with x402 witness. */
const PERMIT_WITNESS_TRANSFER_FROM_TYPES = {
  PermitWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'witness', type: 'TransferDetails' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  TransferDetails: [
    { name: 'to', type: 'address' },
    { name: 'requestedAmount', type: 'uint256' },
  ],
} as const;

/** Parameters for Permit2 PermitWitnessTransferFrom. */
export interface Permit2Authorization {
  /** Token to transfer. */
  token: Address;
  /** Maximum amount the spender can transfer. */
  amount: bigint;
  /** Spender address (the x402 proxy). */
  spender: Address;
  /** Unique nonce (random uint256). */
  nonce: bigint;
  /** Unix timestamp — signature is invalid after this time. */
  deadline: bigint;
  /** Witness: recipient address. */
  witnessTo: Address;
  /** Witness: requested amount. */
  witnessRequestedAmount: bigint;
}

/**
 * Generate a random uint256 nonce for Permit2.
 * Uses crypto.getRandomValues for cryptographic randomness.
 */
export function randomPermit2Nonce(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let n = 0n;
  for (const b of bytes) {
    n = (n << 8n) | BigInt(b);
  }
  return n;
}

/**
 * Sign a Permit2 PermitWitnessTransferFrom for x402.
 *
 * The resulting signature is submitted to the x402 facilitator proxy,
 * which calls `Permit2.permitWitnessTransferFrom(...)` to settle the payment.
 *
 * @param privateKey - Signer's private key (token holder)
 * @param chainId - Chain ID
 * @param permit - Permit2 authorization parameters
 * @returns EIP-712 signature (65 bytes, 0x-prefixed)
 */
export async function signPermit2WitnessTransfer(
  privateKey: Hex,
  chainId: number,
  permit: Permit2Authorization,
): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);

  return account.signTypedData({
    domain: {
      name: 'Permit2',
      chainId,
      verifyingContract: PERMIT2_ADDRESS,
    },
    types: PERMIT_WITNESS_TRANSFER_FROM_TYPES,
    primaryType: 'PermitWitnessTransferFrom',
    message: {
      permitted: {
        token: permit.token,
        amount: permit.amount,
      },
      spender: permit.spender,
      nonce: permit.nonce,
      deadline: permit.deadline,
      witness: {
        to: permit.witnessTo,
        requestedAmount: permit.witnessRequestedAmount,
      },
    },
  });
}
