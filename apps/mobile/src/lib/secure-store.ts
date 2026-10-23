/**
 * Hardware-backed secret storage (iOS Keychain / Android Keystore via
 * expo-secure-store). Used only for small secrets - most importantly the key
 * that encrypts the local MMKV store.
 *
 * WHEN_UNLOCKED_THIS_DEVICE_ONLY: readable only while the device is unlocked
 * and never migrated to another device through backups.
 */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Returns the device-local random key stored under `name`, creating it on
 * first use. 24 random bytes encode to exactly 32 base64 characters, the
 * maximum key length for MMKV's AES-256 mode.
 */
export async function getOrCreateDeviceKey(name: string): Promise<string> {
  const existing = await SecureStore.getItemAsync(name, OPTIONS);
  if (existing) return existing;
  const key = toBase64(Crypto.getRandomBytes(24));
  await SecureStore.setItemAsync(name, key, OPTIONS);
  return key;
}

export async function deleteDeviceKey(name: string): Promise<void> {
  await SecureStore.deleteItemAsync(name, OPTIONS);
}
