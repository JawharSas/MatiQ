/**
 * Client for the `api-keys` Edge Function. The plaintext key is sent once
 * over TLS and never stored on the device; the app only ever sees metadata.
 */

import { useQuery } from '@tanstack/react-query';
import { fromFunctionError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export interface StoredKey {
  provider: 'anthropic';
  last4: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}

export async function listKeys(): Promise<StoredKey[]> {
  const { data, error } = await supabase.functions.invoke<{ keys: StoredKey[] }>('api-keys', { method: 'GET' });
  if (error || !data) throw await fromFunctionError(error);
  return data.keys;
}

export async function storeKey(apiKey: string, label?: string): Promise<void> {
  const { error } = await supabase.functions.invoke('api-keys', {
    method: 'POST',
    body: { provider: 'anthropic', apiKey, ...(label ? { label } : {}) },
  });
  if (error) throw await fromFunctionError(error);
}

export async function deleteKey(): Promise<void> {
  const { error } = await supabase.functions.invoke('api-keys?provider=anthropic', { method: 'DELETE' });
  if (error) throw await fromFunctionError(error);
}

export function useStoredKeys(enabled = true) {
  return useQuery({ queryKey: ['api-keys'], queryFn: listKeys, staleTime: 60_000, enabled });
}
