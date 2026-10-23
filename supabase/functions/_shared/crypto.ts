/**
 * Secret vault for bring-your-own-key (BYOK) provider API keys.
 *
 * - AES-256-GCM (authenticated encryption) via WebCrypto.
 * - The key-encryption key (KEK) lives only in Edge Function secrets
 *   (MATIQ_KEK_V{n}); the database stores ciphertext + IV + key version, so a
 *   database dump alone cannot reveal any key.
 * - Additional authenticated data binds each ciphertext to its owner and
 *   provider: a ciphertext copied onto another user's row fails to decrypt.
 * - KEKs are versioned so they can be rotated (see rotateRecord).
 * - Fingerprints are HMAC-SHA256 with a key derived from the KEK via HKDF,
 *   so equal API keys can be detected without storing them.
 */

import { ConfigError, env } from './env.ts';

const AAD_PREFIX = 'matiq:api-key:v1';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  keyVersion: number;
}

export class DecryptionError extends Error {
  override name = 'DecryptionError';
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const kekCache = new Map<number, Promise<{ aes: CryptoKey; hkdf: CryptoKey }>>();

/** Imports KEK `version` from secrets as non-extractable WebCrypto keys. */
function loadKek(version: number): Promise<{ aes: CryptoKey; hkdf: CryptoKey }> {
  let cached = kekCache.get(version);
  if (!cached) {
    cached = (async () => {
      const raw = fromBase64(env.kek(version));
      if (raw.byteLength !== 32) throw new ConfigError(`MATIQ_KEK_V${version} must be 32 bytes (base64)`);
      const aes = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
      const hkdf = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
      raw.fill(0);
      return { aes, hkdf };
    })().catch((error) => {
      kekCache.delete(version);
      throw error;
    });
    kekCache.set(version, cached);
  }
  return cached;
}

function aadFor(userId: string, provider: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${AAD_PREFIX}|${userId}|${provider}`);
}

export async function encryptSecret(plaintext: string, userId: string, provider: string): Promise<EncryptedSecret> {
  const keyVersion = env.kekCurrentVersion();
  const { aes } = await loadKek(keyVersion);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadFor(userId, provider), tagLength: 128 },
    aes,
    encoder.encode(plaintext),
  );
  return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv), keyVersion };
}

export async function decryptSecret(secret: EncryptedSecret, userId: string, provider: string): Promise<string> {
  try {
    const { aes } = await loadKek(secret.keyVersion);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(secret.iv), additionalData: aadFor(userId, provider), tagLength: 128 },
      aes,
      fromBase64(secret.ciphertext),
    );
    return decoder.decode(plaintext);
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new DecryptionError('Stored secret could not be decrypted');
  }
}

/** Re-encrypts a record under the current KEK version. */
export async function rotateRecord(secret: EncryptedSecret, userId: string, provider: string): Promise<EncryptedSecret> {
  const plaintext = await decryptSecret(secret, userId, provider);
  return encryptSecret(plaintext, userId, provider);
}

/** Stable, non-reversible identifier for a secret (first 16 hex chars). */
export async function fingerprintSecret(plaintext: string): Promise<string> {
  const { hkdf } = await loadKek(env.kekCurrentVersion());
  const hmacKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('matiq-fingerprint'), info: encoder.encode('v1') },
    hkdf,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(plaintext)));
  return Array.from(signature.slice(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Last four characters, for display ("sk-ant-...AbCd"). */
export function lastFour(secret: string): string {
  return secret.slice(-4);
}
