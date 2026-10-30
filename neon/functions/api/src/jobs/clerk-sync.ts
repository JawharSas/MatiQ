/**
 * jobs/clerk-sync: a scheduled Function Trigger (neon.ts) that applies
 * queued bans, unbans and account deletions in Clerk.
 *
 * Neon's proxy drops `x-neon-*` headers sent from outside, so a delivery
 * carrying the trigger's invocation id came from Neon; nothing else is
 * accepted. No user token: triggers don't send one.
 */

import { parseTriggerDelivery } from '@neon/functions/triggers';
import { runClerkSync } from '../shared/clerk.ts';
import { createLogger } from '../shared/log.ts';

const log = createLogger({ fn: 'clerk-sync' });

export async function clerkSync(req: Request): Promise<Response> {
  const delivery = await parseTriggerDelivery(req);
  if (!delivery.ok) return new Response(null, { status: 401 });
  try {
    const applied = await runClerkSync(log, 200);
    return Response.json({ applied });
  } catch (error) {
    log.error('Clerk sync failed', { error });
    return Response.json({ error: 'sync_failed' }, { status: 500 });
  }
}
