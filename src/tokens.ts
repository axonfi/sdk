import type { Address } from 'viem';

// !! After editing this file, regenerate the Python SDK copy:
// !! npx tsx scripts/generate-python-tokens.ts

// ============================================================================
// Token enum — type-safe token symbols for SDK consumers
// ============================================================================

export enum Token {
  USDC = 'USDC',
  USDT = 'USDT',
  DAI = 'DAI',
  WETH = 'WETH',
  WBTC = 'WBTC',
  cbBTC = 'cbBTC',
  cbETH = 'cbETH',
  wstETH = 'wstETH',
  rETH = 'rETH',
  LINK = 'LINK',
  UNI = 'UNI',
  AAVE = 'AAVE',
  COMP = 'COMP',
  CRV = 'CRV',
  SNX = 'SNX',
  ARB = 'ARB',
  AERO = 'AERO',
  GMX = 'GMX',
}

// ============================================================================
// Known token registry — single source of truth for all packages
// ============================================================================

export interface KnownToken {
  symbol: string;
  name: string;
  decimals: number;
  /** Address per chainId. Missing key = not available on that chain. */
  addresses: Partial<Record<number, Address>>;
}

/**
 * Master token registry keyed by symbol.
 * At a glance you see which chains each token lives on.
 *
 * Chain IDs: 8453 = Base, 84532 = Base Sepolia, 42161 = Arbitrum One, 421614 = Arbitrum Sepolia
 */
export const KNOWN_TOKENS = {
  // ── Core stables + wrapped ──────────────────────────────
  USDC: {
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    addresses: {
      8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      421614: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
    },
  },
  USDT: {
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
    addresses: {
      8453: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
      84532: '0x323e78f944A9a1FcF3a10efcC5319DBb0bB6e673',
      42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    },
  },
  DAI: {
    symbol: 'DAI',
    name: 'Dai Stablecoin',
    decimals: 18,
    addresses: {
      8453: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
      84532: '0x819ffecd4e64f193e959944bcd57eedc7755e17a',
      42161: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1',
    },
  },
  WETH: {
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
    addresses: {
      8453: '0x4200000000000000000000000000000000000006',
      84532: '0x4200000000000000000000000000000000000006',
      42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      421614: '0x980B62Da83eFf3D4576C647993b0c1D7faf17c73',
    },
  },
  WBTC: {
    symbol: 'WBTC',
    name: 'Wrapped BTC',
    decimals: 8,
    addresses: {
      8453: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',
      42161: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f',
    },
  },
  cbBTC: {
    symbol: 'cbBTC',
    name: 'Coinbase Wrapped BTC',
    decimals: 8,
    addresses: {
      8453: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
      42161: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    },
  },

  // ── Liquid staking ──────────────────────────────────────
  cbETH: {
    symbol: 'cbETH',
    name: 'Coinbase Staked ETH',
    decimals: 18,
    addresses: {
      8453: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
      42161: '0x1DEBd73E752bEaF79865Fd6446b0c970EaE7732f',
    },
  },
  wstETH: {
    symbol: 'wstETH',
    name: 'Lido Wrapped stETH',
    decimals: 18,
    addresses: {
      8453: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
      42161: '0x5979D7b546E38E414F7E9822514be443A4800529',
    },
  },
  rETH: {
    symbol: 'rETH',
    name: 'Rocket Pool ETH',
    decimals: 18,
    addresses: {
      42161: '0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8',
    },
  },

  // ── DeFi blue-chips ─────────────────────────────────────
  LINK: {
    symbol: 'LINK',
    name: 'Chainlink',
    decimals: 18,
    addresses: {
      8453: '0x88Fb150BDc53A65fe94Dea0c9BA0a6dAf8C6e196',
      84532: '0xE4aB69C077896252FAFBD49EFD26B5D171A32410',
      42161: '0xf97f4df75117a78c1A5a0DBb814Af92458539FB4',
    },
  },
  UNI: {
    symbol: 'UNI',
    name: 'Uniswap',
    decimals: 18,
    addresses: {
      8453: '0xc3De830EA07524a0761646a6a4e4be0e114a3C83',
      42161: '0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0',
    },
  },
  AAVE: {
    symbol: 'AAVE',
    name: 'Aave',
    decimals: 18,
    addresses: {
      8453: '0x63706e401c06ac8513145b7687A14804d17f814b',
      42161: '0xba5DdD1f9d7F570dc94a51479a000E3BCE967196',
    },
  },
  COMP: {
    symbol: 'COMP',
    name: 'Compound',
    decimals: 18,
    addresses: {
      8453: '0x9e1028F5F1D5eDE59748FFceE5532509976840E0',
      42161: '0x354A6dA3fcde098F8389cad84b0182725c6C91dE',
    },
  },
  CRV: {
    symbol: 'CRV',
    name: 'Curve DAO',
    decimals: 18,
    addresses: {
      8453: '0x8Ee73c484A26e0A5df2Ee2a4960B789967dd0415',
      42161: '0x11cDb42B0EB46D95f990BeDD4695A6e3fA034978',
    },
  },
  SNX: {
    symbol: 'SNX',
    name: 'Synthetix',
    decimals: 18,
    addresses: {
      8453: '0x22e6966B799c4D5B13BE962E1D117b56327FDa66',
    },
  },

  // ── Chain-native governance ─────────────────────────────
  ARB: {
    symbol: 'ARB',
    name: 'Arbitrum',
    decimals: 18,
    addresses: {
      42161: '0x912CE59144191C1204E64559FE8253a0e49E6548',
    },
  },
  AERO: {
    symbol: 'AERO',
    name: 'Aerodrome',
    decimals: 18,
    addresses: {
      8453: '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    },
  },
  GMX: {
    symbol: 'GMX',
    name: 'GMX',
    decimals: 18,
    addresses: {
      42161: '0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a',
    },
  },
} as const satisfies Record<string, KnownToken>;

export type KnownTokenSymbol = keyof typeof KNOWN_TOKENS;

/**
 * Tokens that new vaults should pre-approve as protocols at deploy time.
 * This enables the two-step approval pattern (approve token → call DeFi protocol)
 * without the owner having to manually add common tokens.
 *
 * Used by: AxonRegistry (on-chain default list), deploy scripts, dashboard.
 */
export const DEFAULT_APPROVED_TOKENS: KnownTokenSymbol[] = [
  'USDC', 'USDT', 'DAI', 'WETH', 'WBTC', 'cbBTC',
];

/** Get default approved token addresses for a specific chain. */
export function getDefaultApprovedTokens(chainId: number): Address[] {
  const addresses: Address[] = [];
  for (const symbol of DEFAULT_APPROVED_TOKENS) {
    const entry = KNOWN_TOKENS[symbol];
    const addr = (entry.addresses as Record<number, Address | undefined>)[chainId];
    if (addr) addresses.push(addr);
  }
  return addresses;
}

// Pre-build reverse lookup map: lowercase address → symbol
const addressToSymbol = new Map<string, string>();
for (const token of Object.values(KNOWN_TOKENS)) {
  for (const addr of Object.values(token.addresses)) {
    addressToSymbol.set((addr as string).toLowerCase(), token.symbol);
  }
}

/** All known tokens available on a specific chain. */
export function getKnownTokensForChain(chainId: number): (KnownToken & { address: Address })[] {
  const result: (KnownToken & { address: Address })[] = [];
  for (const token of Object.values(KNOWN_TOKENS)) {
    const addr = (token.addresses as Record<number, Address | undefined>)[chainId];
    if (addr) {
      result.push({ ...token, address: addr });
    }
  }
  return result;
}

/** Reverse-lookup: address → symbol (case-insensitive). Returns null if unknown. */
export function getTokenSymbolByAddress(address: string): string | null {
  return addressToSymbol.get(address.toLowerCase()) ?? null;
}

/**
 * Resolve a Token enum symbol to its on-chain address for a given chain.
 * If an Address (0x...) is passed, it is returned as-is.
 *
 * @throws if the symbol has no address on the given chain.
 */
export function resolveToken(token: Address | Token | KnownTokenSymbol, chainId: number): Address {
  // Already an address — pass through (with zero-address guard)
  if (typeof token === 'string' && token.startsWith('0x')) {
    if (token === '0x0000000000000000000000000000000000000000') {
      throw new Error('Token address cannot be the zero address');
    }
    return token as Address;
  }

  const entry = KNOWN_TOKENS[token as keyof typeof KNOWN_TOKENS];
  if (!entry) {
    throw new Error(`Unknown token symbol: ${token}`);
  }

  const addr = (entry.addresses as Record<number, Address | undefined>)[chainId];
  if (!addr) {
    throw new Error(`Token ${token} is not available on chain ${chainId}`);
  }

  return addr;
}
