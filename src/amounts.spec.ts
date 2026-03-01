import { describe, it, expect } from '@jest/globals';
import { parseAmount, resolveTokenDecimals } from './amounts.js';
import { Token } from './tokens.js';
import type { Address } from 'viem';

// ---------------------------------------------------------------------------
// resolveTokenDecimals
// ---------------------------------------------------------------------------

describe('resolveTokenDecimals', () => {
  it('resolves by KnownTokenSymbol string', () => {
    expect(resolveTokenDecimals('USDC')).toBe(6);
    expect(resolveTokenDecimals('WETH')).toBe(18);
    expect(resolveTokenDecimals('WBTC')).toBe(8);
  });

  it('resolves by Token enum', () => {
    expect(resolveTokenDecimals(Token.USDC)).toBe(6);
    expect(resolveTokenDecimals(Token.DAI)).toBe(18);
  });

  it('resolves by known address (reverse lookup)', () => {
    // Base USDC
    expect(resolveTokenDecimals('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address)).toBe(6);
    // Arbitrum WETH
    expect(resolveTokenDecimals('0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address)).toBe(18);
  });

  it('throws for unknown address', () => {
    expect(() => resolveTokenDecimals('0x0000000000000000000000000000000000000001' as Address)).toThrow(
      'Unknown token address',
    );
  });

  it('throws for unknown symbol', () => {
    expect(() => resolveTokenDecimals('NOTREAL' as any)).toThrow('Unknown token symbol');
  });
});

// ---------------------------------------------------------------------------
// parseAmount
// ---------------------------------------------------------------------------

describe('parseAmount', () => {
  // bigint passthrough
  it('passes bigint through unchanged', () => {
    expect(parseAmount(5_000_000n, 'USDC')).toBe(5_000_000n);
    expect(parseAmount(0n, 'WETH')).toBe(0n);
  });

  // number → bigint
  it('converts number to base units for USDC (6 decimals)', () => {
    expect(parseAmount(5, 'USDC')).toBe(5_000_000n);
    expect(parseAmount(5.2, 'USDC')).toBe(5_200_000n);
    expect(parseAmount(0.01, 'USDC')).toBe(10_000n);
  });

  it('converts number to base units for WETH (18 decimals)', () => {
    expect(parseAmount(1, 'WETH')).toBe(1_000_000_000_000_000_000n);
    expect(parseAmount(0.001, 'WETH')).toBe(1_000_000_000_000_000n);
  });

  it('converts number to base units for WBTC (8 decimals)', () => {
    expect(parseAmount(1, 'WBTC')).toBe(100_000_000n);
    expect(parseAmount(0.5, Token.WBTC)).toBe(50_000_000n);
  });

  // string → bigint
  it('converts string to base units', () => {
    expect(parseAmount('5.2', 'USDC')).toBe(5_200_000n);
    expect(parseAmount('100', 'USDC')).toBe(100_000_000n);
    expect(parseAmount('0.123456', 'USDC')).toBe(123_456n);
  });

  // Token enum
  it('works with Token enum as token identifier', () => {
    expect(parseAmount(10, Token.USDC)).toBe(10_000_000n);
    expect(parseAmount('0.5', Token.WETH)).toBe(500_000_000_000_000_000n);
  });

  // Known address reverse lookup
  it('works with known address as token identifier', () => {
    const usdcBase = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
    expect(parseAmount(5, usdcBase)).toBe(5_000_000n);
  });

  // Edge cases
  it('handles zero', () => {
    expect(parseAmount(0, 'USDC')).toBe(0n);
    expect(parseAmount('0', 'USDC')).toBe(0n);
    expect(parseAmount('0.0', 'USDC')).toBe(0n);
  });

  it('handles whole numbers as string', () => {
    expect(parseAmount('100', 'USDC')).toBe(100_000_000n);
  });

  // Error: excess precision
  it('throws if number has more decimals than token supports', () => {
    expect(() => parseAmount('5.1234567', 'USDC')).toThrow('7 decimal places');
    expect(() => parseAmount('1.123456789012345678901', 'WETH')).toThrow('21 decimal places');
  });

  // Error: unknown address with non-bigint
  it('throws for unknown address with human-readable amount', () => {
    expect(() => parseAmount(5, '0x0000000000000000000000000000000000000001' as Address)).toThrow(
      'Unknown token address',
    );
  });

  // bigint with unknown address should still work (passthrough)
  it('passes bigint through even for unknown address', () => {
    expect(parseAmount(5_000_000n, '0x0000000000000000000000000000000000000001' as Address)).toBe(5_000_000n);
  });
});
