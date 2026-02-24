import { keccak256, stringToBytes } from 'viem'
import type { WalletClient, Hex, Address } from 'viem'
import type { PaymentIntent } from './types.js'
import { EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION } from './constants.js'

// EIP-712 types for PaymentIntent — field order matches the Solidity struct exactly.
const PAYMENT_INTENT_TYPES = {
  PaymentIntent: [
    { name: 'bot', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'ref', type: 'bytes32' },
  ],
} as const

/**
 * Sign a PaymentIntent using EIP-712 typed structured data.
 *
 * The resulting signature can be submitted to the Axon relayer API, which
 * passes it to AxonVault.executePayment() or executeSwapAndPay() on-chain.
 *
 * @param walletClient  viem WalletClient with a connected account (the bot key).
 * @param vaultAddress  Address of the AxonVault contract (acts as verifyingContract).
 * @param chainId       Chain ID the vault is deployed on (included in the EIP-712 domain).
 * @param intent        PaymentIntent struct to sign. All fields must be populated.
 * @returns             65-byte signature (r + s + v) as a 0x-prefixed hex string.
 */
export async function signPayment(
  walletClient: WalletClient,
  vaultAddress: Address,
  chainId: number,
  intent: PaymentIntent,
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error('walletClient has no account attached')
  }

  return walletClient.signTypedData({
    account: walletClient.account,
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract: vaultAddress,
    },
    types: PAYMENT_INTENT_TYPES,
    primaryType: 'PaymentIntent',
    message: {
      bot: intent.bot,
      to: intent.to,
      token: intent.token,
      amount: intent.amount,
      deadline: intent.deadline,
      ref: intent.ref,
    },
  })
}

/**
 * Derive the on-chain `ref` bytes32 from a human-readable memo string.
 *
 * The full memo text is stored off-chain by the relayer (PostgreSQL), linked
 * to the transaction. The keccak256 hash goes into the signed PaymentIntent
 * and is emitted in the PaymentExecuted on-chain event.
 *
 * @param memo  Human-readable description, e.g. "API call #1234 — weather data"
 * @returns     keccak256 hash of the UTF-8 encoded memo, as a bytes32 hex.
 */
export function encodeRef(memo: string): Hex {
  return keccak256(stringToBytes(memo))
}
