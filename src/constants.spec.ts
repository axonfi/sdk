import { describe, it, expect } from '@jest/globals';
import { isAddress } from 'viem';
import {
  USDC,
  NATIVE_ETH,
  SUPPORTED_CHAIN_IDS,
  WINDOW,
  DEFAULT_DEADLINE_SECONDS,
  PAYMENT_INTENT_TYPEHASH,
  EXECUTE_INTENT_TYPEHASH,
  SWAP_INTENT_TYPEHASH,
  EIP712_DOMAIN_NAME,
  EIP712_DOMAIN_VERSION,
  PaymentErrorCode,
  RELAYER_API,
  ALLOWED_WINDOWS,
} from './constants.js';

describe('USDC addresses', () => {
  it('has entries for all supported chain IDs', () => {
    for (const chainId of SUPPORTED_CHAIN_IDS) {
      expect(USDC[chainId]).toBeDefined();
    }
  });

  it('all addresses are valid checksummed addresses', () => {
    for (const addr of Object.values(USDC)) {
      expect(isAddress(addr, { strict: true })).toBe(true);
    }
  });
});

describe('NATIVE_ETH', () => {
  it('is the standard sentinel address', () => {
    expect(NATIVE_ETH.toLowerCase()).toBe('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
  });
});

describe('SUPPORTED_CHAIN_IDS', () => {
  it('contains Base mainnet and Sepolia', () => {
    expect(SUPPORTED_CHAIN_IDS).toContain(8453);
    expect(SUPPORTED_CHAIN_IDS).toContain(84532);
  });

  it('contains Arbitrum mainnet and Sepolia', () => {
    expect(SUPPORTED_CHAIN_IDS).toContain(42161);
    expect(SUPPORTED_CHAIN_IDS).toContain(421614);
  });
});

describe('WINDOW constants', () => {
  it('ONE_HOUR is 3600 seconds', () => {
    expect(WINDOW.ONE_HOUR).toBe(3600n);
  });

  it('ONE_DAY is 86400 seconds', () => {
    expect(WINDOW.ONE_DAY).toBe(86400n);
  });

  it('ONE_WEEK is 604800 seconds', () => {
    expect(WINDOW.ONE_WEEK).toBe(604800n);
  });

  it('THREE_HOURS is 10800 seconds', () => {
    expect(WINDOW.THREE_HOURS).toBe(10800n);
  });

  it('THIRTY_DAYS is 2592000 seconds', () => {
    expect(WINDOW.THIRTY_DAYS).toBe(2592000n);
  });

  it('ALLOWED_WINDOWS contains exactly the 5 allowed values', () => {
    expect(ALLOWED_WINDOWS.size).toBe(5);
    expect(ALLOWED_WINDOWS.has(WINDOW.ONE_HOUR)).toBe(true);
    expect(ALLOWED_WINDOWS.has(WINDOW.THREE_HOURS)).toBe(true);
    expect(ALLOWED_WINDOWS.has(WINDOW.ONE_DAY)).toBe(true);
    expect(ALLOWED_WINDOWS.has(WINDOW.ONE_WEEK)).toBe(true);
    expect(ALLOWED_WINDOWS.has(WINDOW.THIRTY_DAYS)).toBe(true);
    expect(ALLOWED_WINDOWS.has(86401n)).toBe(false);
  });
});

describe('DEFAULT_DEADLINE_SECONDS', () => {
  it('is 5 minutes (300 seconds)', () => {
    expect(DEFAULT_DEADLINE_SECONDS).toBe(300);
  });
});

describe('EIP-712 type hashes', () => {
  it('PAYMENT_INTENT_TYPEHASH is a 0x-prefixed 66-char hex string', () => {
    expect(PAYMENT_INTENT_TYPEHASH).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('EXECUTE_INTENT_TYPEHASH is a 0x-prefixed 66-char hex string', () => {
    expect(EXECUTE_INTENT_TYPEHASH).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('SWAP_INTENT_TYPEHASH is a 0x-prefixed 66-char hex string', () => {
    expect(SWAP_INTENT_TYPEHASH).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('all three type hashes are distinct', () => {
    expect(new Set([PAYMENT_INTENT_TYPEHASH, EXECUTE_INTENT_TYPEHASH, SWAP_INTENT_TYPEHASH]).size).toBe(3);
  });
});

describe('EIP-712 domain', () => {
  it('name is AxonVault', () => {
    expect(EIP712_DOMAIN_NAME).toBe('AxonVault');
  });

  it('version is 1', () => {
    expect(EIP712_DOMAIN_VERSION).toBe('1');
  });
});

describe('PaymentErrorCode', () => {
  it('contains expected error codes', () => {
    expect(PaymentErrorCode.SELF_PAYMENT).toBe('SELF_PAYMENT');
    expect(PaymentErrorCode.BLACKLISTED).toBe('BLACKLISTED');
    expect(PaymentErrorCode.INSUFFICIENT_BALANCE).toBe('INSUFFICIENT_BALANCE');
    expect(PaymentErrorCode.SIMULATION_FAILED).toBe('SIMULATION_FAILED');
  });

  it('has at least 15 error codes', () => {
    expect(Object.keys(PaymentErrorCode).length).toBeGreaterThanOrEqual(15);
  });
});

describe('RELAYER_API', () => {
  it('static paths start with /v1/', () => {
    expect(RELAYER_API.PAYMENTS).toBe('/v1/payments');
    expect(RELAYER_API.EXECUTE).toBe('/v1/execute');
    expect(RELAYER_API.SWAP).toBe('/v1/swap');
  });

  it('dynamic paths include the request ID', () => {
    expect(RELAYER_API.payment('abc-123')).toBe('/v1/payments/abc-123');
    expect(RELAYER_API.execute('abc-123')).toBe('/v1/execute/abc-123');
    expect(RELAYER_API.swap('abc-123')).toBe('/v1/swap/abc-123');
  });
});
