/**
 * account: data-subject rights.
 *
 *   GET                                   -> export all of the caller's data (JSON)
 *   POST   { birthYear, birthMonth }      -> age check (COPPA): records the month for
 *                                            people who are at least 13; for anyone
 *                                            younger it deletes the account at once
 *   DELETE { confirm: "DELETE MY ACCOUNT" } -> delete files + the account
 *
 * Deleting the account row (app.users) cascades to every table (all foreign
 * keys reference it ON DELETE CASCADE) and queues the Clerk user's deletion,
 * applied right away when the Clerk secret key is set. Files are removed
 * explicitly first because they are not covered by database cascades.
 */

import type { Admin } from '../shared/admin.ts';
import { z } from 'zod';
import { clerkEmail, runClerkSync } from '../shared/clerk.ts';
import { database } from '../shared/db.ts';
import { HttpError, json, readJson } from '../shared/http.ts';
import { createHandler, enforceRateLimit, type RequestContext } from '../shared/middleware.ts';

const BUCKETS = ['match-videos', 'match-frames', 'avatars'] as const;

async function listRecursive(admin: Admin, bucket: string, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 3) return [];
  const paths: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`listing ${bucket} failed: ${error.message}`);
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`;
      // Folders are returned without an id.
      if (entry.id === null) paths.push(...(await listRecursive(admin, bucket, path, depth + 1)));
      else paths.push(path);
    }
    if (!data || data.length < 1000) break;
  }
  return paths;
}

async function exportData(ctx: RequestContext): Promise<Response> {
  await enforceRateLimit(ctx.admin, `account:export:${ctx.user.id}`, { max: 5, windowSeconds: 86400 });
  const uid = ctx.user.id;
  const db = ctx.admin;

  const query = async (table: string, column: string) => {
    const { data, error } = await db.from(table).select('*').eq(column, uid);
    if (error) throw new Error(`export of ${table} failed: ${error.message}`);
    return data;
  };

  const [
    profile,
    entitlements,
    legal,
    matches,
    analyses,
    posts,
    likes,
    blocks,
    usage,
    friendsLow,
    friendsHigh,
    keys,
    ratings,
    ratingHistory,
    titles,
    rankedAsChallenger,
    rankedAsOpponent,
    ageCheck,
  ] = await Promise.all([
      query('profiles', 'id'),
      query('user_entitlements', 'user_id'),
      query('legal_acceptances', 'user_id'),
      query('matches', 'owner_id'),
      query('match_analyses', 'owner_id'),
      query('posts', 'author_id'),
      query('post_likes', 'user_id'),
      query('blocks', 'blocker_id'),
      query('usage_ledger', 'user_id'),
      query('friendships', 'user_low'),
      query('friendships', 'user_high'),
      db.rpc('svc_list_api_keys', { p_user_id: uid }).then(({ data }) => data ?? []),
      query('ranked_ratings', 'user_id'),
      query('rating_history', 'user_id'),
      query('user_titles', 'user_id'),
      query('ranked_matches', 'challenger_id'),
      query('ranked_matches', 'opponent_id'),
      db.rpc('svc_export_age_check', { p_user_id: uid }).then(({ data }) => data?.[0] ?? null),
    ]);

  const { rows } = await database().query<{ email: string | null; created_at: string }>(
    'select email, created_at from app.users where id = $1',
    [uid],
  );
  const account = {
    id: uid,
    email: rows[0]?.email ?? (await clerkEmail(ctx.user.clerkId).catch(() => null)),
    createdAt: rows[0]?.created_at ?? null,
  };

  ctx.log.info('data export generated');
  return json(
    {
      exportedAt: new Date().toISOString(),
      account,
      profile: profile?.[0] ?? null,
      entitlements: entitlements?.[0] ?? null,
      legalAcceptances: legal,
      ageCheck,
      matches,
      analyses,
      posts,
      likes,
      friendships: [...(friendsLow ?? []), ...(friendsHigh ?? [])],
      blocks,
      usage,
      // Metadata only - stored API keys are never exported in any form.
      apiKeys: keys,
      ranked: {
        ratings,
        history: ratingHistory,
        titles,
        matches: [...(rankedAsChallenger ?? []), ...(rankedAsOpponent ?? [])],
      },
    },
    200,
    { 'Content-Disposition': 'attachment; filename="matiq-export.json"' },
  );
}

const deleteSchema = z.object({ confirm: z.literal('DELETE MY ACCOUNT') }).strict();

const ageSchema = z
  .object({
    birthYear: z.number().int().min(1900).max(2200),
    birthMonth: z.number().int().min(1).max(12),
  })
  .strict();

async function deleteAccount(ctx: RequestContext): Promise<Response> {
  await enforceRateLimit(ctx.admin, `account:delete:${ctx.user.id}`, { max: 3, windowSeconds: 3600 });
  await readJson(ctx.req, deleteSchema, 1024);

  const { data: entitlements } = await ctx.admin.from('user_entitlements').select('role').eq('user_id', ctx.user.id).maybeSingle();
  if (entitlements?.role === 'owner') {
    throw new HttpError(409, 'owner_account', 'Transfer the owner role before deleting this account');
  }

  await removeUser(ctx);
  ctx.log.info('account deleted');
  return json({ deleted: true });
}

/**
 * Neutral age screen. The rule lives in the database (private.meets_minimum_age);
 * when it says the person is under 13, nothing about them is kept: the account
 * and everything in it are deleted before responding.
 */
async function recordAge(ctx: RequestContext): Promise<Response> {
  await enforceRateLimit(ctx.admin, `account:age:${ctx.user.id}`, { max: 5, windowSeconds: 3600 });
  const body = await readJson(ctx.req, ageSchema, 1024);
  const { data, error } = await ctx.admin.rpc('svc_record_age', {
    p_user_id: ctx.user.id,
    p_year: body.birthYear,
    p_month: body.birthMonth,
  });
  if (error) {
    if (error.code === '22023') throw new HttpError(400, 'invalid_birth_month', 'Enter a valid birth month and year');
    throw new Error(`age check failed: ${error.message}`);
  }
  if (data === 'ok') return json({ status: 'ok' });

  const { data: entitlements } = await ctx.admin.from('user_entitlements').select('role').eq('user_id', ctx.user.id).maybeSingle();
  if (entitlements?.role === 'owner') {
    throw new HttpError(409, 'owner_account', 'The owner account cannot be removed this way');
  }
  await removeUser(ctx);
  ctx.log.info('account removed by the age check');
  return json({ status: 'not_eligible' });
}

/** Deletes the caller's files, then the account (which cascades to every table), then the Clerk user. */
async function removeUser(ctx: RequestContext): Promise<void> {
  for (const bucket of BUCKETS) {
    const paths = await listRecursive(ctx.admin, bucket, ctx.user.id);
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await ctx.admin.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) throw new Error(`removing ${bucket} objects failed: ${error.message}`);
    }
  }

  await database().query('delete from app.users where id = $1', [ctx.user.id]);
  // The deletion was queued for Clerk with the row; a failure here is retried on schedule.
  await runClerkSync(ctx.log).catch((error) => ctx.log.warn('deleting the Clerk user failed', { error }));
}

export default createHandler(
  { name: 'account', methods: ['GET', 'POST', 'DELETE'], rateLimit: { max: 30, windowSeconds: 3600 }, allowBeforeAgeCheck: true },
  (ctx) => ctx.req.method === 'DELETE' ? deleteAccount(ctx) : ctx.req.method === 'POST' ? recordAge(ctx) : exportData(ctx),
);
