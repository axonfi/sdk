import { describe, it, expect } from '@jest/globals';
import { keccak256, stringToBytes } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { signPayment, signExecuteIntent, signSwapIntent, encodeRef } from './signer.js';
import type { PaymentIntent, ExecuteIntent, SwapIntent } from './types.js';

// Deterministic test key — NOT a real key, for testing only
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
const TEST_VAULT = '0x1234567890abcdef1234567890abcdef12345678' as `0x${string}`;
const TEST_CHAIN_ID = 84532;

function makeWalletClient() {
  return createWalletClient({
    account: TEST_ACCOUNT,
    chain: baseSepolia,
    transport: http(),
  });
}

describe('encodeRef', () => {
  it('returns keccak256 of the UTF-8 encoded string', () => {
    const memo = 'API call #1234 — weather data';
    const expected = keccak256(stringToBytes(memo));
    expect(encodeRef(memo)).toBe(expected);
  });

  it('returns a 66-character hex string (0x + 64 hex chars)', () => {
    const result = encodeRef('hello');
    expect(result).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('returns different hashes for different inputs', () => {
    expect(encodeRef('hello')).not.toBe(encodeRef('world'));
  });

  it('returns consistent output for the same input', () => {
    expect(encodeRef('test')).toBe(encodeRef('test'));
  });
});

describe('signPayment', () => {
  const intent: PaymentIntent = {
    bot: TEST_ACCOUNT.address,
    to: '0x000000000000000000000000000000000000dead' as `0x${string}`,
    token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`,
    amount: 1_000_000n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    ref: encodeRef('test payment'),
  };

  it('returns a valid EIP-712 signature', async () => {
    const walletClient = makeWalletClient();
    const sig = await signPayment(walletClient, TEST_VAULT, TEST_CHAIN_ID, intent);
    expect(sig).toMatch(/^0x[0-9a-fA-F]{130}$/);
  });

  it('produces deterministic signatures for the same intent', async () => {
    const walletClient = makeWalletClient();
    const sig1 = await signPayment(walletClient, TEST_VAULT, TEST_CHAIN_ID, intent);
    const sig2 = await signPayment(walletClient, TEST_VAULT, TEST_CHAIN_ID, intent);
    expect(sig1).toBe(sig2);
  });

  it('throws if walletClient has no account', async () => {
    const noAccountClient = createWalletClient({
      chain: baseSepolia,
      transport: http(),
    });
    await expect(signPayment(noAccountClient, TEST_VAULT, TEST_CHAIN_ID, intent)).rejects.toThrow(
      'walletClient has no account',
    );
  });
});

describe('signExecuteIntent', () => {
  const intent: ExecuteIntent = {
    bot: TEST_ACCOUNT.address,
    protocol: '0x000000000000000000000000000000000000beef' as `0x${string}`,
    calldataHash: keccak256('0x1234'),
    token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`,
    amount: 500_000n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    ref: encodeRef('test execute'),
  };

  it('returns a valid EIP-712 signature', async () => {
    const walletClient = makeWalletClient();
    const sig = await signExecuteIntent(walletClient, TEST_VAULT, TEST_CHAIN_ID, intent);
    expect(sig).toMatch(/^0x[0-9a-fA-F]{130}$/);
  });
});

describe('signSwapIntent', () => {
  const intent: SwapIntent = {
    bot: TEST_ACCOUNT.address,
    toToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`,
    minToAmount: 900_000n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    ref: encodeRef('test swap'),
  };

  it('returns a valid EIP-712 signature', async () => {
    const walletClient = makeWalletClient();
    const sig = await signSwapIntent(walletClient, TEST_VAULT, TEST_CHAIN_ID, intent);
    expect(sig).toMatch(/^0x[0-9a-fA-F]{130}$/);
  });
});
