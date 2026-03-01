import { parseUnits } from 'viem';
import type { Address } from 'viem';
import { KNOWN_TOKENS, getTokenSymbolByAddress, type KnownTokenSymbol } from './tokens.js';
import type { Token } from './tokens.js';

// ============================================================================
// Human-friendly amount conversion
// ============================================================================

/**
 * Look up decimals for a token by symbol, Token enum, or address.
 *
 * @param token - A KnownTokenSymbol ('USDC'), Token enum (Token.USDC), or address ('0x...')
 * @param chainId - Optional chain ID (unused for decimal lookup, but reserved for future use)
 * @returns The number of decimals for the token
 * @throws If the token is an unknown address with no entry in KNOWN_TOKENS
 */
export function resolveTokenDecimals(token: Address | Token | KnownTokenSymbol, chainId?: number): number {
  // If it looks like an address, reverse-lookup the symbol first
  if (typeof token === 'string' && token.startsWith('0x')) {
    const symbol = getTokenSymbolByAddress(token);
    if (!symbol) {
      throw new Error(
        `Unknown token address ${token} — cannot determine decimals. Use a bigint amount instead, or pass a known token symbol.`,
      );
    }
    const entry = KNOWN_TOKENS[symbol as KnownTokenSymbol];
    return entry.decimals;
  }

  // Symbol or Token enum
  const entry = KNOWN_TOKENS[token as KnownTokenSymbol];
  if (!entry) {
    throw new Error(
      `Unknown token symbol "${token}" — cannot determine decimals. Use a bigint amount instead, or use a known symbol (${Object.keys(KNOWN_TOKENS).join(', ')}).`,
    );
  }
  return entry.decimals;
}

/**
 * Convert a human-friendly amount to raw base units (bigint).
 *
 * - **bigint** → passed through as-is (already in base units)
 * - **number** → converted to string, then parsed via `parseUnits(str, decimals)`
 * - **string** → parsed directly via `parseUnits(str, decimals)`
 *
 * @param amount - The amount as bigint (raw), number (human), or string (human)
 * @param token - Token identifier used to look up decimals (symbol, enum, or address)
 * @param chainId - Optional chain ID (passed to resolveTokenDecimals)
 * @returns The amount in token base units as bigint
 *
 * @example
 * ```ts
 * parseAmount(5_000_000n, 'USDC')     // 5000000n (passthrough)
 * parseAmount(5.2, 'USDC')            // 5200000n
 * parseAmount('5.2', 'USDC')          // 5200000n
 * parseAmount(0.001, 'WETH')          // 1000000000000000n
 * ```
 *
 * @throws If the amount has more decimal places than the token supports
 * @throws If the token is unknown and amount is not bigint
 */
export function parseAmount(
  amount: bigint | number | string,
  token: Address | Token | KnownTokenSymbol,
  chainId?: number,
): bigint {
  // bigint = raw base units, pass through
  if (typeof amount === 'bigint') {
    return amount;
  }

  const decimals = resolveTokenDecimals(token, chainId);

  // Convert number to string first
  const str = typeof amount === 'number' ? amount.toString() : amount;

  // Validate precision: count decimal places in the string
  const dotIndex = str.indexOf('.');
  if (dotIndex !== -1) {
    const decimalPlaces = str.length - dotIndex - 1;
    if (decimalPlaces > decimals) {
      throw new Error(
        `Amount "${str}" has ${decimalPlaces} decimal places, but ${typeof token === 'string' && token.startsWith('0x') ? 'this token' : token} only supports ${decimals}. Truncate or round your amount.`,
      );
    }
  }

  return parseUnits(str, decimals);
}
