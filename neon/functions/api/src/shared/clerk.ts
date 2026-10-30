/**
 * Clerk's Backend API, for what MatIQ decides about an account: a ban (so
 * the person can't sign in at all), lifting it, and deleting the account.
 *
 * The database queues these in `private.clerk_sync` (on `app.users`
 * changes); `runClerkSync` applies them. It runs after an account is
 * deleted and on a schedule, so a ban from the owner panel (a database
 * call) reaches Clerk within minutes. Without CLERK_SECRET_KEY they wait.
 */

import { rpc } from './db.ts';
import { env } from './env.ts';
import type { Logger } from './log.ts';

const API = 'https://api.clerk.com/v1';

type Action = 'ban' | 'unban' | 'delete';

async function clerkRequest(secretKey: string, method: string, path: string, fetchFn: typeof fetch = fetch): Promise<Response> {
  return fetchFn(`${API}${path}`, { method, headers: { Authorization: `Bearer ${secretKey}` }, signal: AbortSignal.timeout(15_000) });
}

/** Applies one change in Clerk; a user Clerk no longer has counts as done. */
export async function applyInClerk(secretKey: string, clerkId: string, action: Action, fetchFn: typeof fetch = fetch): Promise<void> {
  const user = `/users/${encodeURIComponent(clerkId)}`;
  const response =
    action === 'delete'
      ? await clerkRequest(secretKey, 'DELETE', user, fetchFn)
      : await clerkRequest(secretKey, 'POST', `${user}/${action}`, fetchFn);
  if (response.ok || response.status === 404) return;
  throw new Error(`Clerk answered ${response.status} to ${action}`);
}

/** The account's primary email from Clerk (for the data export), or null. */
export async function clerkEmail(clerkId: string, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const secretKey = env.clerkSecretKey();
  if (!secretKey) return null;
  const response = await clerkRequest(secretKey, 'GET', `/users/${encodeURIComponent(clerkId)}`, fetchFn);
  if (!response.ok) return null;
  const user = (await response.json()) as {
    primary_email_address_id?: string | null;
    email_addresses?: { id: string; email_address: string }[];
  };
  return user.email_addresses?.find((address) => address.id === user.primary_email_address_id)?.email_address ?? null;
}

/** Applies queued bans, unbans and deletions. Returns how many went through. */
export async function runClerkSync(log: Logger, limit = 50): Promise<number> {
  const secretKey = env.clerkSecretKey();
  if (!secretKey) return 0;
  const { data, error } = await rpc<{ id: number; clerk_id: string; action: Action }[]>('svc_next_clerk_sync', { p_limit: limit });
  if (error) throw new Error(`loading Clerk changes failed: ${error.message}`);
  let done = 0;
  for (const change of data ?? []) {
    let failure: string | null = null;
    try {
      await applyInClerk(secretKey, change.clerk_id, change.action);
      done++;
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : String(cause);
      log.warn('Clerk change failed', { action: change.action, error: failure });
    }
    const { error: finishError } = await rpc('svc_finish_clerk_sync', { p_id: change.id, p_error: failure });
    if (finishError) log.warn('marking a Clerk change failed', { error: finishError.message });
  }
  return done;
}
