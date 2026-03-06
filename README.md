# @axonfi/sdk

Give your AI agents a wallet they can't drain.

## What is Axon Finance

Treasury and payment infrastructure for autonomous AI agents. Non-custodial vaults, gasless bots, AI verification.

## Why Axon Finance

Giving bots funded wallets is risky: scattered keys, no spending controls, one compromised key drains everything. Axon flips this model:

- **Non-custodial vaults** — each owner deploys their own vault. Only the owner can withdraw. Enforced on-chain.
- **Bounded risk** — per-tx caps, daily limits, velocity windows, destination whitelists. Bots can only operate within the policies you set.
- **AI verification** — 3-agent LLM consensus (safety, behavioral, reasoning) for flagged transactions. 2/3 consensus required.
- **Gasless bots** — bots sign EIP-712 intents off-chain. Axon's relayer handles gas, simulation, and on-chain execution.
- **Multi-chain** — Base, Arbitrum. USDC as base asset.

Your agents pay. You stay in control.

## Install

```bash
npm install @axonfi/sdk
```

## Prerequisites

Before using the SDK, you need an Axon vault with a registered bot:

1. **Deploy a vault** — Go to [app.axonfi.xyz](https://app.axonfi.xyz), connect your wallet, and deploy a vault on your target chain. The vault is a non-custodial smart contract — only you (the owner) can withdraw funds.

2. **Fund the vault** — Send USDC (or any ERC-20) to your vault address. Anyone can deposit directly to the contract.

3. **Register a bot** — In the dashboard, go to your vault → Bots → Add Bot. You can either:
   - **Generate a new keypair** (recommended) — the dashboard creates a key and downloads an encrypted keystore JSON file. You set the passphrase.
   - **Bring your own key** — paste an existing public key if you manage keys externally.

4. **Configure policies** — Set per-transaction caps, daily spending limits, velocity windows, and destination whitelists. The bot can only operate within these bounds.

5. **Get the bot key** — Your agent needs the bot's private key to sign payment intents. Use the keystore file + passphrase (recommended) or export the raw private key for quick testing.

The vault owner's wallet stays secure — the bot key can only sign intents within the policies you configure, and can be revoked instantly from the dashboard.

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
  token: Token.USDC,
  amount: 100,
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
  token: USDC,
  amount: 0,                         // no token spend, just setting an allowance
  protocolName: 'USDC Approve',
});

// Step 2: Open trade — call the action contract
await axon.execute({
  protocol: OSTIUM_TRADING,          // call target: the Trading contract
  callData: encodeOpenTrade(...),
  token: USDC,
  amount: 50_000_000,                // 50 USDC — passed for dashboard/AI visibility
  protocolName: 'Ostium',
});
```

**Vault setup (owner, one-time):** Two contracts must be approved via `approveProtocol()`:
1. **USDC** (the token contract) — because the vault calls `approve()` on it directly
2. **Trading** — because the vault calls `openTrade()` on it

TradingStorage does *not* need to be approved — it's just an argument to `approve()`, not a contract the vault calls.

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
- **Bots** only sign payment intents. They never hold ETH, never submit transactions, and can be removed instantly.
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
