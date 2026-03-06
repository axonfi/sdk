import { describe, it, expect } from '@jest/globals';
import { recoverTypedDataAddress } from 'viem';
import type { Address, Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  parsePaymentRequired,
  parseChainId,
  findMatchingOption,
  extractX402Metadata,
  formatPaymentSignature,
} from './x402.js';
import type { X402PaymentRequired, X402PaymentOption } from './x402.js';
import { signTransferWithAuthorization, randomNonce, USDC_EIP712_DOMAIN } from './eip3009.js';
import type { TransferAuthorization } from './eip3009.js';
import { signPermit2WitnessTransfer, randomPermit2Nonce, PERMIT2_ADDRESS, X402_PROXY_ADDRESS } from './permit2.js';
import type { Permit2Authorization } from './permit2.js';
import { USDC } from './constants.js';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const BOT_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const BOT_ACCOUNT = privateKeyToAccount(BOT_KEY);
const BOT_ADDRESS = BOT_ACCOUNT.address;
const MERCHANT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;
const CHAIN_ID = 84532; // Base Sepolia
const USDC_ADDRESS = USDC[CHAIN_ID] as Address;

function makeParsedHeader(overrides?: Partial<X402PaymentRequired>): X402PaymentRequired {
  return {
    x402Version: 1,
    resource: {
      url: 'https://weather-api.example.com/forecast',
      description: 'Premium weather forecast data',
      mimeType: 'application/json',
    },
    accepts: [
      {
        payTo: MERCHANT,
        amount: '1000000',
        asset: USDC_ADDRESS,
        network: `eip155:${CHAIN_ID}`,
        scheme: 'exact',
      },
    ],
    ...overrides,
  };
}

function encodeHeader(parsed: X402PaymentRequired): string {
  return btoa(JSON.stringify(parsed));
}

// ============================================================================
// x402 Header Parsing
// ============================================================================

describe('parsePaymentRequired', () => {
  it('parses base64-encoded header', () => {
    const header = encodeHeader(makeParsedHeader());
    const result = parsePaymentRequired(header);
    expect(result.x402Version).toBe(1);
    expect(result.resource.url).toBe('https://weather-api.example.com/forecast');
    expect(result.accepts).toHaveLength(1);
    expect(result.accepts[0]!.payTo).toBe(MERCHANT);
  });

  it('parses plain JSON header', () => {
    const raw = JSON.stringify(makeParsedHeader());
    const result = parsePaymentRequired(raw);
    expect(result.resource.url).toBe('https://weather-api.example.com/forecast');
  });

  it('throws on missing accepts', () => {
    const header = btoa(JSON.stringify({ resource: { url: 'test' } }));
    expect(() => parsePaymentRequired(header)).toThrow('no payment options');
  });

  it('throws on empty accepts', () => {
    const header = btoa(JSON.stringify({ resource: { url: 'test' }, accepts: [] as unknown[] }));
    expect(() => parsePaymentRequired(header)).toThrow('no payment options');
  });

  it('throws on missing resource', () => {
    const header = btoa(
      JSON.stringify({ accepts: [{ payTo: MERCHANT, amount: '100', asset: USDC_ADDRESS, network: 'eip155:84532' }] }),
    );
    expect(() => parsePaymentRequired(header)).toThrow('missing resource');
  });

  it('parses header with multiple accepts options', () => {
    const parsed = makeParsedHeader({
      accepts: [
        { payTo: MERCHANT, amount: '1000000', asset: USDC_ADDRESS, network: 'eip155:84532', scheme: 'exact' },
        { payTo: MERCHANT, amount: '500000000000000', asset: '0xWETH', network: 'eip155:8453', scheme: 'permit2' },
        { payTo: MERCHANT, amount: '2000000', asset: USDC_ADDRESS, network: 'eip155:42161', scheme: 'exact' },
      ],
    });
    const header = encodeHeader(parsed);
    const result = parsePaymentRequired(header);
    expect(result.accepts).toHaveLength(3);
  });
});

// ============================================================================
// CAIP-2 Chain ID Parsing
// ============================================================================

describe('parseChainId', () => {
  it('parses eip155:8453', () => {
    expect(parseChainId('eip155:8453')).toBe(8453);
  });

  it('parses eip155:84532', () => {
    expect(parseChainId('eip155:84532')).toBe(84532);
  });

  it('parses eip155:42161', () => {
    expect(parseChainId('eip155:42161')).toBe(42161);
  });

  it('throws on non-eip155 namespace', () => {
    expect(() => parseChainId('solana:mainnet')).toThrow('unsupported network format');
  });

  it('throws on invalid format', () => {
    expect(() => parseChainId('8453')).toThrow('unsupported network format');
  });

  it('throws on non-numeric chain ID', () => {
    expect(() => parseChainId('eip155:base')).toThrow('invalid chain ID');
  });
});

// ============================================================================
// Chain Matching + USDC Preference
// ============================================================================

describe('findMatchingOption', () => {
  it('returns USDC option when available', () => {
    const accepts: X402PaymentOption[] = [
      {
        payTo: MERCHANT,
        amount: '500000000000000',
        asset: '0x4200000000000000000000000000000000000006',
        network: 'eip155:84532',
        scheme: 'permit2',
      },
      { payTo: MERCHANT, amount: '1000000', asset: USDC_ADDRESS, network: 'eip155:84532', scheme: 'exact' },
    ];
    const result = findMatchingOption(accepts, CHAIN_ID);
    expect(result).not.toBeNull();
    expect(result!.asset).toBe(USDC_ADDRESS);
    expect(result!.scheme).toBe('exact');
  });

  it('falls back to non-USDC option on matching chain', () => {
    const wethAddress = '0x4200000000000000000000000000000000000006';
    const accepts: X402PaymentOption[] = [
      { payTo: MERCHANT, amount: '500000000000000', asset: wethAddress, network: 'eip155:84532', scheme: 'permit2' },
    ];
    const result = findMatchingOption(accepts, CHAIN_ID);
    expect(result).not.toBeNull();
    expect(result!.asset).toBe(wethAddress);
  });

  it('returns null when no chain matches', () => {
    const accepts: X402PaymentOption[] = [
      { payTo: MERCHANT, amount: '1000000', asset: USDC_ADDRESS, network: 'eip155:8453' },
    ];
    const result = findMatchingOption(accepts, CHAIN_ID); // 84532 ≠ 8453
    expect(result).toBeNull();
  });

  it('skips options with invalid network format', () => {
    const accepts: X402PaymentOption[] = [
      { payTo: MERCHANT, amount: '1000000', asset: USDC_ADDRESS, network: 'invalid' },
      { payTo: MERCHANT, amount: '1000000', asset: USDC_ADDRESS, network: 'eip155:84532' },
    ];
    const result = findMatchingOption(accepts, CHAIN_ID);
    expect(result).not.toBeNull();
    expect(result!.network).toBe('eip155:84532');
  });

  it('handles USDC address case-insensitivity', () => {
    const accepts: X402PaymentOption[] = [
      { payTo: MERCHANT, amount: '1000000', asset: USDC_ADDRESS.toUpperCase(), network: 'eip155:84532' },
    ];
    const result = findMatchingOption(accepts, CHAIN_ID);
    expect(result).not.toBeNull();
  });
});

// ============================================================================
// Metadata Extraction
// ============================================================================

describe('extractX402Metadata', () => {
  it('extracts all metadata fields', () => {
    const parsed = makeParsedHeader();
    const option = parsed.accepts[0]!;
    const meta = extractX402Metadata(parsed, option);

    expect(meta.resourceUrl).toBe('https://weather-api.example.com/forecast');
    expect(meta.memo).toBe('Premium weather forecast data');
    expect(meta.recipientLabel).toMatch(/^0x7099\.\.\.79C8$/);
    expect(meta.metadata.x402_version).toBe('1');
    expect(meta.metadata.x402_scheme).toBe('exact');
    expect(meta.metadata.x402_mime_type).toBe('application/json');
    expect(meta.metadata.x402_merchant).toBe(MERCHANT);
    expect(meta.metadata.x402_resource_description).toBe('Premium weather forecast data');
  });

  it('handles missing optional fields', () => {
    const parsed: X402PaymentRequired = {
      x402Version: 1,
      resource: { url: 'https://example.com' },
      accepts: [{ payTo: MERCHANT, amount: '100', asset: USDC_ADDRESS, network: 'eip155:84532' }],
    };
    const meta = extractX402Metadata(parsed, parsed.accepts[0]!);

    expect(meta.resourceUrl).toBe('https://example.com');
    expect(meta.memo).toBeNull();
    expect(meta.metadata.x402_scheme).toBeUndefined();
    expect(meta.metadata.x402_mime_type).toBeUndefined();
  });
});

// ============================================================================
// Header Format Roundtrip
// ============================================================================

describe('formatPaymentSignature', () => {
  it('encodes payload as base64 JSON', () => {
    const payload = { scheme: 'exact', signature: '0xabc', authorization: { from: BOT_ADDRESS } };
    const encoded = formatPaymentSignature(payload);
    const decoded = JSON.parse(atob(encoded));
    expect(decoded.scheme).toBe('exact');
    expect(decoded.signature).toBe('0xabc');
    expect(decoded.authorization.from).toBe(BOT_ADDRESS);
  });

  it('roundtrips complex payloads', () => {
    const payload = {
      scheme: 'permit2',
      signature: '0x' + 'ab'.repeat(65),
      permit: { nonce: '12345', deadline: '999999' },
      witness: { to: MERCHANT, requestedAmount: '1000000' },
    };
    const encoded = formatPaymentSignature(payload);
    const decoded = JSON.parse(atob(encoded));
    expect(decoded).toEqual(payload);
  });
});

// ============================================================================
// EIP-3009 Signing
// ============================================================================

describe('signTransferWithAuthorization', () => {
  it('produces a valid 65-byte signature', async () => {
    const auth: TransferAuthorization = {
      from: BOT_ADDRESS,
      to: MERCHANT,
      value: 1_000_000n,
      validAfter: 0n,
      validBefore: BigInt(Math.floor(Date.now() / 1000) + 300),
      nonce: randomNonce(),
    };

    const sig = await signTransferWithAuthorization(BOT_KEY, CHAIN_ID, auth);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it('signature recovers to the signer address', async () => {
    const auth: TransferAuthorization = {
      from: BOT_ADDRESS,
      to: MERCHANT,
      value: 1_000_000n,
      validAfter: 0n,
      validBefore: 999999999n,
      nonce: randomNonce(),
    };

    const sig = await signTransferWithAuthorization(BOT_KEY, CHAIN_ID, auth);
    const domainConfig = USDC_EIP712_DOMAIN[CHAIN_ID]!;

    const recovered = await recoverTypedDataAddress({
      domain: {
        name: domainConfig.name,
        version: domainConfig.version,
        chainId: CHAIN_ID,
        verifyingContract: USDC_ADDRESS,
      },
      types: {
        TransferWithAuthorization: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'validAfter', type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce', type: 'bytes32' },
        ],
      },
      primaryType: 'TransferWithAuthorization',
      message: {
        from: auth.from,
        to: auth.to,
        value: auth.value,
        validAfter: auth.validAfter,
        validBefore: auth.validBefore,
        nonce: auth.nonce,
      },
      signature: sig,
    });

    expect(recovered.toLowerCase()).toBe(BOT_ADDRESS.toLowerCase());
  });

  it('throws for unsupported chain', async () => {
    const auth: TransferAuthorization = {
      from: BOT_ADDRESS,
      to: MERCHANT,
      value: 1_000_000n,
      validAfter: 0n,
      validBefore: 999999999n,
      nonce: randomNonce(),
    };

    await expect(signTransferWithAuthorization(BOT_KEY, 999999, auth)).rejects.toThrow('EIP-3009 not configured');
  });

  it('deterministic for same inputs', async () => {
    const nonce = '0x0000000000000000000000000000000000000000000000000000000000000001' as Hex;
    const auth: TransferAuthorization = {
      from: BOT_ADDRESS,
      to: MERCHANT,
      value: 1_000_000n,
      validAfter: 0n,
      validBefore: 999999999n,
      nonce,
    };

    const sig1 = await signTransferWithAuthorization(BOT_KEY, CHAIN_ID, auth);
    const sig2 = await signTransferWithAuthorization(BOT_KEY, CHAIN_ID, auth);
    expect(sig1).toBe(sig2);
  });
});

describe('randomNonce', () => {
  it('returns a bytes32 hex string', () => {
    const nonce = randomNonce();
    expect(nonce).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('generates unique nonces', () => {
    const nonces = new Set(Array.from({ length: 10 }, () => randomNonce()));
    expect(nonces.size).toBe(10);
  });
});

// ============================================================================
// Permit2 Signing
// ============================================================================

describe('signPermit2WitnessTransfer', () => {
  it('produces a valid 65-byte signature', async () => {
    const permit: Permit2Authorization = {
      token: USDC_ADDRESS,
      amount: 1_000_000n,
      spender: X402_PROXY_ADDRESS,
      nonce: randomPermit2Nonce(),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
      witnessTo: MERCHANT,
      witnessRequestedAmount: 1_000_000n,
    };

    const sig = await signPermit2WitnessTransfer(BOT_KEY, CHAIN_ID, permit);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it('signature recovers to the signer address', async () => {
    const permit: Permit2Authorization = {
      token: USDC_ADDRESS,
      amount: 1_000_000n,
      spender: X402_PROXY_ADDRESS,
      nonce: 42n,
      deadline: 999999999n,
      witnessTo: MERCHANT,
      witnessRequestedAmount: 1_000_000n,
    };

    const sig = await signPermit2WitnessTransfer(BOT_KEY, CHAIN_ID, permit);

    const recovered = await recoverTypedDataAddress({
      domain: {
        name: 'Permit2',
        chainId: CHAIN_ID,
        verifyingContract: PERMIT2_ADDRESS,
      },
      types: {
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
      },
      primaryType: 'PermitWitnessTransferFrom',
      message: {
        permitted: { token: permit.token, amount: permit.amount },
        spender: permit.spender,
        nonce: permit.nonce,
        deadline: permit.deadline,
        witness: { to: permit.witnessTo, requestedAmount: permit.witnessRequestedAmount },
      },
      signature: sig,
    });

    expect(recovered.toLowerCase()).toBe(BOT_ADDRESS.toLowerCase());
  });

  it('deterministic for same inputs', async () => {
    const permit: Permit2Authorization = {
      token: USDC_ADDRESS,
      amount: 1_000_000n,
      spender: X402_PROXY_ADDRESS,
      nonce: 1n,
      deadline: 999999999n,
      witnessTo: MERCHANT,
      witnessRequestedAmount: 1_000_000n,
    };

    const sig1 = await signPermit2WitnessTransfer(BOT_KEY, CHAIN_ID, permit);
    const sig2 = await signPermit2WitnessTransfer(BOT_KEY, CHAIN_ID, permit);
    expect(sig1).toBe(sig2);
  });
});

describe('randomPermit2Nonce', () => {
  it('returns a bigint', () => {
    const nonce = randomPermit2Nonce();
    expect(typeof nonce).toBe('bigint');
    expect(nonce).toBeGreaterThanOrEqual(0n);
  });

  it('generates unique nonces', () => {
    const nonces = new Set(Array.from({ length: 10 }, () => randomPermit2Nonce()));
    expect(nonces.size).toBe(10);
  });
});

// ============================================================================
// Constants
// ============================================================================

describe('x402 constants', () => {
  it('PERMIT2_ADDRESS is canonical', () => {
    expect(PERMIT2_ADDRESS).toBe('0x000000000022D473030F116dDEE9F6B43aC78BA3');
  });

  it('X402_PROXY_ADDRESS is canonical', () => {
    expect(X402_PROXY_ADDRESS).toBe('0x4020CD856C882D5fb903D99CE35316A085Bb0001');
  });

  it('USDC_EIP712_DOMAIN covers all supported chains', () => {
    expect(USDC_EIP712_DOMAIN[8453]).toEqual({ name: 'USD Coin', version: '2' });
    expect(USDC_EIP712_DOMAIN[84532]).toEqual({ name: 'USDC', version: '2' });
    expect(USDC_EIP712_DOMAIN[42161]).toEqual({ name: 'USD Coin', version: '2' });
    expect(USDC_EIP712_DOMAIN[421614]).toEqual({ name: 'USDC', version: '2' });
  });
});
