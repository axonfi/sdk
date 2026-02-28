import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, arbitrum, arbitrumSepolia } from 'viem/chains';
import type { PublicClient, WalletClient, Address, Hex, Chain } from 'viem';
import { AxonVaultAbi } from './abis/AxonVault.js';
import { AxonVaultFactoryAbi } from './abis/AxonVaultFactory.js';
import type { BotConfig, OperatorCeilings, VaultInfo, DestinationCheckResult } from './types.js';

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

/** Returns whether the vault tracks used intent hashes on-chain. */
export async function getTrackUsedIntents(publicClient: PublicClient, vaultAddress: Address): Promise<boolean> {
  return publicClient.readContract({
    address: vaultAddress,
    abi: AxonVaultAbi,
    functionName: 'trackUsedIntents',
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
 * @param walletClient      Wallet that will own the deployed vault.
 * @param factoryAddress    Address of the deployed AxonVaultFactory.
 * @param trackUsedIntents  If true, executed intent hashes are stored on-chain
 *                          to prevent exact replay. Default true — only disable
 *                          for extreme high-frequency bots.
 * @returns                 Address of the newly deployed vault.
 */
export async function deployVault(
  walletClient: WalletClient,
  publicClient: PublicClient,
  factoryAddress: Address,
  trackUsedIntents = true,
): Promise<Address> {
  if (!walletClient.account) {
    throw new Error('walletClient has no account attached');
  }

  const hash = await walletClient.writeContract({
    address: factoryAddress,
    abi: AxonVaultFactoryAbi,
    functionName: 'deployVault',
    args: [trackUsedIntents],
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
