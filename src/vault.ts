import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, arbitrum, arbitrumSepolia } from 'viem/chains';
import type { PublicClient, WalletClient, Address, Hex, Chain } from 'viem';
import { AxonVaultAbi } from './abis/AxonVault.js';
import { AxonVaultFactoryAbi } from './abis/AxonVaultFactory.js';
import { erc20Abi } from 'viem';
import { NATIVE_ETH, ALLOWED_WINDOWS } from './constants.js';
import { parseAmount } from './amounts.js';
import { resolveToken, type KnownTokenSymbol } from './tokens.js';
import type {
  BotConfig,
  BotConfigParams,
  BotConfigInput,
  OperatorCeilings,
  VaultInfo,
  DestinationCheckResult,
} from './types.js';

// ============================================================================
// Chain helpers
// ============================================================================

/** Returns the viem Chain object for a supported Axon chain ID. */
export function getChain(chainId: number): Chain {
  switch (chainId) {
    case 8453:
      return base;
    case 84532:
      return baseSepolia;
    case 42161:
      return arbitrum;
    case 421614:
      return arbitrumSepolia;
    default:
      throw new Error(
        `Unsupported chainId: ${chainId}. Supported: 8453 (Base), 84532 (Base Sepolia), 42161 (Arbitrum), 421614 (Arbitrum Sepolia)`,
      );
  }
}

/** Create a viem PublicClient for the given chain and RPC URL. */
export function createAxonPublicClient(chainId: number, rpcUrl: string): PublicClient {
  return createPublicClient({
    chain: getChain(chainId),
    transport: http(rpcUrl),
  });
}

/** Create a viem WalletClient from a raw private key (signing-only, no RPC needed). */
export function createAxonWalletClient(privateKey: Hex, chainId: number): WalletClient {
  const account = privateKeyToAccount(privateKey);
  return createWalletClient({
    account,
    chain: getChain(chainId),
    transport: http(), // signing is local — transport is unused but required by viem
  });
}

// ============================================================================
// BotConfigInput → BotConfigParams conversion
// ============================================================================

const USDC_DECIMALS = 6n;
const USDC_UNIT = 10n ** USDC_DECIMALS; // 1_000_000n

/** Convert human-friendly BotConfigInput (dollar amounts) to on-chain BotConfigParams (6-decimal bigints). */
export function toBotConfigParams(input: BotConfigInput): BotConfigParams {
  // Validate spending windows before converting
  for (const sl of input.spendingLimits) {
    if (!ALLOWED_WINDOWS.has(BigInt(sl.windowSeconds))) {
      const allowed = [...ALLOWED_WINDOWS].map((w) => `${Number(w)}s`).join(', ');
      throw new Error(`Invalid spending window: ${sl.windowSeconds}s. Allowed values: ${allowed}. Use WINDOW constants.`);
    }
  }

  return {
    maxPerTxAmount: BigInt(Math.round(input.maxPerTxAmount * Number(USDC_UNIT))),
    maxRebalanceAmount: BigInt(Math.round(input.maxRebalanceAmount * Number(USDC_UNIT))),
    spendingLimits: input.spendingLimits.map((sl) => ({
      amount: BigInt(Math.round(sl.amount * Number(USDC_UNIT))),
      maxCount: BigInt(sl.maxCount),
      windowSeconds: BigInt(sl.windowSeconds),
    })),
    aiTriggerThreshold: BigInt(Math.round(input.aiTriggerThreshold * Number(USDC_UNIT))),
    requireAiVerification: input.requireAiVerification,
  };
}

// ============================================================================
// Factory address resolution
// ============================================================================

const DEFAULT_RELAYER_URL = 'https://relay.axonfi.xyz';

/** Fetch the factory address for a chain from the relayer's /v1/chains endpoint. */
async function getFactoryAddress(chainId: number, relayerUrl?: string): Promise<Address> {
  const base = relayerUrl ?? DEFAULT_RELAYER_URL;
  const resp = await fetch(`${base}/v1/chains`);
  if (!resp.ok) throw new Error(`Failed to fetch chain config from relayer [${resp.status}]`);
  const data = await resp.json();
  const chain = data.chains?.find((c: { chainId: number }) => c.chainId === chainId);
  if (!chain?.factoryAddress) {
    throw new Error(`No factory address available for chainId ${chainId}. Check the relayer's chain configuration.`);
  }
  return chain.factoryAddress as Address;
}

// ============================================================================
// Read-only vault helpers
// ============================================================================

/**
 * Returns the full BotConfig for a bot address from the vault.
 * If the bot has never been added, isActive will be false and all
 * numeric fields will be 0n.
 */
export async function getBotConfig(
  publicClient: PublicClient,
  vaultAddress: Address,
  botAddress: Address,
): Promise<BotConfig> {
  const result = await publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'getBotConfig',
    args: [botAddress],
  });

  return {
    isActive: result.isActive,
    registeredAt: result.registeredAt,
    maxPerTxAmount: result.maxPerTxAmount,
    maxRebalanceAmount: result.maxRebalanceAmount,
    spendingLimits: result.spendingLimits.map((sl) => ({
      amount: sl.amount,
      maxCount: sl.maxCount,
      windowSeconds: sl.windowSeconds,
    })),
    aiTriggerThreshold: result.aiTriggerThreshold,
    requireAiVerification: result.requireAiVerification,
  };
}

/** Returns whether a bot address is currently active in the vault. */
export async function isBotActive(
  publicClient: PublicClient,
  vaultAddress: Address,
  botAddress: Address,
): Promise<boolean> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'isBotActive',
    args: [botAddress],
  });
}

/** Returns the operator ceilings set by the vault owner. */
export async function getOperatorCeilings(
  publicClient: PublicClient,
  vaultAddress: Address,
): Promise<OperatorCeilings> {
  const result = await publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'operatorCeilings',
  });

  // viem returns multiple named outputs as a tuple; destructure by position
  const [maxPerTxAmount, maxBotDailyLimit, maxOperatorBots, vaultDailyAggregate, minAiTriggerFloor] = result as [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];

  return {
    maxPerTxAmount,
    maxBotDailyLimit,
    maxOperatorBots,
    vaultDailyAggregate,
    minAiTriggerFloor,
  };
}

/**
 * Returns the maximum USDC an operator-compromised wallet could drain per day.
 * Computed on-chain as: min(maxOperatorBots × maxBotDailyLimit, vaultDailyAggregate).
 * Returns 0n if operator has no bot-add permission.
 */
export async function operatorMaxDrainPerDay(publicClient: PublicClient, vaultAddress: Address): Promise<bigint> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'operatorMaxDrainPerDay',
  });
}

/**
 * Returns whether ERC-1271 bot signatures are enabled on the vault.
 *
 * When disabled (default), only the vault owner's signatures are accepted by
 * external protocols (Permit2, Cowswap, Seaport). Bot signatures return
 * `0xffffffff` (invalid).
 *
 * When enabled, active bot keys can sign messages that external protocols
 * treat as vault-authorized — useful for Permit2 approvals, Cowswap orders, etc.
 *
 * If your bot interacts with a protocol that checks ERC-1271 and gets rejected,
 * the vault owner needs to call `setErc1271Bots(true)` to enable it.
 */
export async function isErc1271BotsEnabled(publicClient: PublicClient, vaultAddress: Address): Promise<boolean> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'erc1271BotsEnabled',
  });
}

/** Returns whether the vault is currently paused. */
export async function isVaultPaused(publicClient: PublicClient, vaultAddress: Address): Promise<boolean> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'paused',
  });
}

/** Returns the EIP-712 domain separator for this vault (for off-chain verification). */
export async function getDomainSeparator(publicClient: PublicClient, vaultAddress: Address): Promise<Hex> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'DOMAIN_SEPARATOR',
  });
}

/** Returns the vault contract version number. */
export async function getVaultVersion(publicClient: PublicClient, vaultAddress: Address): Promise<number> {
  const version = await publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'VERSION',
  });
  return Number(version);
}

/** Returns the vault owner address. */
export async function getVaultOwner(publicClient: PublicClient, vaultAddress: Address): Promise<Address> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'owner',
  });
}

/** Returns the vault operator address (address(0) if no operator set). */
export async function getVaultOperator(publicClient: PublicClient, vaultAddress: Address): Promise<Address> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'operator',
  });
}

/**
 * Check whether a destination address is allowed for a given bot.
 *
 * Logic mirrors the on-chain enforcement order:
 * 1. If destination is on the global blacklist → blocked
 * 2. If global whitelist is non-empty → destination must be on it
 * 3. If bot-specific whitelist is non-empty → destination must be on it
 * 4. Otherwise → allowed
 */
export async function isDestinationAllowed(
  publicClient: PublicClient,
  vaultAddress: Address,
  botAddress: Address,
  destination: Address,
): Promise<DestinationCheckResult> {
  // Step 1: Check global blacklist
  const isBlacklisted = await publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'globalDestinationBlacklist',
    args: [destination],
  });
  if (isBlacklisted) {
    return { allowed: false, reason: 'Destination is on the global blacklist' };
  }

  // Step 2: Check global whitelist (if non-empty, destination must be on it)
  const globalCount = await publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'globalDestinationCount',
  });
  if (globalCount > 0n) {
    const isGlobalWhitelisted = await publicClient.readContract({
      address: vaultAddress,
      abi: AxonVaultAbi,
      functionName: 'globalDestinationWhitelist',
      args: [destination],
    });
    if (!isGlobalWhitelisted) {
      return { allowed: false, reason: 'Destination is not on the global whitelist' };
    }
  }

  // Step 3: Check bot-specific whitelist (if non-empty, destination must be on it)
  const botCount = await publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'botDestinationCount',
    args: [botAddress],
  });
  if (botCount > 0n) {
    const isBotWhitelisted = await publicClient.readContract({
      address: vaultAddress,
      abi: AxonVaultAbi,
      functionName: 'botDestinationWhitelist',
      args: [botAddress, destination],
    });
    if (!isBotWhitelisted) {
      return { allowed: false, reason: 'Destination is not on the bot whitelist' };
    }
  }

  return { allowed: true };
}

// ============================================================================
// Rebalance token whitelist (on-chain reads)
// ============================================================================

/** Returns the number of tokens in the vault's on-chain rebalance whitelist. 0 = no on-chain whitelist. */
export async function getRebalanceTokenCount(publicClient: PublicClient, vaultAddress: Address): Promise<number> {
  const count = await publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'rebalanceTokenCount',
  });
  return Number(count);
}

/** Returns whether a token is in the vault's on-chain rebalance whitelist. */
export async function isRebalanceTokenWhitelisted(
  publicClient: PublicClient,
  vaultAddress: Address,
  token: Address,
): Promise<boolean> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'rebalanceTokenWhitelist',
    args: [token],
  });
}

// ============================================================================
// Factory — deploy a new vault
// ============================================================================

/**
 * Deploy a new AxonVault via the factory.
 *
 * The vault is owned by the walletClient's account. Permissionless — any
 * address can deploy, no Axon approval required.
 *
 * The factory address is fetched automatically from the Axon relayer.
 *
 * @param walletClient      Wallet that will own the deployed vault.
 * @param publicClient      Public client for the vault's chain.
 * @param relayerUrl        Override relayer URL (defaults to https://relay.axonfi.xyz).
 * @returns                 Address of the newly deployed vault.
 */
export async function deployVault(
  walletClient: WalletClient,
  publicClient: PublicClient,
  relayerUrl?: string,
): Promise<Address> {
  if (!walletClient.account) {
    throw new Error('walletClient has no account attached');
  }

  const chainId = walletClient.chain?.id;
  if (!chainId) throw new Error('walletClient has no chain configured');
  const factoryAddress = await getFactoryAddress(chainId, relayerUrl);

  const hash = await walletClient.writeContract({
    address: factoryAddress,
    abi: AxonVaultFactoryAbi,
    functionName: 'deployVault',
    args: [],
    account: walletClient.account,
    chain: walletClient.chain ?? null,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // Extract vault address from the VaultDeployed event
  for (const log of receipt.logs) {
    try {
      // The second indexed topic is the vault address (owner is first indexed)
      if (log.topics.length >= 3 && log.topics[2]) {
        const vaultAddress = `0x${log.topics[2].slice(26)}` as Address;
        return vaultAddress;
      }
    } catch {
      // Not a VaultDeployed log, continue
    }
  }

  throw new Error('VaultDeployed event not found in transaction receipt');
}

/**
 * Predict the deterministic address of a vault before deployment.
 *
 * Vault addresses are deterministic via CREATE2: same owner + same nonce = same
 * address across all chains (given the factory is at the same address).
 *
 * @param publicClient    Public client for the target chain.
 * @param owner           Address that will own the vault.
 * @param nonce           Vault index for this owner (0 for first, 1 for second, etc.).
 * @param relayerUrl      Override relayer URL (defaults to https://relay.axonfi.xyz).
 * @returns               The deterministic vault address.
 */
export async function predictVaultAddress(
  publicClient: PublicClient,
  owner: Address,
  nonce: number,
  relayerUrl?: string,
): Promise<Address> {
  const chainId = await publicClient.getChainId();
  const factoryAddress = await getFactoryAddress(chainId, relayerUrl);

  return publicClient.readContract({
    address: factoryAddress,
    abi: AxonVaultFactoryAbi,
    functionName: 'predictVaultAddress',
    args: [owner, BigInt(nonce)],
  });
}

// ============================================================================
// Owner write operations (on-chain, require gas)
// ============================================================================

/**
 * Register a bot on the vault with its initial spending configuration.
 *
 * Must be called by the vault owner (or operator if ceilings allow).
 * This is an on-chain transaction — requires gas on the owner's wallet.
 *
 * @param walletClient    Owner wallet (must be vault owner or authorized operator).
 * @param publicClient    Public client for the vault's chain.
 * @param vaultAddress    Vault to register the bot on.
 * @param botAddress      Public address of the bot to register.
 * @param config          Bot spending configuration — human-readable USD amounts (e.g. 100 = $100).
 * @returns               Transaction hash.
 */
export async function addBot(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vaultAddress: Address,
  botAddress: Address,
  config: BotConfigInput,
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error('walletClient has no account attached');
  }

  const params = toBotConfigParams(config);
  const hash = await walletClient.writeContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'addBot',
    args: [botAddress, params],
    account: walletClient.account,
    chain: walletClient.chain ?? null,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Update an existing bot's spending configuration.
 *
 * Must be called by the vault owner (or operator within ceilings).
 * On-chain transaction — requires gas.
 *
 * @param walletClient    Owner/operator wallet.
 * @param publicClient    Public client for the vault's chain.
 * @param vaultAddress    Vault the bot is registered on.
 * @param botAddress      Bot to update.
 * @param config          New spending configuration — human-readable USD amounts.
 * @returns               Transaction hash.
 */
export async function updateBotConfig(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vaultAddress: Address,
  botAddress: Address,
  config: BotConfigInput,
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error('walletClient has no account attached');
  }

  const params = toBotConfigParams(config);
  const hash = await walletClient.writeContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'updateBotConfig',
    args: [botAddress, params],
    account: walletClient.account,
    chain: walletClient.chain ?? null,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Remove a bot from the vault whitelist.
 *
 * Must be called by the vault owner (or operator).
 * The bot will immediately lose the ability to sign valid intents.
 * On-chain transaction — requires gas.
 *
 * @param walletClient    Owner/operator wallet.
 * @param publicClient    Public client for the vault's chain.
 * @param vaultAddress    Vault to remove the bot from.
 * @param botAddress      Bot to remove.
 * @returns               Transaction hash.
 */
export async function removeBot(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vaultAddress: Address,
  botAddress: Address,
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error('walletClient has no account attached');
  }

  const hash = await walletClient.writeContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'removeBot',
    args: [botAddress],
    account: walletClient.account,
    chain: walletClient.chain ?? null,
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

/**
 * Deposit tokens or native ETH into the vault.
 *
 * Permissionless — anyone can deposit. For ERC-20 tokens, this function
 * handles the approve + deposit in one call. For native ETH, pass
 * `NATIVE_ETH` (or `'ETH'`) as the token.
 *
 * On-chain transaction — requires gas on the depositor's wallet.
 *
 * @param walletClient    Wallet sending the deposit (anyone, not just owner).
 * @param publicClient    Public client for the vault's chain.
 * @param vaultAddress    Vault to deposit into.
 * @param token           Token symbol ('USDC', 'WETH'), Token enum, raw address, or NATIVE_ETH / 'ETH' for ETH deposits.
 * @param amount          Human-readable amount (e.g. 500 for 500 USDC, 0.1 for 0.1 ETH) or raw bigint in base units.
 * @param ref             Optional bytes32 reference linking to an off-chain record. Defaults to 0x0.
 * @returns               Transaction hash of the deposit.
 */
export async function deposit(
  walletClient: WalletClient,
  publicClient: PublicClient,
  vaultAddress: Address,
  token: Address | string,
  amount: bigint | number | string,
  ref: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000',
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error('walletClient has no account attached');
  }

  // Resolve token symbol to address (e.g. 'USDC' → 0x833589...)
  const isEthSymbol = token === 'ETH' || token === 'eth';
  let tokenAddress: Address;
  if (isEthSymbol) {
    tokenAddress = NATIVE_ETH as Address;
  } else if (token.startsWith('0x')) {
    tokenAddress = token as Address;
  } else {
    const chainId = walletClient.chain?.id;
    if (!chainId) throw new Error('walletClient has no chain — cannot resolve token symbol');
    tokenAddress = resolveToken(token as KnownTokenSymbol, chainId);
  }

  const isEth = tokenAddress.toLowerCase() === NATIVE_ETH.toLowerCase();

  // Resolve human-readable amount to base units (e.g. 500 USDC → 500_000_000n)
  let resolvedAmount: bigint;
  if (typeof amount === 'bigint') {
    resolvedAmount = amount;
  } else if (isEth) {
    resolvedAmount = parseAmount(amount, 'WETH'); // ETH has same 18 decimals as WETH
  } else {
    resolvedAmount = parseAmount(amount, token as KnownTokenSymbol);
  }

  if (!isEth) {
    // ERC-20: approve the vault to pull tokens, then deposit
    const approveTx = await walletClient.writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [vaultAddress, resolvedAmount],
      account: walletClient.account,
      chain: walletClient.chain ?? null,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
  }

  const hash = await walletClient.writeContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'deposit',
    args: [tokenAddress, resolvedAmount, ref],
    account: walletClient.account,
    chain: walletClient.chain ?? null,
    ...(isEth ? { value: resolvedAmount } : {}),
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
