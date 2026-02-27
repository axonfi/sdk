import { jest, describe, it, expect } from '@jest/globals';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encryptKeystore, decryptKeystore } from './keystore.js';
import type { KeystoreV3 } from './keystore.js';

// Scrypt is CPU-intensive — bump timeout for CI
jest.setTimeout(30_000);

describe('keystore', () => {
  const TEST_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const PASSPHRASE = 'test-passphrase-123';

  describe('encryptKeystore', () => {
    it('produces valid V3 keystore structure', async () => {
      const ks = await encryptKeystore(TEST_KEY, PASSPHRASE);

      expect(ks.version).toBe(3);
      expect(ks.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(ks.address).toMatch(/^[0-9a-f]{40}$/);
      expect(ks.crypto.cipher).toBe('aes-128-ctr');
      expect(ks.crypto.kdf).toBe('scrypt');
      expect(ks.crypto.kdfparams.n).toBe(262144);
      expect(ks.crypto.kdfparams.r).toBe(8);
      expect(ks.crypto.kdfparams.p).toBe(1);
      expect(ks.crypto.kdfparams.dklen).toBe(32);
      expect(ks.crypto.ciphertext).toHaveLength(64); // 32 bytes hex
      expect(ks.crypto.cipherparams.iv).toHaveLength(32); // 16 bytes hex
      expect(ks.crypto.kdfparams.salt).toHaveLength(64); // 32 bytes hex
      expect(ks.crypto.mac).toHaveLength(64); // 32 bytes hex
    });

    it('derives correct address', async () => {
      const ks = await encryptKeystore(TEST_KEY, PASSPHRASE);
      const expected = privateKeyToAccount(TEST_KEY).address.slice(2).toLowerCase();
      expect(ks.address).toBe(expected);
    });

    it('throws on empty passphrase', async () => {
      await expect(encryptKeystore(TEST_KEY, '')).rejects.toThrow('Passphrase must not be empty');
    });
  });

  describe('decryptKeystore', () => {
    it('round-trips: encrypt then decrypt returns original key', async () => {
      const ks = await encryptKeystore(TEST_KEY, PASSPHRASE);
      const decrypted = await decryptKeystore(ks, PASSPHRASE);
      expect(decrypted).toBe(TEST_KEY);
    });

    it('works with a randomly generated key', async () => {
      const randomKey = generatePrivateKey();
      const ks = await encryptKeystore(randomKey, 'another-pass');
      const decrypted = await decryptKeystore(ks, 'another-pass');
      expect(decrypted).toBe(randomKey);
    });

    it('throws MAC mismatch on wrong passphrase', async () => {
      const ks = await encryptKeystore(TEST_KEY, PASSPHRASE);
      await expect(decryptKeystore(ks, 'wrong-password')).rejects.toThrow('Wrong passphrase: MAC mismatch');
    });

    it('accepts JSON string input', async () => {
      const ks = await encryptKeystore(TEST_KEY, PASSPHRASE);
      const jsonStr = JSON.stringify(ks);
      const decrypted = await decryptKeystore(jsonStr, PASSPHRASE);
      expect(decrypted).toBe(TEST_KEY);
    });

    it('throws on invalid JSON string', async () => {
      await expect(decryptKeystore('not-json', PASSPHRASE)).rejects.toThrow('Invalid keystore: could not parse JSON');
    });

    it('throws on unsupported version', async () => {
      const ks = await encryptKeystore(TEST_KEY, PASSPHRASE);
      const bad = { ...ks, version: 2 } as unknown as KeystoreV3;
      await expect(decryptKeystore(bad, PASSPHRASE)).rejects.toThrow('Unsupported keystore version: 2');
    });

    it('throws on missing crypto field', async () => {
      const bad = { version: 3, id: 'test', address: 'test' } as unknown as KeystoreV3;
      await expect(decryptKeystore(bad, PASSPHRASE)).rejects.toThrow('Invalid keystore: missing crypto field');
    });
  });
});
