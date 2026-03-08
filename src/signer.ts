import { keccak256, stringToBytes } from 'viem';
import type { WalletClient, Hex, Address } from 'viem';
import type { PaymentIntent, ExecuteIntent, SwapIntent } from './types.js';
import { EIP712_DOMAIN_NAME, EIP712_DOMAIN_VERSION } from './constants.js';

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
} as const;

// EIP-712 types for ExecuteIntent — DeFi protocol interactions.
const EXECUTE_INTENT_TYPES = {
  ExecuteIntent: [
    { name: 'bot', type: 'address' },
    { name: 'protocol', type: 'address' },
    { name: 'calldataHash', type: 'bytes32' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'value', type: 'uint256' },
    { name: 'extraTokens', type: 'address[]' },
    { name: 'extraAmounts', type: 'uint256[]' },
    { name: 'deadline', type: 'uint256' },
    { name: 'ref', type: 'bytes32' },
  ],
} as const;

// EIP-712 types for SwapIntent — in-vault token rebalancing.
const SWAP_INTENT_TYPES = {
  SwapIntent: [
    { name: 'bot', type: 'address' },
    { name: 'toToken', type: 'address' },
    { name: 'minToAmount', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'ref', type: 'bytes32' },
  ],
} as const;

function makeDomain(vaultAddress: Address, chainId: number) {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract: vaultAddress,
  } as const;
}

/**
 * Sign a PaymentIntent using EIP-712 typed structured data.
 *
 * The resulting signature can be submitted to the Axon relayer API, which
 * passes it to AxonVault.executePayment() on-chain.
 */
export async function signPayment(
  walletClient: WalletClient,
  vaultAddress: Address,
  chainId: number,
  intent: PaymentIntent,
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error('walletClient has no account attached');
  }

  return walletClient.signTypedData({
    account: walletClient.account,
    domain: makeDomain(vaultAddress, chainId),
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
  });
}

/**
 * Sign an ExecuteIntent using EIP-712 typed structured data.
 *
 * The resulting signature can be submitted to the Axon relayer API, which
 * passes it to AxonVault.executeProtocol() on-chain.
 */
export async function signExecuteIntent(
  walletClient: WalletClient,
  vaultAddress: Address,
  chainId: number,
  intent: ExecuteIntent,
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error('walletClient has no account attached');
  }

  return walletClient.signTypedData({
    account: walletClient.account,
    domain: makeDomain(vaultAddress, chainId),
    types: EXECUTE_INTENT_TYPES,
    primaryType: 'ExecuteIntent',
    message: {
      bot: intent.bot,
      protocol: intent.protocol,
      calldataHash: intent.calldataHash,
      token: intent.token,
      amount: intent.amount,
      value: intent.value,
      extraTokens: intent.extraTokens,
      extraAmounts: intent.extraAmounts,
      deadline: intent.deadline,
      ref: intent.ref,
    },
  });
}

/**
 * Sign a SwapIntent using EIP-712 typed structured data.
 *
 * The resulting signature can be submitted to the Axon relayer API, which
 * passes it to AxonVault.executeSwap() on-chain.
 */
export async function signSwapIntent(
  walletClient: WalletClient,
  vaultAddress: Address,
  chainId: number,
  intent: SwapIntent,
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error('walletClient has no account attached');
  }

  return walletClient.signTypedData({
    account: walletClient.account,
    domain: makeDomain(vaultAddress, chainId),
    types: SWAP_INTENT_TYPES,
    primaryType: 'SwapIntent',
    message: {
      bot: intent.bot,
      toToken: intent.toToken,
      minToAmount: intent.minToAmount,
      deadline: intent.deadline,
      ref: intent.ref,
    },
  });
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
  return keccak256(stringToBytes(memo));
}
