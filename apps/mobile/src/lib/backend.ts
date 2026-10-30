/**
 * MatIQ's backend on Neon (docs/NEON_CLERK_MIGRATION.md), with the call
 * shapes the app used with supabase-js so feature code reads the same:
 *
 * - `backend.from()` / `backend.rpc()`: Neon's Data API (PostgREST). Row
 *   Level Security decides what each user sees; the request carries the
 *   Clerk session token, which the Data API checks against Clerk's keys.
 * - `backend.functions.invoke(name)`: a route of the `api` Neon Function
 *   (`account`, `analyze-match`, `api-keys`, `moderation`, `ranked`).
 * - `backend.storage.from(bucket)`: files in Neon Object Storage through
 *   the function's `files` routes, which apply the same storage rules as
 *   before (checked in the database as the user) and hand out presigned
 *   links. Small files (frames, pictures) go through the function, which
 *   checks them; videos are uploaded straight to storage with a link.
 *
 * No secret ships in the app: the Data API and function URLs are public and
 * every request is authorized by the user's own token.
 */

import { PostgrestClient } from '@supabase/postgrest-js';
import { env } from '@/config/env';
import { FunctionError } from './function-error';

export { FunctionError };

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = async () => null;

/** Set by AuthProvider: Clerk's short-lived session token for the signed-in user. */
export function setTokenGetter(getter: TokenGetter): void {
  getToken = getter;
}

const authorizedFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  const token = await getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  else headers.delete('Authorization');
  return fetch(input, { ...init, headers });
};

type Result<T> = { data: T; error: null } | { data: null; error: Error };

async function call<T>(path: string, init: RequestInit): Promise<Result<T>> {
  try {
    const response = await authorizedFetch(`${env.functionsUrl}/${path}`, init);
    if (!response.ok) return { data: null, error: new FunctionError(response) };
    const text = await response.text();
    return { data: (text ? JSON.parse(text) : null) as T, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

function invoke<T = unknown>(name: string, options: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown } = {}): Promise<Result<T>> {
  const hasBody = options.body !== undefined;
  return call<T>(name, {
    method: options.method ?? 'POST',
    ...(hasBody ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) } : {}),
  });
}

function bucket(name: string) {
  const json = <T>(route: string, body: Record<string, unknown>) => invoke<T>(`files/${route}`, { body: { bucket: name, ...body } });
  return {
    /** Uploads a small file (at most a few MB) through the function. */
    async upload(path: string, bytes: ArrayBuffer | Uint8Array, options: { contentType: string; upsert?: boolean }) {
      const query = new URLSearchParams({ bucket: name, path, upsert: options.upsert ? '1' : '0' });
      const result = await call<{ path: string }>(`files/upload?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': options.contentType },
        body: bytes as BodyInit,
      });
      if (result.error instanceof FunctionError && result.error.context.status === 409) {
        return { data: null, error: new Error('The file already exists') };
      }
      return result;
    },
    /** A presigned PUT link for a large upload, valid only for this exact size and type. */
    createSignedUploadUrl(path: string, file: { size: number; contentType: string; upsert?: boolean }) {
      return json<{ signedUrl: string; path: string }>('sign-upload', {
        path,
        upsert: file.upsert ?? false,
        size: file.size,
        contentType: file.contentType,
      });
    },
    createSignedUrl(path: string, expiresIn: number) {
      return json<{ signedUrl: string }>('sign-download', { path, expiresIn });
    },
    list(prefix: string, options: { limit?: number } = {}) {
      return json<{ name: string }[]>('list', { prefix, limit: options.limit ?? 100 });
    },
    remove(paths: string[]) {
      return json<{ name: string }[]>('remove', { paths });
    },
  };
}

const database = new PostgrestClient(env.dataApiUrl, { fetch: authorizedFetch });

export const backend = {
  from: database.from.bind(database),
  rpc: database.rpc.bind(database),
  functions: { invoke },
  storage: { from: bucket },
};
