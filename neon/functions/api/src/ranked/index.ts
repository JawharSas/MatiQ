/**
 * Ranked results (the only writer of ratings, history and titles).
 *
 *   POST { action: 'confirm', id }  record the caller's confirmation; settles when
 *                                   both fighters confirmed (or the window passed)
 *   POST { action: 'settle', id }   settle a result that is ready: after the 72 h
 *                                   window, or after the owner upheld a dispute
 *
 * Settlement reads both rating rows, computes Elo, career totals and titles
 * with the shared rules engine, and applies them with svc_apply_ranked_result,
 * which rejects the write if either rating changed in the meantime. On such a
 * conflict the computation is repeated from fresh rows.
 */

import { z } from 'zod';
import { HttpError, json, readJson } from '../shared/http.ts';
import { createHandler, type RequestContext } from '../shared/middleware.ts';
import { type Discipline, settleRankedMatch } from '@matiq/rules-engine';
import { fighterState, outcomeFor, parseStoredScorecard, type RatingRow, toPayload } from './settlement.ts';

const MAX_ATTEMPTS = 3;

const requestSchema = z
  .object({ action: z.enum(['confirm', 'settle']), id: z.string().uuid() })
  .strict();

interface RankedRow {
  id: string;
  discipline: Discipline;
  status: string;
  match_id: string | null;
  fighter_a_id: string | null;
  fighter_b_id: string | null;
}

function rpcError(error: { code?: string; message: string }): HttpError {
  if (error.code === 'P0002') return new HttpError(404, 'not_found');
  if (error.code === '22023') return new HttpError(409, 'invalid_state', error.message);
  return new HttpError(500, 'internal_error');
}

async function loadRanked(ctx: RequestContext, id: string): Promise<RankedRow> {
  const { data, error } = await ctx.admin
    .from('ranked_matches')
    .select('id, discipline, status, match_id, fighter_a_id, fighter_b_id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`loading ranked match failed: ${error.message}`);
  if (!data) throw new HttpError(404, 'not_found');
  return data as RankedRow;
}

async function isOwner(ctx: RequestContext): Promise<boolean> {
  const { data } = await ctx.admin.from('user_entitlements').select('role, is_suspended').eq('user_id', ctx.user.id).maybeSingle();
  return data?.role === 'owner' && data.is_suspended === false;
}

async function loadRating(ctx: RequestContext, userId: string, discipline: Discipline): Promise<RatingRow | null> {
  const { data, error } = await ctx.admin
    .from('ranked_ratings')
    .select('rating, games, peak_rating, totals, version')
    .eq('user_id', userId)
    .eq('discipline', discipline)
    .maybeSingle();
  if (error) throw new Error(`loading rating failed: ${error.message}`);
  return data as RatingRow | null;
}

async function settle(ctx: RequestContext, ranked: RankedRow): Promise<Response> {
  if (ranked.status === 'confirmed') return json({ id: ranked.id, status: 'confirmed' });
  if (!ranked.match_id || !ranked.fighter_a_id || !ranked.fighter_b_id) throw new HttpError(409, 'invalid_state', 'No analysed recording');

  const { data: analysis, error } = await ctx.admin.from('match_analyses').select('scorecard').eq('match_id', ranked.match_id).maybeSingle();
  if (error) throw new Error(`loading analysis failed: ${error.message}`);
  const scorecard = parseStoredScorecard(analysis?.scorecard, ranked.discipline);
  if (!scorecard) throw new HttpError(422, 'invalid_scorecard');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const [rowA, rowB] = await Promise.all([
      loadRating(ctx, ranked.fighter_a_id, ranked.discipline),
      loadRating(ctx, ranked.fighter_b_id, ranked.discipline),
    ]);
    const a = fighterState(rowA);
    const b = fighterState(rowB);
    const settled = settleRankedMatch(scorecard, { A: a.state, B: b.state });

    const { data: outcome, error: applyError } = await ctx.admin.rpc('svc_apply_ranked_result', {
      p_id: ranked.id,
      p_expected: { a: a.version, b: b.version },
      p_a: toPayload(settled.A, outcomeFor('A', settled.winner)),
      p_b: toPayload(settled.B, outcomeFor('B', settled.winner)),
      p_allow_disputed: false,
    });
    if (applyError) throw rpcError(applyError);

    switch (outcome) {
      case 'applied':
        ctx.log.info('ranked match settled', { rankedId: ranked.id, deltaA: settled.A.change.delta, deltaB: settled.B.change.delta });
        return json({
          id: ranked.id,
          status: 'confirmed',
          fighters: {
            A: { userId: ranked.fighter_a_id, ...settled.A.change, rating: settled.A.rating, titles: settled.A.titles },
            B: { userId: ranked.fighter_b_id, ...settled.B.change, rating: settled.B.rating, titles: settled.B.titles },
          },
        });
      case 'already_settled':
        return json({ id: ranked.id, status: 'confirmed' });
      case 'not_ready':
        throw new HttpError(409, 'not_ready', 'Waiting for confirmation');
      case 'conflict':
        ctx.log.info('ranked settlement conflict, retrying', { rankedId: ranked.id, attempt });
        continue;
      default:
        throw new Error(`unexpected settlement outcome: ${String(outcome)}`);
    }
  }
  throw new HttpError(503, 'busy', 'Ratings are being updated, try again', { 'Retry-After': '2' });
}

async function handle(ctx: RequestContext): Promise<Response> {
  const body = await readJson(ctx.req, requestSchema, 1024);
  const ranked = await loadRanked(ctx, body.id);
  const participant = ctx.user.id === ranked.fighter_a_id || ctx.user.id === ranked.fighter_b_id;

  if (body.action === 'confirm') {
    if (!participant) throw new HttpError(404, 'not_found');
    const { data: ready, error } = await ctx.admin.rpc('svc_record_ranked_confirmation', { p_id: ranked.id, p_user_id: ctx.user.id });
    if (error) throw rpcError(error);
    if (ready !== true) return json({ id: ranked.id, status: 'awaiting_confirmation' });
    return settle(ctx, ranked);
  }

  // settle: participants, or the owner after upholding a dispute.
  if (!participant && !(await isOwner(ctx))) throw new HttpError(404, 'not_found');
  return settle(ctx, ranked);
}

export default createHandler({ name: 'ranked', methods: ['POST'], rateLimit: { max: 60, windowSeconds: 3600 } }, handle);
