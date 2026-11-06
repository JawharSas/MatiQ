/**
 * jobs/push: a scheduled Function Trigger (neon.ts, every minute) that sends
 * new notifications to people's phones through FCM.
 *
 * - Only deliveries from Neon's trigger are accepted (as jobs/clerk-sync).
 * - Each notification is pushed at most once: it is claimed (push_state set)
 *   in the same statement that reads it, so overlapping runs never send twice.
 * - Kinds a person switched off, and people without a phone, are 'skipped';
 *   notifications older than an hour are skipped rather than sent late.
 * - Without FCM_SERVICE_ACCOUNT nothing is sent and everything is skipped:
 *   the notifications still show in the app's Activity.
 * - Phones Firebase no longer knows are removed.
 */

import { parseTriggerDelivery } from '@neon/functions/triggers';
import { database } from '../shared/db.ts';
import { env } from '../shared/env.ts';
import { parseServiceAccount, sendToPhone, type ServiceAccount } from '../shared/fcm.ts';
import { createLogger } from '../shared/log.ts';
import { allowed, type NotificationKind, type NotificationSwitch, pushMessage } from '../shared/push-messages.ts';

const log = createLogger({ fn: 'push' });

interface Claimed {
  id: string;
  user_id: string;
  kind: NotificationKind;
  actor_id: string;
  subject_id: string | null;
  actor_name: string | null;
  settings: Partial<Record<NotificationSwitch, boolean>> | null;
  tokens: string[] | null;
}

const BATCH = 200;

export async function pushJob(req: Request): Promise<Response> {
  const delivery = await parseTriggerDelivery(req);
  if (!delivery.ok) return new Response(null, { status: 401 });
  try {
    return Response.json(await runPush());
  } catch (error) {
    log.error('push run failed', { error });
    return Response.json({ error: 'push_failed' }, { status: 500 });
  }
}

export async function runPush(): Promise<{ sent: number; skipped: number; failed: number }> {
  const db = database();
  const configured = env.fcmServiceAccount();
  let account: ServiceAccount | null = null;
  if (configured) {
    try {
      account = parseServiceAccount(configured);
    } catch (error) {
      log.error('FCM_SERVICE_ACCOUNT is not usable; skipping pushes', { reason: (error as Error).message });
    }
  }

  // Too old to be news: skipped, not sent late.
  await db.query(
    `update public.notifications set push_state = 'skipped', pushed_at = now()
     where push_state is null and created_at < now() - interval '1 hour'`,
  );

  // Claim a batch: marking them 'skipped' first means a crash never leads to a second send.
  const { rows } = await db.query<Claimed>(
    `with claimed as (
       update public.notifications n set push_state = 'skipped', pushed_at = now()
       where n.id in (
         select id from public.notifications
         where push_state is null
         order by created_at
         limit $1
         for update skip locked
       )
       returning n.id, n.user_id, n.kind, n.actor_id, n.subject_id
     )
     select c.id, c.user_id, c.kind, c.actor_id, c.subject_id,
            p.display_name as actor_name,
            to_jsonb(s) - 'user_id' - 'updated_at' as settings,
            (select array_agg(t.token) from public.push_tokens t where t.user_id = c.user_id) as tokens
     from claimed c
     left join public.profiles p on p.id = c.actor_id
     left join public.notification_settings s on s.user_id = c.user_id`,
    [BATCH],
  );

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const invalid = new Set<string>();
  for (const row of rows) {
    if (!account || !row.tokens?.length || !allowed(row.kind, row.settings)) {
      skipped++;
      continue;
    }
    const message = pushMessage(row.kind, row.actor_name, { id: row.id, subjectId: row.subject_id, actorId: row.actor_id });
    const results = await Promise.all(row.tokens.map((token) => sendToPhone(account!, token, message).catch(() => 'failed' as const)));
    row.tokens.forEach((token, index) => {
      if (results[index] === 'invalid_token') invalid.add(token);
    });
    const state = results.includes('sent') ? 'sent' : results.every((result) => result === 'invalid_token') ? 'skipped' : 'failed';
    if (state === 'sent') sent++;
    else if (state === 'failed') failed++;
    else skipped++;
    if (state !== 'skipped') await db.query('update public.notifications set push_state = $2, pushed_at = now() where id = $1', [row.id, state]);
  }
  if (invalid.size > 0) await db.query('delete from public.push_tokens where token = any($1)', [[...invalid]]);
  if (rows.length > 0) log.info('push run', { sent, skipped, failed, removedPhones: invalid.size });
  return { sent, skipped, failed };
}
