# @axonfi/sdk

Give your AI agents a wallet they can't drain.

## What is Axon Finance

Agentic finance infrastructure. Secure, non-custodial vaults for autonomous AI agents. Gasless bots, AI verification.

## Why Axon Finance

Giving bots funded wallets is risky: scattered keys, no spending controls, one compromised key drains everything. Axon flips this model:

- **Non-custodial vaults** — each owner deploys their own vault. Only the owner can withdraw. Enforced on-chain.
- **Bounded risk** — per-tx caps, daily limits, velocity windows, destination whitelists. Bots can only operate within the policies you set.
- **AI verification** — 3-agent LLM consensus (safety, behavioral, reasoning) for flagged transactions. 2/3 consensus required.
- **Gasless bots** — bots sign EIP-712 intents off-chain. Axon's relayer handles gas, simulation, and on-chain execution.
- **Multi-chain** — Base, Arbitrum. USDC as base asset.

Your agents pay. You stay in control.

## Features

- **Payments** — Send USDC or any ERC-20 to any address. Gasless for bots (EIP-712 intents, relayer pays gas). Per-tx caps, daily limits, AI verification.
- **DeFi Protocol Execution** — Interact with Uniswap, Aave, GMX, Ostium, Lido, and any on-chain protocol from your vault. Atomic approve/call/revoke.
- **In-Vault Swaps** — Rebalance tokens inside the vault without withdrawing. Separate caps from payment limits.
- **HTTP 402 Paywalls (x402)** — Native support for [x402](https://www.x402.org/) APIs. One-call `handlePaymentRequired()` handles parsing, vault funding, signing, and retry headers. EIP-3009 (USDC) and Permit2 (any ERC-20).
- **AI Verification** — 3-agent LLM consensus (safety, behavioral, reasoning) for flagged transactions. Configurable per bot: threshold-based or always-on.
- **Non-Custodial Vaults** — Each owner deploys their own vault. Only the owner can withdraw. Enforced on-chain.
- **Human-Friendly Amounts** — Pass `5`, `"5.2"`, or `5_200_000n`. SDK handles decimals. Token resolution by symbol, enum, or address.
- **Multi-Chain** — Base, Arbitrum. USDC as base asset. Same SDK, same API.

## Install

```bash
npm install @axonfi/sdk
```

## Setup

There are two ways to set up an Axon vault: through the **dashboard** (UI) or entirely through the **SDK** (programmatic). Both produce the same on-chain result.

### Option A: Dashboard Setup

1. Go to [app.axonfi.xyz](https://app.axonfi.xyz), connect your wallet, deploy a vault
2. Fund the vault — send USDC, ETH, or any ERC-20 to the vault address
3. Register a bot — generate a keypair or bring your own key
4. Configure policies — per-tx caps, daily limits, AI threshold
5. Give the bot key to your agent

### Option B: Full SDK Setup (Programmatic)

Everything can be done from code — no dashboard needed. An agent can bootstrap its own vault end-to-end.

```typescript
import {
  AxonClient,
  deployVault,
  addBot,
  deposit,
  createAxonPublicClient,
  createAxonWalletClient,
  WINDOW,
  Chain,
} from '@axonfi/sdk';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// ── 1. Owner wallet (funded with ETH for gas) ─────────────────────
const ownerKey = '0x...'; // or generate: generatePrivateKey()
const chainId = Chain.BaseSepolia;
const ownerWallet = createAxonWalletClient(ownerKey, chainId);
const publicClient = createAxonPublicClient(chainId, 'https://sepolia.base.org');

// ── 2. Deploy vault (on-chain tx, ~0.001 ETH gas) ─────────────────
const vaultAddress = await deployVault(ownerWallet, publicClient);
console.log('Vault deployed:', vaultAddress);

// ── 3. Generate a bot keypair ──────────────────────────────────────
const botKey = generatePrivateKey();
const botAddress = privateKeyToAccount(botKey).address;

// ── 4. Accept Terms of Service (wallet signature, no gas) ─────────
const axon = new AxonClient({ vaultAddress, chainId, botPrivateKey: botKey });
await axon.acceptTos(ownerWallet, ownerWallet.account!.address);

// ── 5. Register the bot on the vault (on-chain tx, ~0.0005 ETH gas)
await addBot(ownerWallet, publicClient, vaultAddress, botAddress, {
  maxPerTxAmount: 100, // $100 hard cap per tx
  maxRebalanceAmount: 0, // no rebalance cap
  spendingLimits: [
    {
      amount: 1000, // $1,000/day rolling limit
      maxCount: 0, // no tx count limit
      windowSeconds: WINDOW.ONE_DAY,
    },
  ],
  aiTriggerThreshold: 50, // AI scan above $50
  requireAiVerification: false,
});

// ── 6. Deposit funds (on-chain tx, ~0.0005 ETH gas) ───────────────
// Option A: Deposit ETH (vault accepts native ETH directly)
await deposit(ownerWallet, publicClient, vaultAddress, 'ETH', 0.1);

// Option B: Deposit USDC (SDK handles approve + deposit)
await deposit(ownerWallet, publicClient, vaultAddress, 'USDC', 500);

// ── 7. Bot is ready — gasless from here ────────────────────────────
// Save botKey securely. The bot never needs ETH.
```

### What Needs Gas vs. What's Gasless

| Step                 | Who pays gas       | Notes                                              |
| -------------------- | ------------------ | -------------------------------------------------- |
| Deploy vault         | Owner              | ~0.001 ETH. One-time.                              |
| Accept ToS           | Owner              | Wallet signature only (no gas).                    |
| Register bot         | Owner              | ~0.0005 ETH. One per bot.                          |
| Configure bot        | Owner              | ~0.0003 ETH. Only when changing limits.            |
| Deposit ETH          | Depositor          | Anyone can deposit. ETH sent directly.             |
| Deposit ERC-20       | Depositor          | Anyone can deposit. SDK handles approve + deposit. |
| **Pay**              | **Free (relayer)** | **Bot signs EIP-712 intent. Axon pays gas.**       |
| **Execute (DeFi)**   | **Free (relayer)** | **Bot signs intent. Axon pays gas.**               |
| **Swap (rebalance)** | **Free (relayer)** | **Bot signs intent. Axon pays gas.**               |
| Pause/unpause        | Owner              | ~0.0002 ETH. Emergency only.                       |
| Withdraw             | Owner              | ~0.0003 ETH. Owner-only.                           |

**The key insight:** Setup operations (deploy, add bot, deposit) require gas from the owner. Once setup is complete, all bot operations (payments, DeFi, swaps) are gasless — the bot never needs ETH. The relayer pays all execution gas.

### Depositing ETH

Vaults accept native ETH directly — no wrapping needed. You can start a vault with only ETH:

```typescript
// Deploy vault + deposit ETH — no USDC needed
const vault = await deployVault(ownerWallet, publicClient, factory);
await addBot(ownerWallet, publicClient, vault, botAddress, config);
await deposit(ownerWallet, publicClient, vault, 'ETH', 0.5);

// Bot can now pay in any token — the relayer swaps ETH → USDC automatically
await axon.pay({ to: '0x...', token: 'USDC', amount: 10 });
```

When a bot pays in a token the vault doesn't hold directly (e.g., USDC when the vault only has ETH), the relayer automatically routes through a swap. The bot doesn't need to know or care what tokens are in the vault.

## Quick Start

### With Encrypted Keystore (recommended)

```typescript
import { AxonClient, Chain, Token, decryptKeystore } from '@axonfi/sdk';
import fs from 'fs';

const keystore = fs.readFileSync('./axon-bot.json', 'utf8');
const botPrivateKey = await decryptKeystore(keystore, process.env.BOT_PASSPHRASE!);

const axon = new AxonClient({
  vaultAddress: '0x...',
  chainId: Chain.Base,
  botPrivateKey,
});

// Pay 5 USDC — SDK handles decimals automatically
const result = await axon.pay({
  to: '0xRecipient',
  token: Token.USDC,
  amount: 5,
  memo: 'API call payment',
});

console.log(result.status, result.txHash);
```

### With Raw Private Key

```typescript
import { AxonClient, Chain } from '@axonfi/sdk';

const axon = new AxonClient({
  vaultAddress: '0x...',
  chainId: Chain.Base,
  botPrivateKey: process.env.BOT_PRIVATE_KEY!,
});
```

### Human-Friendly Amounts

The SDK accepts amounts in three formats:

```typescript
// Human-readable number — SDK converts using token decimals
await axon.pay({ to, token: Token.USDC, amount: 5.2 });

// Human-readable string — recommended for computed values
await axon.pay({ to, token: Token.USDC, amount: '5.2' });

// Raw bigint — base units, passed through as-is
await axon.pay({ to, token: Token.USDC, amount: 5_200_000n });
```

Token field accepts addresses, `Token` enum values, or symbol strings:

```typescript
import { Token, USDC } from '@axonfi/sdk';

token: 'USDC'; // bare symbol string
token: Token.USDC; // type-safe enum
token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // raw address
```

## API

### Payments

Send USDC (or any ERC-20) to any address. The bot signs an EIP-712 intent — Axon verifies it against your vault's spending policies, simulates the transaction, and executes on-chain. If the payment exceeds the AI threshold, it goes through 3-agent verification before execution.

```typescript
const result = await axon.pay({
  to: '0xRecipient',
  token: Token.USDC,
  amount: 25,
  memo: 'Invoice #42',
});

// Poll async payments (AI scan or human review)
const status = await axon.poll(result.requestId);
```

### In-Vault Swaps

Rebalance tokens inside your vault without withdrawing. Swap between any tokens on the vault's rebalance whitelist (set by the owner). Each bot has a separate `maxRebalanceAmount` cap — independent from payment limits.

```typescript
const result = await axon.swap({
  toToken: Token.WETH,
  minToAmount: 0.001,
  memo: 'Rebalance to WETH',
});
```

### DeFi Protocol Execution

Interact with DeFi and Web3 protocols (Uniswap, Aave, GMX, Ostium, etc.) from your vault. The bot signs an `ExecuteIntent` specifying the target contract and calldata. The relayer handles token approvals, execution, and revocation in a single atomic transaction. All executions are subject to the bot's per-transaction and daily spending limits.

```typescript
const result = await axon.execute({
  protocol: '0xUniswapRouter',
  callData: '0x...',
  tokens: [Token.USDC],
  amounts: [100],
});
```

#### When the approval target differs from the call target

In simple cases (Uniswap, Aave), the contract you call is the same contract that pulls your tokens — `execute()` handles this automatically in a single call.

But many DeFi protocols split these into two contracts:

- **Call target** (`protocol`) — the contract you send the transaction to (e.g., Ostium's `Trading` for `openTrade()`)
- **Approval target** — the contract that actually calls `transferFrom()` to pull tokens from your vault (e.g., Ostium's `TradingStorage`)

When these differ, you need a **two-step pattern**: first give the approval target a persistent token allowance, then call the action.

**Example — Ostium perpetual futures:**

Ostium's `openTrade()` lives on the Trading contract, but collateral gets pulled by TradingStorage. The vault must approve TradingStorage, not Trading.

```typescript
const USDC = '0x...';                // USDC on your chain
const OSTIUM_TRADING = '0x...';      // calls openTrade()
const OSTIUM_TRADING_STORAGE = '0x...'; // pulls USDC via transferFrom()

// Step 1: Persistent approval (one-time) — call approve() on the token contract
// This tells USDC to let TradingStorage spend from the vault.
await axon.execute({
  protocol: USDC,                    // call target: the token contract itself
  callData: encodeApprove(OSTIUM_TRADING_STORAGE, MaxUint256),
  tokens: [USDC],
  amounts: [0],                      // no token spend, just setting an allowance
  protocolName: 'USDC Approve',
});

// Step 2: Open trade — call the action contract
await axon.execute({
  protocol: OSTIUM_TRADING,          // call target: the Trading contract
  callData: encodeOpenTrade(...),
  tokens: [USDC],
  amounts: [50_000_000],             // 50 USDC — passed for dashboard/AI visibility
  protocolName: 'Ostium',
});
```

**Vault setup (owner, one-time):** Two contracts must be approved via `approveProtocol()`:

1. **USDC** (the token contract) — because the vault calls `approve()` on it directly
2. **Trading** — because the vault calls `openTrade()` on it

TradingStorage does _not_ need to be approved — it's just an argument to `approve()`, not a contract the vault calls.

> **Note:** Common tokens (USDC, USDT, WETH, etc.) are pre-approved globally via the Axon registry as default tokens, so you typically only need to approve the DeFi protocol contract itself. You only need to approve a token if it's uncommon and not in the registry defaults.

> **Testnet note:** If the protocol uses a custom token that isn't on Uniswap (e.g., Ostium's testnet USDC), set the bot's `maxPerTxAmount` to `0` to skip TWAP oracle pricing.

This pattern applies to any protocol where the approval target differs from the call target (GMX, some lending protocols, etc.).

#### `ContractNotApproved` error

If `execute()` reverts with `ContractNotApproved`, the `protocol` address you're calling isn't approved. Two possible causes:

1. **The DeFi protocol contract isn't approved** — the vault owner must call `approveProtocol(address)` on the vault for the protocol contract (e.g., Uniswap Router, Ostium Trading, Lido stETH).
2. **The token contract isn't approved** — when doing a token approval (Step 1 above), the token must either be approved on the vault via `approveProtocol(tokenAddress)` or be a registry default token. Common tokens (USDC, USDT, WETH, DAI, etc.) are pre-approved globally by Axon, but uncommon tokens (e.g., stETH, aUSDC, cTokens) may need manual approval.

**Example — Lido staking/unstaking:** To unstake stETH, Lido's withdrawal contract calls `transferFrom()` to pull stETH from your vault. You need:

- `approveProtocol(stETH)` — so the vault can call `approve()` on the stETH token to grant Lido an allowance
- `approveProtocol(lidoWithdrawalQueue)` — so the vault can call `requestWithdrawals()` on Lido

### Vault Reads

Query your vault's on-chain state — balances, bot status, pause state, and destination checks. All reads go through the relayer (no RPC connection needed).

```typescript
await axon.getBalance('USDC'); // vault token balance
await axon.isActive(); // bot registered + active?
await axon.isPaused(); // vault paused?
await axon.getVaultInfo(); // owner, operator, version
await axon.canPayTo('0xRecipient'); // destination allowed?
```

### ERC-1271 Bot Signatures (External Protocol Signing)

By default, only the vault owner's signatures are accepted by external protocols that check ERC-1271 (e.g., Permit2, Cowswap, Seaport). Bot signatures are rejected.

If your bot needs to sign messages that external protocols validate against the vault (e.g., signing a Cowswap order, a Permit2 approval, or a Seaport listing), the vault owner must explicitly enable bot signing:

```typescript
// Check if ERC-1271 bot signing is enabled (direct chain read)
import { isErc1271BotsEnabled, createAxonPublicClient } from '@axonfi/sdk';

const publicClient = createAxonPublicClient(chainId, rpcUrl);
const enabled = await isErc1271BotsEnabled(publicClient, vaultAddress);

if (!enabled) {
  console.log('ERC-1271 bot signatures are disabled on this vault.');
  console.log('The vault owner must enable it via the dashboard or by calling setErc1271Bots(true).');
}
```

**When to enable:** Only if your bots interact with protocols that verify signatures via ERC-1271 — Cowswap (off-chain order signing), Permit2 (gasless token approvals), Seaport (NFT marketplace listings).

**When to keep disabled (default):** If your bots only make payments, execute DeFi calls, or rebalance tokens through Axon's standard `pay()` / `execute()` / `swap()` endpoints.

**Security note:** If a bot key is compromised while ERC-1271 is enabled, the attacker could sign Permit2 approvals or marketplace listings that drain vault funds. The owner can disable it instantly via the dashboard or `setErc1271Bots(false)`.

### Utilities

Helper functions for amount conversion, token resolution, and reference encoding.

```typescript
import { parseAmount, resolveTokenDecimals, resolveToken, encodeRef } from '@axonfi/sdk';

parseAmount(5.2, 'USDC'); // 5_200_000n
resolveTokenDecimals('WETH'); // 18
resolveToken('USDC', 8453); // 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
encodeRef('invoice-042'); // keccak256 → bytes32
```

## Response Paths

Payments resolve through one of three paths:

| Path             | Trigger              | Timing | Response                                    |
| ---------------- | -------------------- | ------ | ------------------------------------------- |
| **Fast**         | Below all thresholds | ~2s    | `status: "approved"`, `txHash`              |
| **AI Scan**      | Exceeds AI threshold | ~30s   | `status: "approved"` or routes to review    |
| **Human Review** | No AI consensus      | Async  | `status: "pending_review"`, poll for result |

## HTTP 402 Paywalls (x402)

The SDK handles [x402](https://www.x402.org/) paywalls — APIs that charge per-request via HTTP 402 Payment Required. When a bot hits a paywall, the SDK parses the payment requirements, funds the bot from the vault, signs a token authorization, and returns a header for the retry.

```typescript
const response = await fetch('https://api.example.com/data');

if (response.status === 402) {
  // SDK handles everything: parse header, fund bot from vault, sign authorization
  const result = await axon.x402.handlePaymentRequired(response.headers);

  // Retry with the payment signature
  const data = await fetch('https://api.example.com/data', {
    headers: { 'PAYMENT-SIGNATURE': result.paymentSignature },
  });
}
```

The full pipeline applies — spending limits, AI verification, human review — even for 402 payments. Vault owners see every paywall payment in the dashboard with the resource URL, merchant address, and amount.

Supports EIP-3009 (USDC, gasless) and Permit2 (any ERC-20) settlement schemes.

## Security Model

- **Owners** control everything: bot whitelist, spending limits, withdrawal. Hardware wallet recommended.
- **Bots** only sign payment intents. They never hold ETH, never submit transactions, and can be removed instantly. External protocol signing (ERC-1271) is disabled by default — must be explicitly enabled by the owner.
- **Relayer** (Axon) can only execute bot-signed intents within configured limits. Cannot withdraw or modify vault config.
- **If Axon goes offline**, the owner retains full withdrawal access directly through the on-chain vault contract.

## Supported Chains

### Mainnet

| Chain        | ID    | Status      |
| ------------ | ----- | ----------- |
| Base         | 8453  | Coming soon |
| Arbitrum One | 42161 | Coming soon |

### Testnet

| Chain            | ID     | Status |
| ---------------- | ------ | ------ |
| Base Sepolia     | 84532  | Live   |
| Arbitrum Sepolia | 421614 | Live   |

## Links

- [Website](https://axonfi.xyz)
- [Dashboard](https://app.axonfi.xyz)
- [Documentation](https://axonfi.xyz/llms.txt)
- [npm — @axonfi/sdk](https://www.npmjs.com/package/@axonfi/sdk)
- [PyPI — axonfi](https://pypi.org/project/axonfi/) (Python SDK)
- [Smart Contracts](https://github.com/axonfi/contracts)
- [Examples](https://github.com/axonfi/examples)
- [Twitter/X — @axonfixyz](https://x.com/axonfixyz)

## License

MIT
