import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Address, Hex } from 'viem';

// ---------------------------------------------------------------------------
// Mock modules — must be before imports that use them
// ---------------------------------------------------------------------------

const mockSignTypedData = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule('./vault.js', () => ({
  createAxonWalletClient: jest.fn(() => ({
    account: { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
    signTypedData: mockSignTypedData,
  })),
  // These are still exported from vault.ts for dashboards, but not used by AxonClient
  createAxonPublicClient: jest.fn(),
  getChain: jest.fn(),
}));

// Dynamic imports — must come after jest.unstable_mockModule
const { AxonClient } = await import('./client.js');
const { RELAYER_API } = await import('./constants.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VAULT_ADDR = '0x1111111111111111111111111111111111111111' as Address;
const BOT_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const CHAIN_ID = 84532;
const RELAYER_URL = 'https://relay.axonfi.xyz';

function makeClient() {
  return new AxonClient({
    vaultAddress: VAULT_ADDR,
    chainId: CHAIN_ID,
    botPrivateKey: BOT_KEY,
  });
}

const fetchMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
global.fetch = fetchMock as unknown as typeof fetch;

function mockFetchOk(body: unknown) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

function mockFetchFail(status: number, body: string) {
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSignTypedData.mockResolvedValue('0x' + 'ab'.repeat(65));
});

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('AxonClient constructor', () => {
  it('throws if botPrivateKey is missing', () => {
    expect(
      () =>
        new AxonClient({
          vaultAddress: VAULT_ADDR,
          chainId: CHAIN_ID,
        }),
    ).toThrow('botPrivateKey is required');
  });

  it('creates client with minimal config', () => {
    expect(() => makeClient()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// botAddress
// ---------------------------------------------------------------------------

describe('botAddress', () => {
  it('returns the address derived from the private key', () => {
    const client = makeClient();
    // The mocked wallet client returns this address
    expect(client.botAddress).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });
});

// ---------------------------------------------------------------------------
// pay()
// ---------------------------------------------------------------------------

describe('pay()', () => {
  it('signs and posts to /v1/payments', async () => {
    const client = makeClient();
    const result = { requestId: 'pay-1', status: 'approved', txHash: '0xabc' };
    mockFetchOk(result);

    const response = await client.pay({
      to: '0x000000000000000000000000000000000000dead' as Address,
      token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
      amount: 1_000_000n,
      memo: 'test',
    });

    expect(response.status).toBe('approved');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RELAYER_URL}${RELAYER_API.PAYMENTS}`);
    expect(opts.method).toBe('POST');
  });

  it('includes optional metadata fields', async () => {
    const client = makeClient();
    mockFetchOk({ requestId: 'pay-2', status: 'approved' });

    await client.pay({
      to: '0x000000000000000000000000000000000000dead' as Address,
      token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
      amount: 1_000_000n,
      memo: 'test',
      recipientLabel: 'Weather Bot',
      invoiceId: 'INV-001',
      metadata: { source: 'test' },
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.recipientLabel).toBe('Weather Bot');
    expect(body.invoiceId).toBe('INV-001');
    expect(body.metadata).toEqual({ source: 'test' });
  });

  it('throws on non-ok response', async () => {
    const client = makeClient();
    mockFetchFail(400, 'Bad Request');

    await expect(
      client.pay({
        to: '0x000000000000000000000000000000000000dead' as Address,
        token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
        amount: 1_000_000n,
      }),
    ).rejects.toThrow('Relayer request failed [400]');
  });
});

// ---------------------------------------------------------------------------
// pay() — human-friendly amounts
// ---------------------------------------------------------------------------

describe('pay() with human-friendly inputs', () => {
  it('accepts token as bare string symbol and amount as number', async () => {
    const client = makeClient();
    mockFetchOk({ requestId: 'pay-hf1', status: 'approved' });

    await client.pay({
      to: '0x000000000000000000000000000000000000dead' as Address,
      token: 'USDC',
      amount: 5.2,
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    // 5.2 USDC = 5_200_000 base units
    expect(body.amount).toBe('5200000');
    // Token should be resolved to Base Sepolia USDC address
    expect(body.token).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  });

  it('accepts amount as string', async () => {
    const client = makeClient();
    mockFetchOk({ requestId: 'pay-hf2', status: 'approved' });

    await client.pay({
      to: '0x000000000000000000000000000000000000dead' as Address,
      token: 'USDC',
      amount: '10.5',
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.amount).toBe('10500000');
  });

  it('still works with bigint (backward compat)', async () => {
    const client = makeClient();
    mockFetchOk({ requestId: 'pay-hf3', status: 'approved' });

    await client.pay({
      to: '0x000000000000000000000000000000000000dead' as Address,
      token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
      amount: 1_000_000n,
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.amount).toBe('1000000');
  });
});

// ---------------------------------------------------------------------------
// execute()
// ---------------------------------------------------------------------------

describe('execute()', () => {
  it('signs and posts to /v1/execute', async () => {
    const client = makeClient();
    mockFetchOk({ requestId: 'exec-1', status: 'approved' });

    await client.execute({
      protocol: '0x000000000000000000000000000000000000beef' as Address,
      callData: '0x1234' as Hex,
      token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
      amount: 500_000n,
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RELAYER_URL}${RELAYER_API.EXECUTE}`);
  });
});

// ---------------------------------------------------------------------------
// swap()
// ---------------------------------------------------------------------------

describe('swap()', () => {
  it('signs and posts to /v1/swap', async () => {
    const client = makeClient();
    mockFetchOk({ requestId: 'swap-1', status: 'approved' });

    await client.swap({
      toToken: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
      minToAmount: 900_000n,
    });

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RELAYER_URL}${RELAYER_API.SWAP}`);
  });
});

// ---------------------------------------------------------------------------
// swap() — human-friendly amounts
// ---------------------------------------------------------------------------

describe('swap() with human-friendly inputs', () => {
  it('accepts toToken as symbol and minToAmount as number', async () => {
    const client = makeClient();
    mockFetchOk({ requestId: 'swap-hf1', status: 'approved' });

    await client.swap({
      toToken: 'WETH',
      minToAmount: 0.001,
    });

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    // 0.001 WETH = 1_000_000_000_000_000 base units
    expect(body.minToAmount).toBe('1000000000000000');
    // Token should be resolved to Base Sepolia WETH address
    expect(body.toToken).toBe('0x4200000000000000000000000000000000000006');
  });
});

// ---------------------------------------------------------------------------
// getBalance() — via relayer
// ---------------------------------------------------------------------------

describe('getBalance()', () => {
  it('fetches balance from relayer endpoint', async () => {
    const client = makeClient();
    const token = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address;
    mockFetchOk({ balance: '5000000' });

    const balance = await client.getBalance(token);
    expect(balance).toBe(5_000_000n);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RELAYER_URL}/v1/vault/${VAULT_ADDR}/balance/${token}?chainId=${CHAIN_ID}`);
  });

  it('throws on relayer error', async () => {
    const client = makeClient();
    mockFetchFail(500, 'Internal Server Error');
    await expect(client.getBalance('0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address)).rejects.toThrow(
      'Relayer request failed [500]',
    );
  });
});

// ---------------------------------------------------------------------------
// getBalances() — via relayer
// ---------------------------------------------------------------------------

describe('getBalances()', () => {
  it('fetches multiple balances from relayer', async () => {
    const client = makeClient();
    const tokens = [
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
    ];
    mockFetchOk({ balances: { [tokens[0]!]: '5000000', [tokens[1]!]: '10000000' } });

    const balances = await client.getBalances(tokens);
    expect(balances[tokens[0]!]).toBe(5_000_000n);
    expect(balances[tokens[1]!]).toBe(10_000_000n);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/v1/vault/${VAULT_ADDR}/balances?chainId=${CHAIN_ID}&tokens=`);
  });
});

// ---------------------------------------------------------------------------
// isActive() — via relayer
// ---------------------------------------------------------------------------

describe('isActive()', () => {
  it('fetches bot status from relayer', async () => {
    const client = makeClient();
    mockFetchOk({ isActive: true });

    expect(await client.isActive()).toBe(true);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${RELAYER_URL}/v1/vault/${VAULT_ADDR}/bot/0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266/status?chainId=${CHAIN_ID}`,
    );
  });
});

// ---------------------------------------------------------------------------
// isPaused() — via relayer
// ---------------------------------------------------------------------------

describe('isPaused()', () => {
  it('fetches vault info from relayer and returns paused state', async () => {
    const client = makeClient();
    mockFetchOk({ owner: '0xAAA', operator: '0xBBB', paused: false, version: 1 });

    expect(await client.isPaused()).toBe(false);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RELAYER_URL}/v1/vault/${VAULT_ADDR}/info?chainId=${CHAIN_ID}`);
  });
});

// ---------------------------------------------------------------------------
// getVaultInfo() — via relayer
// ---------------------------------------------------------------------------

describe('getVaultInfo()', () => {
  it('returns combined vault info from relayer', async () => {
    const client = makeClient();
    const expected = {
      owner: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      operator: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      paused: false,
      version: 1,
    };
    mockFetchOk(expected);

    const info = await client.getVaultInfo();
    expect(info.owner).toBe(expected.owner);
    expect(info.paused).toBe(false);
    expect(info.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// canPayTo() — via relayer
// ---------------------------------------------------------------------------

describe('canPayTo()', () => {
  it('checks destination via relayer', async () => {
    const client = makeClient();
    const dest = '0x000000000000000000000000000000000000dead' as Address;
    mockFetchOk({ allowed: true });

    const result = await client.canPayTo(dest);
    expect(result.allowed).toBe(true);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${RELAYER_URL}/v1/vault/${VAULT_ADDR}/bot/0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266/destination/${dest}?chainId=${CHAIN_ID}`,
    );
  });
});

// ---------------------------------------------------------------------------
// isContractApproved() — via relayer
// ---------------------------------------------------------------------------

describe('isContractApproved()', () => {
  it('checks contract approval via relayer', async () => {
    const client = makeClient();
    const protocol = '0x000000000000000000000000000000000000beef' as Address;
    mockFetchOk({ approved: true });

    expect(await client.isContractApproved(protocol)).toBe(true);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RELAYER_URL}/v1/vault/${VAULT_ADDR}/protocol/${protocol}?chainId=${CHAIN_ID}`);
  });
});

// ---------------------------------------------------------------------------
// poll() / pollExecute() / pollSwap()
// ---------------------------------------------------------------------------

describe('poll()', () => {
  it('GETs /v1/payments/:id', async () => {
    const client = makeClient();
    mockFetchOk({ requestId: 'r1', status: 'approved', txHash: '0xabc' });

    const result = await client.poll('r1');
    expect(result.status).toBe('approved');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RELAYER_URL}/v1/payments/r1`);
  });

  it('throws on non-ok response', async () => {
    const client = makeClient();
    mockFetchFail(404, 'Not Found');
    await expect(client.poll('bad-id')).rejects.toThrow('Relayer request failed [404]');
  });
});

describe('pollExecute()', () => {
  it('GETs /v1/execute/:id', async () => {
    const client = makeClient();
    mockFetchOk({ requestId: 'e1', status: 'pending_review' });

    const result = await client.pollExecute('e1');
    expect(result.status).toBe('pending_review');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RELAYER_URL}/v1/execute/e1`);
  });
});

describe('pollSwap()', () => {
  it('GETs /v1/swap/:id', async () => {
    const client = makeClient();
    mockFetchOk({ requestId: 's1', status: 'approved' });

    const result = await client.pollSwap('s1');
    expect(result.status).toBe('approved');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RELAYER_URL}/v1/swap/s1`);
  });
});

// ---------------------------------------------------------------------------
// getTosStatus()
// ---------------------------------------------------------------------------

describe('getTosStatus()', () => {
  it('GETs /v1/tos/status with wallet param', async () => {
    const client = makeClient();
    mockFetchOk({ accepted: false, tosVersion: 'v1' });

    const result = await client.getTosStatus('0xSomeWallet');
    expect(result.accepted).toBe(false);
    expect(result.tosVersion).toBe('v1');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${RELAYER_URL}/v1/tos/status?wallet=0xSomeWallet`);
  });

  it('returns accepted: true for wallets that have accepted', async () => {
    const client = makeClient();
    mockFetchOk({ accepted: true, tosVersion: 'v1' });

    const result = await client.getTosStatus('0xAcceptedWallet');
    expect(result.accepted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// acceptTos()
// ---------------------------------------------------------------------------

describe('acceptTos()', () => {
  it('fetches TOS version, signs message, and POSTs to /v1/tos/accept', async () => {
    const client = makeClient();
    const mockSignMessage = jest.fn<(...args: unknown[]) => Promise<unknown>>();
    mockSignMessage.mockResolvedValue('0xsignature');

    // First call: getTosStatus
    mockFetchOk({ accepted: false, tosVersion: 'v1' });
    // Second call: POST accept
    mockFetchOk({ accepted: true, tosVersion: 'v1' });

    const result = await client.acceptTos({ signMessage: mockSignMessage as any }, '0xOwnerWallet');

    expect(result.accepted).toBe(true);
    expect(mockSignMessage).toHaveBeenCalledTimes(1);

    // Verify the message format
    const signArgs = mockSignMessage.mock.calls[0]![0] as { message: string };
    expect(signArgs.message).toContain('I accept the Axon Terms of Service (v1)');
    expect(signArgs.message).toContain('Wallet: 0xOwnerWallet');
    expect(signArgs.message).toContain('Timestamp:');

    // Verify POST call
    const [url, opts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe(`${RELAYER_URL}/v1/tos/accept`);
    expect(opts.method).toBe('POST');

    const body = JSON.parse(opts.body as string);
    expect(body.wallet).toBe('0xOwnerWallet');
    expect(body.signature).toBe('0xsignature');
    expect(body.tosVersion).toBe('v1');
  });

  it('throws on non-ok response from accept endpoint', async () => {
    const client = makeClient();
    const mockSignMessage = jest.fn<(...args: unknown[]) => Promise<unknown>>();
    mockSignMessage.mockResolvedValue('0xsignature');

    // getTosStatus succeeds
    mockFetchOk({ accepted: false, tosVersion: 'v1' });
    // accept fails
    mockFetchFail(400, 'Invalid signature');

    await expect(client.acceptTos({ signMessage: mockSignMessage as any }, '0xOwnerWallet')).rejects.toThrow(
      'TOS acceptance failed [400]',
    );
  });
});

// ---------------------------------------------------------------------------
// signPayment() (low-level)
// ---------------------------------------------------------------------------

describe('signPayment() (low-level)', () => {
  it('returns the signature from signTypedData', async () => {
    const client = makeClient();
    const sig = await client.signPayment({
      bot: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
      to: '0x000000000000000000000000000000000000dead' as Address,
      token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
      amount: 1_000_000n,
      deadline: 99999999n,
      ref: '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex,
    });
    expect(sig).toMatch(/^0x/);
    expect(mockSignTypedData).toHaveBeenCalledTimes(1);
  });
});
