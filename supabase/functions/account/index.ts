/**
 * account: data-subject rights.
 *
 *   GET                                   -> export all of the caller's data (JSON)
 *   DELETE { confirm: "DELETE MY ACCOUNT" } -> delete storage objects + the auth user
 *
 * Deleting the auth user cascades to every table (all foreign keys reference
 * auth.users ON DELETE CASCADE). Storage objects are removed explicitly first
 * because they are not covered by database cascades.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { HttpError, json, readJson } from '../_shared/http.ts';
import { createHandler, enforceRateLimit, type RequestContext } from '../_shared/middleware.ts';

const BUCKETS = ['match-videos', 'match-frames', 'avatars'] as const;

async function listRecursive(admin: SupabaseClient, bucket: string, prefix: string, depth = 0): Promise<string[]> {
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
    ]);

  ctx.log.info('data export generated');
  return json(
    {
      exportedAt: new Date().toISOString(),
      account: { id: uid, email: ctx.user.email, createdAt: ctx.user.created_at },
      profile: profile?.[0] ?? null,
      entitlements: entitlements?.[0] ?? null,
      legalAcceptances: legal,
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

async function deleteAccount(ctx: RequestContext): Promise<Response> {
  await enforceRateLimit(ctx.admin, `account:delete:${ctx.user.id}`, { max: 3, windowSeconds: 3600 });
  await readJson(ctx.req, deleteSchema, 1024);

  const { data: entitlements } = await ctx.admin.from('user_entitlements').select('role').eq('user_id', ctx.user.id).maybeSingle();
  if (entitlements?.role === 'owner') {
    throw new HttpError(409, 'owner_account', 'Transfer the owner role before deleting this account');
  }

  for (const bucket of BUCKETS) {
    const paths = await listRecursive(ctx.admin, bucket, ctx.user.id);
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await ctx.admin.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) throw new Error(`removing ${bucket} objects failed: ${error.message}`);
    }
  }

  const { error } = await ctx.admin.auth.admin.deleteUser(ctx.user.id);
  if (error) throw new Error(`deleting auth user failed: ${error.message}`);

  ctx.log.info('account deleted');
  return json({ deleted: true });
}

Deno.serve(
  createHandler({ name: 'account', methods: ['GET', 'DELETE'], rateLimit: { max: 30, windowSeconds: 3600 } }, (ctx) =>
    ctx.req.method === 'DELETE' ? deleteAccount(ctx) : exportData(ctx)
  ),
);
