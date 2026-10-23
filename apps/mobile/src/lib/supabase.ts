/**
 * Supabase client.
 *
 * - Only the public URL + anon key ship in the app; authorization is enforced
 *   by Row Level Security and server-side checks.
 * - Sessions are persisted in the AES-256 encrypted MMKV store.
 * - PKCE flow for email links; tokens auto-refresh (refresh tokens rotate
 *   server-side) only while the app is in the foreground.
 * - The client is created by `initSupabase()` during boot, AFTER TLS pinning
 *   is active: supabase-js may refresh the session as soon as it is
 *   constructed, and that first request must already be pinned.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { env } from '@/config/env';
import { authStorage } from './storage';

let client: SupabaseClient | null = null;

export function initSupabase(): SupabaseClient {
  if (client) return client;
  client = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      storage: authStorage,
      storageKey: 'matiq.auth',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: { headers: { 'X-Client-Info': 'matiq-mobile/1.0.0' } },
  });

  const created = client;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') created.auth.startAutoRefresh();
    else created.auth.stopAutoRefresh();
  });
  return client;
}

/**
 * The app-wide client. Accessing it before `initSupabase()` throws, which
 * makes an accidental unpinned request during startup impossible.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    if (!client) throw new Error('Supabase client used before initSupabase()');
    const value: unknown = Reflect.get(client, property, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
