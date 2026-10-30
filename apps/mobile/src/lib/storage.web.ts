/**
 * Browser UI preview only (see src/preview/README.md): the same API as
 * storage.ts, backed by memory. The native app uses the encrypted MMKV store.
 */

class MemoryStore {
  private readonly values = new Map<string, string>();
  set(key: string, value: string): void {
    this.values.set(key, value);
  }
  getString(key: string): string | undefined {
    return this.values.get(key);
  }
  remove(key: string): boolean {
    return this.values.delete(key);
  }
  getAllKeys(): string[] {
    return [...this.values.keys()];
  }
  clearAll(): void {
    this.values.clear();
  }
}

const CACHE_PREFIX = 'cache:';
const PREFERENCE_PREFIX = 'pref:';
const instance = new MemoryStore();

export function openSecureStorage(): Promise<MemoryStore> {
  return Promise.resolve(instance);
}

export function readCache<T>(key: string, maxAgeMs = 24 * 60 * 60 * 1000): T | undefined {
  const raw = instance.getString(CACHE_PREFIX + key);
  if (!raw) return undefined;
  const entry = JSON.parse(raw) as { savedAt: number; data: T };
  return Date.now() - entry.savedAt <= maxAgeMs ? entry.data : undefined;
}

export function writeCache<T>(key: string, data: T): void {
  instance.set(CACHE_PREFIX + key, JSON.stringify({ savedAt: Date.now(), data }));
}

export function readPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = instance.getString(PREFERENCE_PREFIX + key);
  return value !== undefined && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function writePreference(key: string, value: string): void {
  instance.set(PREFERENCE_PREFIX + key, value);
}

export function clearCache(): void {
  for (const key of instance.getAllKeys()) if (key.startsWith(CACHE_PREFIX)) instance.remove(key);
}
