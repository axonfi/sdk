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
- **Multi-chain** — Base, Arbitrum, Optimism, Polygon. USDC as base asset.

Your agents pay. You stay in control.

## Install

```bash
npm install @axonfi/sdk
```

## Quick Start

### With Encrypted Keystore (recommended)

```typescript
import { AxonClient, decryptKeystore } from '@axonfi/sdk';
import fs from 'fs';

const keystore = fs.readFileSync('./axon-bot.json', 'utf8');
const botPrivateKey = await decryptKeystore(keystore, process.env.BOT_PASSPHRASE!);

const axon = new AxonClient({
  vaultAddress: '0x...',
  chainId: 8453, // Base
  botPrivateKey,
});

// Pay 5 USDC — SDK handles decimals automatically
const result = await axon.pay({
  to: '0xRecipient',
  token: 'USDC',
  amount: 5,
  memo: 'API call payment',
});

console.log(result.status, result.txHash);
```

### With Raw Private Key

```typescript
import { AxonClient } from '@axonfi/sdk';

const axon = new AxonClient({
  vaultAddress: '0x...',
  chainId: 8453,
  botPrivateKey: process.env.BOT_PRIVATE_KEY!,
});
```

### Human-Friendly Amounts

The SDK accepts amounts in three formats:

```typescript
// Human-readable number — SDK converts using token decimals
await axon.pay({ to, token: 'USDC', amount: 5.2 });

// Human-readable string — recommended for computed values
await axon.pay({ to, token: 'USDC', amount: '5.2' });

// Raw bigint — base units, passed through as-is
await axon.pay({ to, token: 'USDC', amount: 5_200_000n });
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
  token: 'USDC', // or Token.USDC, or an address
  amount: 25, // or '25', or 25_000_000n
  memo: 'Invoice #42',
});

// Poll async payments (AI scan or human review)
const status = await axon.poll(result.requestId);
```

### In-Vault Swaps

Rebalance tokens inside your vault without withdrawing. Swap between any tokens on the vault's rebalance whitelist (set by the owner). Each bot has a separate `maxRebalanceAmount` cap — independent from payment limits.

```typescript
const result = await axon.swap({
  toToken: 'WETH',
  minToAmount: 0.001,
  memo: 'Rebalance to WETH',
});
```

### DeFi Protocol Execution

Interact with DeFi and Web3 protocols (Uniswap, Aave, GMX, etc.) that need permission to access collateral from your vault. The bot signs an `ExecuteIntent` specifying the target contract and calldata. The relayer handles token approvals, execution, and revocation in a single atomic transaction. All executions are subject to the bot's per-transaction and daily spending limits.

```typescript
const result = await axon.execute({
  protocol: '0xUniswapRouter',
  callData: '0x...',
  token: 'USDC',
  amount: 100,
});
```

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

## Security Model

- **Owners** control everything: bot whitelist, spending limits, withdrawal. Hardware wallet recommended.
- **Bots** only sign payment intents. They never hold ETH, never submit transactions, and can be removed instantly.
- **Relayer** (Axon) can only execute bot-signed intents within configured limits. Cannot withdraw or modify vault config.
- **If Axon goes offline**, the owner retains full withdrawal access directly through the on-chain vault contract.

## Chains

| Chain        | ID    | Status  |
| ------------ | ----- | ------- |
| Base         | 8453  | Live    |
| Arbitrum One | 42161 | Live    |
| Optimism     | 10    | Live    |
| Polygon PoS  | 137   | Live    |
| Base Sepolia | 84532 | Testnet |

## Documentation

- [Full SDK Reference](https://axonfi.xyz/docs/sdk/typescript/client)
- [Quickstart Guide](https://axonfi.xyz/docs/getting-started/quickstart)
- [How It Works](https://axonfi.xyz/docs/getting-started/how-it-works)
- [Security Model](https://axonfi.xyz/docs/architecture/security-model)
- [HTTP 402 Payments](https://axonfi.xyz/docs/guides/http-402)

## License

MIT
