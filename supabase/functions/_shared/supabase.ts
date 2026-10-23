/**
 * Supabase clients for Edge Functions.
 *
 * - `adminClient()` uses the service-role key and bypasses RLS. It is only
 *   used for `svc_*` RPCs and storage operations whose authorization has
 *   already been checked in code.
 * - `authenticateRequest()` validates the caller's JWT with the Auth server
 *   (so revoked sessions are rejected, not just expired ones).
 */

import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { env } from './env.ts';
import { HttpError } from './http.ts';

let cachedAdmin: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (!cachedAdmin) {
    cachedAdmin = createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'X-Client-Info': 'matiq-edge' } },
    });
  }
  return cachedAdmin;
}

const BEARER = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/;

export async function authenticateRequest(req: Request): Promise<User> {
  const match = BEARER.exec(req.headers.get('Authorization') ?? '');
  if (!match?.[1]) throw new HttpError(401, 'unauthorized', 'Missing bearer token');

  const { data, error } = await adminClient().auth.getUser(match[1]);
  if (error || !data.user) throw new HttpError(401, 'unauthorized', 'Invalid or expired session');
  if (data.user.role !== 'authenticated') throw new HttpError(403, 'forbidden');
  return data.user;
}
