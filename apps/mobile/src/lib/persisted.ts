import { readCache } from './storage';

/**
 * Keeps a query's last result on this device (encrypted, cleared when the
 * session ends): on the next open the screen shows it straight away while
 * the fresh copy loads. The root QueryCache saves each result under
 * `meta.persist` (src/app/_layout.tsx). Only for JSON data.
 *
 *   useQuery({ queryKey: ['friends'], ...persisted<Friend[]>('friends'), queryFn })
 */
export function persisted<T>(key: string) {
  return { meta: { persist: key }, placeholderData: (): T | undefined => readCache<T>(key) };
}
