import type { Address, Hex } from 'viem';
import { USDC } from './constants.js';

// ============================================================================
// x402 Protocol Types
// ============================================================================

/** Resource descriptor from the x402 PAYMENT-REQUIRED header. */
export interface X402Resource {
  /** URL of the resource being unlocked. */
  url: string;
  /** Human-readable description of the resource. */
  description?: string;
  /** MIME type of the resource. */
  mimeType?: string;
}

/** A single payment option from the `accepts` array. */
export interface X402PaymentOption {
  /** Recipient address (merchant). */
  payTo: string;
  /** Amount in token base units (string). */
  amount: string;
  /** Token contract address. */
  asset: string;
  /** CAIP-2 network identifier, e.g. "eip155:8453". */
  network: string;
  /** Settlement scheme: "exact" (EIP-3009) or "permit2". */
  scheme?: string;
  /** Additional option-specific fields. */
  extra?: Record<string, unknown>;
}

/** Parsed x402 PAYMENT-REQUIRED response. */
export interface X402PaymentRequired {
  /** x402 protocol version. */
  x402Version: number;
  /** Resource being unlocked. */
  resource: X402Resource;
  /** Accepted payment options. */
  accepts: X402PaymentOption[];
}

/** Result of handlePaymentRequired — contains everything needed to retry the request. */
export interface X402HandleResult {
  /** Base64-encoded JSON for the PAYMENT-SIGNATURE header. */
  paymentSignature: string;
  /** The payment option that was selected and funded. */
  selectedOption: X402PaymentOption;
  /** Axon payment result (txHash, requestId, etc.). */
  fundingResult: { requestId: string; status: string; txHash?: string };
}

// ============================================================================
// Parsing & Matching
// ============================================================================

/**
 * Parse the PAYMENT-REQUIRED header value (base64 JSON).
 *
 * The x402 spec encodes the payment requirements as a base64-encoded JSON
 * string in the response header.
 */
export function parsePaymentRequired(headerValue: string): X402PaymentRequired {
  let decoded: string;

  // Handle both base64 and plain JSON
  try {
    decoded = atob(headerValue);
  } catch {
    decoded = headerValue;
  }

  const parsed = JSON.parse(decoded);

  if (!parsed.accepts || !Array.isArray(parsed.accepts) || parsed.accepts.length === 0) {
    throw new Error('x402: no payment options in PAYMENT-REQUIRED header');
  }

  if (!parsed.resource) {
    throw new Error('x402: missing resource in PAYMENT-REQUIRED header');
  }

  return parsed as X402PaymentRequired;
}

/**
 * Parse a CAIP-2 network identifier to a numeric chain ID.
 *
 * @example parseChainId("eip155:8453") // → 8453
 * @example parseChainId("eip155:84532") // → 84532
 */
export function parseChainId(network: string): number {
  const parts = network.split(':');
  if (parts.length !== 2 || parts[0] !== 'eip155') {
    throw new Error(`x402: unsupported network format "${network}" (expected "eip155:<chainId>")`);
  }
  const chainId = parseInt(parts[1]!, 10);
  if (isNaN(chainId)) {
    throw new Error(`x402: invalid chain ID in network "${network}"`);
  }
  return chainId;
}

/**
 * Find a payment option matching the bot's chain ID.
 *
 * Prefers USDC options (EIP-3009 path — no gas needed from bot).
 * Falls back to any matching chain option.
 *
 * @returns The best matching payment option, or null if none match.
 */
export function findMatchingOption(accepts: X402PaymentOption[], chainId: number): X402PaymentOption | null {
  const matchingOptions: X402PaymentOption[] = [];

  for (const option of accepts) {
    try {
      const optionChainId = parseChainId(option.network);
      if (optionChainId === chainId) {
        matchingOptions.push(option);
      }
    } catch {
      // Skip options with unparseable network identifiers
      continue;
    }
  }

  if (matchingOptions.length === 0) return null;

  // Prefer USDC (EIP-3009 — gasless for bot)
  const usdcAddress = USDC[chainId]?.toLowerCase();
  if (usdcAddress) {
    const usdcOption = matchingOptions.find((opt) => opt.asset.toLowerCase() === usdcAddress);
    if (usdcOption) return usdcOption;
  }

  // Fall back to first matching option
  return matchingOptions[0] ?? null;
}

/**
 * Extract metadata fields from a parsed x402 header for payment enrichment.
 *
 * These fields flow into the Axon payment record, giving vault owners
 * full visibility into what their bots are accessing.
 */
export function extractX402Metadata(
  parsed: X402PaymentRequired,
  selectedOption: X402PaymentOption,
): {
  resourceUrl: string;
  memo: string | null;
  recipientLabel: string | null;
  metadata: Record<string, string>;
} {
  const metadata: Record<string, string> = {};

  if (parsed.x402Version !== undefined) {
    metadata.x402_version = String(parsed.x402Version);
  }
  if (selectedOption.scheme) {
    metadata.x402_scheme = selectedOption.scheme;
  }
  if (parsed.resource.mimeType) {
    metadata.x402_mime_type = parsed.resource.mimeType;
  }
  if (selectedOption.payTo) {
    metadata.x402_merchant = selectedOption.payTo;
  }
  if (parsed.resource.description) {
    metadata.x402_resource_description = parsed.resource.description;
  }

  return {
    resourceUrl: parsed.resource.url,
    memo: parsed.resource.description ?? null,
    recipientLabel: selectedOption.payTo
      ? `${selectedOption.payTo.slice(0, 6)}...${selectedOption.payTo.slice(-4)}`
      : null,
    metadata,
  };
}

// ============================================================================
// Response Formatting
// ============================================================================

/**
 * Format a payment signature payload for the PAYMENT-SIGNATURE header.
 *
 * The x402 spec requires the header value to be base64-encoded JSON.
 */
export function formatPaymentSignature(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  return btoa(json);
}
