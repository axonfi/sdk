// ============================================================================
// Shared utilities
// ============================================================================

/**
 * Tiny UUID v4 generator (no external dependency).
 *
 * Uses `crypto.getRandomValues` in browsers and Node ≥19, with a
 * `require('crypto').randomBytes` fallback for older Node versions.
 */
export function generateUuid(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Node.js fallback
    const { randomBytes } = require('crypto') as typeof import('crypto');
    const buf = randomBytes(16);
    for (let i = 0; i < 16; i++) bytes[i] = buf[i] ?? 0;
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant bits
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
