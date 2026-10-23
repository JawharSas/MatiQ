/**
 * Encrypted local storage.
 *
 * One MMKV instance encrypted with AES-256. Its key is generated on the
 * device and kept in the Keychain/Keystore (see secure-store.ts), so the
 * on-disk file is unreadable without the hardware-protected key.
 *
 * Holds the Supabase session (access + refresh token) and a small offline
 * cache of non-sensitive screens (feed, match list) for instant startup.
 */

import { createMMKV, type MMKV } from 'react-native-mmkv';
import { getOrCreateDeviceKey } from './secure-store';

const KEY_NAME = 'matiq.mmkv.key.v1';
const STORE_ID = 'matiq.secure.v1';
const CACHE_PREFIX = 'cache:';

let instance: MMKV | null = null;
let opening: Promise<MMKV> | null = null;

export function openSecureStorage(): Promise<MMKV> {
  opening ??= getOrCreateDeviceKey(KEY_NAME).then((encryptionKey) => {
    instance = createMMKV({
      id: STORE_ID,
      encryptionKey,
      encryptionType: 'AES-256',
      // If the key no longer matches the file (e.g. restored from another
      // device), start clean instead of crashing on corrupt data.
      recoveryStrategy: 'discard-on-error',
    });
    return instance;
  });
  return opening;
}

/** Async storage adapter for supabase-js auth sessions. */
export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    return (await openSecureStorage()).getString(key) ?? null;
  },
  async setItem(key: string, value: string): Promise<void> {
    (await openSecureStorage()).set(key, value);
  },
  async removeItem(key: string): Promise<void> {
    (await openSecureStorage()).remove(key);
  },
};

interface CacheEntry<T> {
  savedAt: number;
  data: T;
}

/** Synchronous cache read (undefined until storage is open or when stale). */
export function readCache<T>(key: string, maxAgeMs = 24 * 60 * 60 * 1000): T | undefined {
  const raw = instance?.getString(CACHE_PREFIX + key);
  if (!raw) return undefined;
  try {
    const entry = JSON.parse(raw) as CacheEntry<T>;
    return Date.now() - entry.savedAt <= maxAgeMs ? entry.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeCache<T>(key: string, data: T): void {
  instance?.set(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), data } satisfies CacheEntry<T>));
}

/** Removes every cached screen (called on sign-out and account switch). */
export function clearCache(): void {
  if (!instance) return;
  for (const key of instance.getAllKeys()) {
    if (key.startsWith(CACHE_PREFIX)) instance.remove(key);
  }
}
