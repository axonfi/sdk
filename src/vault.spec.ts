import { jest, describe, it, expect } from '@jest/globals';
import type { Address, PublicClient, WalletClient } from 'viem';
import {
  getBotConfig,
  isBotActive,
  getOperatorCeilings,
  operatorMaxDrainPerDay,
  isVaultPaused,
  getVaultVersion,
  getVaultOwner,
  getVaultOperator,
  isDestinationAllowed,
  getChain,
} from './vault.js';

// ---------------------------------------------------------------------------
// Mock publicClient
// ---------------------------------------------------------------------------

function mockPublicClient(readResults: Record<string, unknown>): PublicClient {
  return {
    readContract: jest.fn(({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      const key = args ? `${functionName}:${(args as string[]).join(',')}` : functionName;
      if (key in readResults) return Promise.resolve(readResults[key]);
      if (functionName in readResults) return Promise.resolve(readResults[functionName]);
      return Promise.reject(new Error(`Unmocked readContract: ${key}`));
    }),
  } as unknown as PublicClient;
}

const VAULT = '0x1111111111111111111111111111111111111111' as Address;
const BOT = '0x2222222222222222222222222222222222222222' as Address;
const DEST = '0x3333333333333333333333333333333333333333' as Address;
const OWNER = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as Address;
const OPERATOR = '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' as Address;

describe('getChain', () => {
  it('returns base for 8453', () => {
    expect(getChain(8453).id).toBe(8453);
  });

  it('returns baseSepolia for 84532', () => {
    expect(getChain(84532).id).toBe(84532);
  });

  it('throws for unsupported chain ID', () => {
    expect(() => getChain(999)).toThrow('Unsupported chainId: 999');
  });
});

describe('isBotActive', () => {
  it('returns true when bot is active', async () => {
    const client = mockPublicClient({ [`isBotActive:${BOT}`]: true });
    expect(await isBotActive(client, VAULT, BOT)).toBe(true);
  });

  it('returns false when bot is not active', async () => {
    const client = mockPublicClient({ [`isBotActive:${BOT}`]: false });
    expect(await isBotActive(client, VAULT, BOT)).toBe(false);
  });
});

describe('isVaultPaused', () => {
  it('returns true when vault is paused', async () => {
    const client = mockPublicClient({ paused: true });
    expect(await isVaultPaused(client, VAULT)).toBe(true);
  });

  it('returns false when vault is not paused', async () => {
    const client = mockPublicClient({ paused: false });
    expect(await isVaultPaused(client, VAULT)).toBe(false);
  });
});

describe('getVaultVersion', () => {
  it('returns the version as a number', async () => {
    const client = mockPublicClient({ VERSION: 1n });
    expect(await getVaultVersion(client, VAULT)).toBe(1);
  });
});

describe('getVaultOwner', () => {
  it('returns the owner address', async () => {
    const client = mockPublicClient({ owner: OWNER });
    expect(await getVaultOwner(client, VAULT)).toBe(OWNER);
  });
});

describe('getVaultOperator', () => {
  it('returns the operator address', async () => {
    const client = mockPublicClient({ operator: OPERATOR });
    expect(await getVaultOperator(client, VAULT)).toBe(OPERATOR);
  });
});

describe('getBotConfig', () => {
  it('returns a full BotConfig struct', async () => {
    const raw = {
      isActive: true,
      registeredAt: 1700000000n,
      maxPerTxAmount: 10_000_000n,
      spendingLimits: [{ amount: 100_000_000n, maxCount: 10n, windowSeconds: 86400n }],
      aiTriggerThreshold: 5_000_000n,
      requireAiVerification: false,
    };
    const client = mockPublicClient({ [`getBotConfig:${BOT}`]: raw });
    const config = await getBotConfig(client, VAULT, BOT);

    expect(config.isActive).toBe(true);
    expect(config.registeredAt).toBe(1700000000n);
    expect(config.maxPerTxAmount).toBe(10_000_000n);
    expect(config.spendingLimits).toHaveLength(1);
    expect(config.spendingLimits[0]!.windowSeconds).toBe(86400n);
    expect(config.requireAiVerification).toBe(false);
  });
});

describe('getOperatorCeilings', () => {
  it('returns ceilings from a tuple', async () => {
    const tuple = [100n, 200n, 5n, 1000n, 50n];
    const client = mockPublicClient({ operatorCeilings: tuple });
    const ceilings = await getOperatorCeilings(client, VAULT);

    expect(ceilings.maxPerTxAmount).toBe(100n);
    expect(ceilings.maxBotDailyLimit).toBe(200n);
    expect(ceilings.maxOperatorBots).toBe(5n);
    expect(ceilings.vaultDailyAggregate).toBe(1000n);
    expect(ceilings.minAiTriggerFloor).toBe(50n);
  });
});

describe('operatorMaxDrainPerDay', () => {
  const base = {
    maxPerTxAmount: 1000n,
    maxBotDailyLimit: 5_000_000_000n, // $5k in USDC decimals
    maxOperatorBots: 5n,
    vaultDailyAggregate: 10_000_000_000n, // $10k
    minAiTriggerFloor: 50n,
  };

  it('returns min(theoretical, aggregate) in USD', () => {
    // 5 × $5k = $25k theoretical, capped by $10k aggregate
    expect(operatorMaxDrainPerDay(base)).toBe(10_000);
  });

  it('returns theoretical when no aggregate', () => {
    // 5 × $5k = $25k
    expect(operatorMaxDrainPerDay({ ...base, vaultDailyAggregate: 0n })).toBe(25_000);
  });

  it('returns 0 when maxOperatorBots is 0', () => {
    expect(operatorMaxDrainPerDay({ ...base, maxOperatorBots: 0n })).toBe(0);
  });

  it('returns 0 when maxBotDailyLimit is 0', () => {
    expect(operatorMaxDrainPerDay({ ...base, maxBotDailyLimit: 0n })).toBe(0);
  });

  it('returns theoretical when it equals aggregate', () => {
    // 2 × $5k = $10k = aggregate → returns $10k
    expect(operatorMaxDrainPerDay({ ...base, maxOperatorBots: 2n })).toBe(10_000);
  });
});

describe('isDestinationAllowed', () => {
  it('blocks blacklisted destinations', async () => {
    const client = mockPublicClient({
      [`globalDestinationBlacklist:${DEST}`]: true,
    });
    const result = await isDestinationAllowed(client, VAULT, BOT, DEST);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('blacklist');
  });

  it('blocks when not on global whitelist (non-empty whitelist)', async () => {
    const client = mockPublicClient({
      [`globalDestinationBlacklist:${DEST}`]: false,
      globalDestinationCount: 3n,
      [`globalDestinationWhitelist:${DEST}`]: false,
    });
    const result = await isDestinationAllowed(client, VAULT, BOT, DEST);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('global whitelist');
  });

  it('allows when global whitelist is empty and no bot whitelist', async () => {
    const client = mockPublicClient({
      [`globalDestinationBlacklist:${DEST}`]: false,
      globalDestinationCount: 0n,
      [`botDestinationCount:${BOT}`]: 0n,
    });
    const result = await isDestinationAllowed(client, VAULT, BOT, DEST);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('blocks when not on bot whitelist (non-empty bot whitelist)', async () => {
    const client = mockPublicClient({
      [`globalDestinationBlacklist:${DEST}`]: false,
      globalDestinationCount: 0n,
      [`botDestinationCount:${BOT}`]: 2n,
      [`botDestinationWhitelist:${BOT},${DEST}`]: false,
    });
    const result = await isDestinationAllowed(client, VAULT, BOT, DEST);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('bot whitelist');
  });

  it('allows when on both whitelists', async () => {
    const client = mockPublicClient({
      [`globalDestinationBlacklist:${DEST}`]: false,
      globalDestinationCount: 1n,
      [`globalDestinationWhitelist:${DEST}`]: true,
      [`botDestinationCount:${BOT}`]: 1n,
      [`botDestinationWhitelist:${BOT},${DEST}`]: true,
    });
    const result = await isDestinationAllowed(client, VAULT, BOT, DEST);
    expect(result.allowed).toBe(true);
  });
});
