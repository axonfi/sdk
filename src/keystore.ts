// ============================================================================
// V3 Keystore — Encrypt / Decrypt bot private keys
// ============================================================================
//
// Standard Ethereum V3 keystore format (same as MetaMask / Geth).
// Uses scrypt KDF + AES-128-CTR cipher + keccak256 MAC.

import { scryptAsync } from '@noble/hashes/scrypt';
import { keccak_256 } from '@noble/hashes/sha3';
import { ctr } from '@noble/ciphers/aes';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { generateUuid } from './utils.js';

// ============================================================================
// Types
// ============================================================================

export interface KeystoreV3 {
  version: 3;
  id: string;
  address: string; // lowercase hex, no 0x prefix
  crypto: {
    ciphertext: string;
    cipherparams: { iv: string };
    cipher: 'aes-128-ctr';
    kdf: 'scrypt';
    kdfparams: {
      dklen: number;
      salt: string;
      n: number;
      r: number;
      p: number;
    };
    mac: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

const SCRYPT_N = 262144; // 2^18
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DKLEN = 32;

// ============================================================================
// Helpers
// ============================================================================

function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    const { randomBytes } = require('crypto') as typeof import('crypto');
    const buf = randomBytes(length);
    for (let i = 0; i < length; i++) bytes[i] = buf[i] ?? 0;
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// encryptKeystore
// ============================================================================

/**
 * Encrypt a raw private key into a V3 keystore JSON object.
 *
 * Uses scrypt KDF (n=262144, r=8, p=1) and AES-128-CTR cipher —
 * the same format as MetaMask and Geth.
 *
 * @param privateKey - Raw private key as 0x-prefixed hex string
 * @param passphrase - Passphrase to encrypt with (min 1 character)
 * @returns V3 keystore object ready to serialize as JSON
 *
 * @example
 * ```ts
 * import { encryptKeystore } from '@axonfi/sdk';
 *
 * const keystore = await encryptKeystore('0xabc...', 'my-strong-passphrase');
 * fs.writeFileSync('bot-keystore.json', JSON.stringify(keystore, null, 2));
 * ```
 */
export async function encryptKeystore(privateKey: Hex, passphrase: string): Promise<KeystoreV3> {
  if (!passphrase) throw new Error('Passphrase must not be empty');

  const keyBytes = hexToBytes(privateKey);
  const account = privateKeyToAccount(privateKey);
  const address = account.address.slice(2).toLowerCase(); // no 0x prefix

  // Random salt and IV
  const salt = getRandomBytes(32);
  const iv = getRandomBytes(16);

  // Derive key via scrypt
  const derivedKey = await scryptAsync(
    new TextEncoder().encode(passphrase),
    salt,
    { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, dkLen: SCRYPT_DKLEN },
  );

  // Encrypt with AES-128-CTR (first 16 bytes of derived key)
  const encryptionKey = derivedKey.slice(0, 16);
  const cipher = ctr(encryptionKey, iv);
  const ciphertext = cipher.encrypt(keyBytes);

  // MAC = keccak256(derivedKey[16:32] ++ ciphertext)
  const macInput = new Uint8Array(16 + ciphertext.length);
  macInput.set(derivedKey.slice(16, 32), 0);
  macInput.set(ciphertext, 16);
  const mac = keccak_256(macInput);

  return {
    version: 3,
    id: generateUuid(),
    address,
    crypto: {
      ciphertext: bytesToHex(ciphertext),
      cipherparams: { iv: bytesToHex(iv) },
      cipher: 'aes-128-ctr',
      kdf: 'scrypt',
      kdfparams: {
        dklen: SCRYPT_DKLEN,
        salt: bytesToHex(salt),
        n: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
      },
      mac: bytesToHex(mac),
    },
  };
}

// ============================================================================
// decryptKeystore
// ============================================================================

/**
 * Decrypt a V3 keystore back to a raw private key.
 *
 * @param keystore - V3 keystore object or JSON string
 * @param passphrase - Passphrase used during encryption
 * @returns Raw private key as 0x-prefixed hex string
 * @throws Error if passphrase is wrong (MAC mismatch) or keystore is invalid
 *
 * @example
 * ```ts
 * import { AxonClient, decryptKeystore } from '@axonfi/sdk';
 *
 * const keystore = JSON.parse(fs.readFileSync('bot-keystore.json', 'utf8'));
 * const privateKey = await decryptKeystore(keystore, process.env.BOT_PASSPHRASE!);
 * const client = new AxonClient({ botPrivateKey: privateKey, ... });
 * ```
 */
export async function decryptKeystore(keystore: KeystoreV3 | string, passphrase: string): Promise<Hex> {
  // Parse JSON string if needed
  let ks: KeystoreV3;
  if (typeof keystore === 'string') {
    try {
      ks = JSON.parse(keystore) as KeystoreV3;
    } catch {
      throw new Error('Invalid keystore: could not parse JSON');
    }
  } else {
    ks = keystore;
  }

  // Validate structure
  if (ks.version !== 3) throw new Error(`Unsupported keystore version: ${ks.version}`);
  if (!ks.crypto) throw new Error('Invalid keystore: missing crypto field');
  if (ks.crypto.kdf !== 'scrypt') throw new Error(`Unsupported KDF: ${ks.crypto.kdf}`);
  if (ks.crypto.cipher !== 'aes-128-ctr') throw new Error(`Unsupported cipher: ${ks.crypto.cipher}`);

  const { kdfparams, ciphertext: ctHex, cipherparams, mac: expectedMacHex } = ks.crypto;

  // Derive key via scrypt
  const salt = hexToBytes(kdfparams.salt);
  const derivedKey = await scryptAsync(
    new TextEncoder().encode(passphrase),
    salt,
    { N: kdfparams.n, r: kdfparams.r, p: kdfparams.p, dkLen: kdfparams.dklen },
  );

  // Verify MAC
  const ciphertextBytes = hexToBytes(ctHex);
  const macInput = new Uint8Array(16 + ciphertextBytes.length);
  macInput.set(derivedKey.slice(16, 32), 0);
  macInput.set(ciphertextBytes, 16);
  const computedMac = bytesToHex(keccak_256(macInput));

  if (computedMac !== expectedMacHex) {
    throw new Error('Wrong passphrase: MAC mismatch');
  }

  // Decrypt with AES-128-CTR
  const iv = hexToBytes(cipherparams.iv);
  const encryptionKey = derivedKey.slice(0, 16);
  const cipher = ctr(encryptionKey, iv);
  const plaintext = cipher.decrypt(ciphertextBytes);

  return `0x${bytesToHex(plaintext)}` as Hex;
}
