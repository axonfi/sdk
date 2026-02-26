import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Address, Hex } from 'viem';

// ---------------------------------------------------------------------------
// Mock modules — must be before imports that use them
// ---------------------------------------------------------------------------

const mockReadContract = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockMulticall = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockSignTypedData = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.unstable_mockModule('./vault.js', () => ({
  createAxonPublicClient: jest.fn(() => ({
    readContract: mockReadContract,
    multicall: mockMulticall,
  })),
  createAxonWalletClient: jest.fn(() => ({
    account: { address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
    signTypedData: mockSignTypedData,
  })),
  getBotConfig: jest.fn<(...args: unknown[]) => Promise<unknown>>(), // kept in mock for vault.ts internal use
  isBotActive: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  isVaultPaused: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  getVaultOwner: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  getVaultOperator: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  getVaultVersion: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  getTrackUsedIntents: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  isDestinationAllowed: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

// Dynamic imports — must come after jest.unstable_mockModule
const { AxonClient } = await import('./client.js');
const vaultMod = await import('./vault.js');
const { RELAYER_API } = await import('./constants.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VAULT_ADDR = '0x1111111111111111111111111111111111111111' as Address;
const BOT_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const CHAIN_ID = 84532;
const RELAYER_URL = 'https://relay.example.com';
const RPC_URL = 'https://rpc.example.com';

function makeClient() {
  return new AxonClient({
    vaultAddress: VAULT_ADDR,
    chainId: CHAIN_ID,
    botPrivateKey: BOT_KEY,
    relayerUrl: RELAYER_URL,
    rpcUrl: RPC_URL,
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
  it('strips trailing slash from relayerUrl', () => {
    const client = new AxonClient({
      vaultAddress: VAULT_ADDR,
      chainId: CHAIN_ID,
      botPrivateKey: BOT_KEY,
      relayerUrl: 'https://relay.example.com/',
      rpcUrl: RPC_URL,
    });
    // Verify by calling poll and checking the URL
    mockFetchOk({ requestId: 'r1', status: 'approved' });
    client.poll('r1');
    expect(fetchMock).toHaveBeenCalledWith(expect.not.stringContaining('//v1'), expect.anything());
  });

  it('throws if botPrivateKey is missing', () => {
    expect(
      () =>
        new AxonClient({
          vaultAddress: VAULT_ADDR,
          chainId: CHAIN_ID,
          relayerUrl: RELAYER_URL,
          rpcUrl: RPC_URL,
        }),
    ).toThrow('botPrivateKey is required');
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
// getBalance()
// ---------------------------------------------------------------------------

describe('getBalance()', () => {
  it('reads ERC-20 balanceOf from the vault', async () => {
    const client = makeClient();
    const token = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address;
    mockReadContract.mockResolvedValueOnce(5_000_000n);

    const balance = await client.getBalance(token);
    expect(balance).toBe(5_000_000n);
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'balanceOf',
        args: [VAULT_ADDR],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// isActive()
// ---------------------------------------------------------------------------

describe('isActive()', () => {
  it('delegates to isBotActive', async () => {
    const client = makeClient();
    (vaultMod.isBotActive as jest.Mock<any>).mockResolvedValueOnce(true);

    expect(await client.isActive()).toBe(true);
    expect(vaultMod.isBotActive).toHaveBeenCalledWith(
      expect.anything(),
      VAULT_ADDR,
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    );
  });
});

// ---------------------------------------------------------------------------
// isPaused()
// ---------------------------------------------------------------------------

describe('isPaused()', () => {
  it('delegates to isVaultPaused', async () => {
    const client = makeClient();
    (vaultMod.isVaultPaused as jest.Mock<any>).mockResolvedValueOnce(false);

    expect(await client.isPaused()).toBe(false);
    expect(vaultMod.isVaultPaused).toHaveBeenCalledWith(expect.anything(), VAULT_ADDR);
  });
});

// ---------------------------------------------------------------------------
// getVaultInfo()
// ---------------------------------------------------------------------------

describe('getVaultInfo()', () => {
  it('returns combined vault info from parallel reads', async () => {
    const client = makeClient();
    (vaultMod.getVaultOwner as jest.Mock<any>).mockResolvedValueOnce('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    (vaultMod.getVaultOperator as jest.Mock<any>).mockResolvedValueOnce('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    (vaultMod.isVaultPaused as jest.Mock<any>).mockResolvedValueOnce(false);
    (vaultMod.getVaultVersion as jest.Mock<any>).mockResolvedValueOnce(1);
    (vaultMod.getTrackUsedIntents as jest.Mock<any>).mockResolvedValueOnce(true);

    const info = await client.getVaultInfo();

    expect(info.owner).toBe('0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(info.operator).toBe('0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
    expect(info.paused).toBe(false);
    expect(info.version).toBe(1);
    expect(info.trackUsedIntents).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canPayTo()
// ---------------------------------------------------------------------------

describe('canPayTo()', () => {
  it('delegates to isDestinationAllowed', async () => {
    const client = makeClient();
    const dest = '0x000000000000000000000000000000000000dead' as Address;
    (vaultMod.isDestinationAllowed as jest.Mock<any>).mockResolvedValueOnce({ allowed: true });

    const result = await client.canPayTo(dest);
    expect(result.allowed).toBe(true);
    expect(vaultMod.isDestinationAllowed).toHaveBeenCalledWith(
      expect.anything(),
      VAULT_ADDR,
      '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      dest,
    );
  });
});

// ---------------------------------------------------------------------------
// isProtocolApproved()
// ---------------------------------------------------------------------------

describe('isProtocolApproved()', () => {
  it('reads isProtocolApproved from the vault contract', async () => {
    const client = makeClient();
    const protocol = '0x000000000000000000000000000000000000beef' as Address;
    mockReadContract.mockResolvedValueOnce(true);

    expect(await client.isProtocolApproved(protocol)).toBe(true);
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: 'isProtocolApproved',
        args: [protocol],
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getBalances()
// ---------------------------------------------------------------------------

describe('getBalances()', () => {
  it('uses multicall to read multiple token balances', async () => {
    const client = makeClient();
    const tokens = [
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
      '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
    ];
    mockMulticall.mockResolvedValueOnce([
      { status: 'success', result: 5_000_000n },
      { status: 'success', result: 10_000_000n },
    ]);

    const balances = await client.getBalances(tokens);

    expect(balances[tokens[0]!]).toBe(5_000_000n);
    expect(balances[tokens[1]!]).toBe(10_000_000n);
    expect(mockMulticall).toHaveBeenCalledTimes(1);
  });

  it('returns 0n for failed multicall results', async () => {
    const client = makeClient();
    const tokens = ['0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address];
    mockMulticall.mockResolvedValueOnce([{ status: 'failure', error: new Error('revert') }]);

    const balances = await client.getBalances(tokens);
    expect(balances[tokens[0]!]).toBe(0n);
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
    await expect(client.poll('bad-id')).rejects.toThrow('Relayer poll failed [404]');
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
