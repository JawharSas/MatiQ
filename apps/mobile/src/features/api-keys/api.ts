/**
 * Client for the `api-keys` Edge Function. The plaintext key is sent over TLS
 * only to check and save it, and never stored on the device; the app only
 * ever sees metadata.
 */

import { useQuery } from '@tanstack/react-query';
import { fromFunctionError } from '@/lib/errors';
import { backend } from '@/lib/backend';
import type { ProviderId } from './providers';

export interface StoredKey {
  provider: ProviderId;
  last4: string;
  label: string | null;
  model: string | null;
  base_url: string | null;
  /** The key analyses use (the one saved or chosen last). */
  active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface ModelChoice {
  id: string;
  /** true: reads images; false: does not; null: unknown. */
  vision: boolean | null;
}

export interface KeyCheck {
  /** False when the service has no model list: the model is typed in. */
  listed: boolean;
  models: ModelChoice[];
  suggested: string | null;
}

export interface KeyInput {
  provider: ProviderId;
  apiKey: string;
  baseUrl?: string;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await backend.functions.invoke<T>('api-keys', { method: 'POST', body });
  if (error || !data) throw await fromFunctionError(error);
  return data;
}

export async function listKeys(): Promise<StoredKey[]> {
  const { data, error } = await backend.functions.invoke<{ keys: StoredKey[] }>('api-keys', { method: 'GET' });
  if (error || !data) throw await fromFunctionError(error);
  return data.keys;
}

/** Verifies the key with the provider and lists the models it can use. Nothing is stored. */
export function checkKey(input: KeyInput): Promise<KeyCheck> {
  return call<KeyCheck>({ action: 'check', ...input });
}

/** Tests the model with one small picture, then stores the key and uses it for analyses. */
export async function storeKey(input: KeyInput & { model: string; label?: string }): Promise<void> {
  await call({ action: 'save', ...input });
}

export async function selectKey(provider: ProviderId): Promise<void> {
  await call({ action: 'select', provider });
}

export async function deleteKey(provider: ProviderId): Promise<void> {
  const { error } = await backend.functions.invoke(`api-keys?provider=${provider}`, { method: 'DELETE' });
  if (error) throw await fromFunctionError(error);
}

export function useStoredKeys(enabled = true) {
  return useQuery({ queryKey: ['api-keys'], queryFn: listKeys, staleTime: 60_000, enabled });
}
