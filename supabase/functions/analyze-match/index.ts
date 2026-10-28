/**
 * analyze-match: AI analysis of a recorded or uploaded match.
 *
 *   POST { action: 'analyze', matchId, keySource?, athleteA?, athleteB? }
 *        One-shot analysis of all uploaded frames -> 202 queued
 *
 * Live analysis while recording (one quota unit per match):
 *   POST { action: 'live_start', matchId, keySource?, athleteA?, athleteB? }  -> 200 live
 *   POST { action: 'live_batch', matchId, batchIndex, frameTs[] }             -> 202
 *   POST { action: 'live_finalize', matchId }                                  -> 202
 *   POST { action: 'live_cancel', matchId }                                    -> 200
 *
 * Checks, in order: authentication, per-user rate limits, ownership, match
 * state, video-length entitlement, uploaded frames, BYOK key availability and
 * the atomic quota reservation. Long work runs in the background; the app
 * follows progress through Realtime (`matches`, `match_live_batches`).
 */

import { z } from 'zod';
import { AnalysisError, type AnalysisProvider, createAnthropicProvider } from '../_shared/ai/anthropic.ts';
import { decryptSecret } from '../_shared/crypto.ts';
import { env } from '../_shared/env.ts';
import { HttpError, json, readJson, sanitizeText } from '../_shared/http.ts';
import { createHandler, enforceRateLimit, type RequestContext } from '../_shared/middleware.ts';
import { type KeySource, reserveAnalysis, runInBackground, settleUsage, withAnalysisQuota } from '../_shared/quota.ts';
import { variantsFor } from '../_shared/rules-engine/index.ts';
import {
  analyzeOneBatch,
  type AthleteHints,
  listFrames,
  type MatchRow,
  runAnalysisPipeline,
  runLiveFinalize,
  selectFrames,
  setStatus,
  subsample,
} from './pipeline.ts';

const MIN_FRAMES = 3;
const START_LIMIT = { max: 20, windowSeconds: 3600 };

const matchId = z.string().uuid();
const keySource = z.enum(['platform', 'byok']).default('platform');
const hint = z.string().max(80).optional();

const requestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('analyze'), matchId, keySource, athleteA: hint, athleteB: hint }).strict(),
  z.object({ action: z.literal('live_start'), matchId, keySource, athleteA: hint, athleteB: hint }).strict(),
  z
    .object({
      action: z.literal('live_batch'),
      matchId,
      batchIndex: z.number().int().min(0).max(499),
      frameTs: z.array(z.number().int().min(0).max(99_999_999)).min(1).max(30),
    })
    .strict(),
  z.object({ action: z.literal('live_finalize'), matchId }).strict(),
  z.object({ action: z.literal('live_cancel'), matchId }).strict(),
]);

type MatchWithStatus = MatchRow & { status: string };

/** Athlete descriptions go into the prompt: keep them short and tag-free. */
function cleanHint(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = sanitizeText(value, 80).replace(/[<>{}\[\]`]/g, '');
  return cleaned.length > 0 ? cleaned : undefined;
}

async function loadOwnedMatch(ctx: RequestContext, id: string, allowedStatuses: readonly string[]): Promise<MatchWithStatus> {
  const { data: match, error } = await ctx.admin
    .from('matches')
    .select('id, owner_id, discipline, variant, duration_ms, round_duration_ms, status')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`loading match failed: ${error.message}`);
  // Same response for "missing" and "not yours": no id probing.
  if (!match || match.owner_id !== ctx.user.id) throw new HttpError(404, 'not_found');
  if (!allowedStatuses.includes(match.status)) throw new HttpError(409, 'invalid_state', `Match is ${match.status}`);
  if (!variantsFor(match.discipline).includes(match.variant)) throw new HttpError(422, 'invalid_variant');
  return match as MatchWithStatus;
}

async function maxVideoMs(ctx: RequestContext): Promise<number> {
  const { data, error } = await ctx.admin.from('user_entitlements').select('max_video_seconds').eq('user_id', ctx.user.id).single();
  if (error) throw new Error(`loading entitlements failed: ${error.message}`);
  return data.max_video_seconds * 1000;
}

async function createProvider(ctx: RequestContext, source: KeySource): Promise<AnalysisProvider> {
  let apiKey: string;
  if (source === 'platform') {
    apiKey = env.anthropicApiKey();
  } else {
    const { data, error } = await ctx.admin.rpc('svc_get_api_key', { p_user_id: ctx.user.id, p_provider: 'anthropic' });
    if (error) throw new Error(`loading key failed: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { id: string; ciphertext: string; iv: string; key_version: number }
      | undefined;
    if (!row) throw new HttpError(422, 'byok_key_missing', 'No API key stored for this provider');
    apiKey = await decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, keyVersion: row.key_version }, ctx.user.id, 'anthropic');
    await ctx.admin.rpc('svc_touch_api_key', { p_key_id: row.id });
  }
  return createAnthropicProvider({ apiKey, model: env.analysisModel(), effort: env.analysisEffort() });
}

const batching = () => ({ framesPerRequest: env.analysisFramesPerRequest(), concurrency: env.analysisConcurrency() });
const errorCode = (error: unknown) => (error instanceof AnalysisError ? error.code : 'internal_error');

// analyze ---------------------------------------------------------------------------

async function handleAnalyze(ctx: RequestContext, body: { matchId: string; keySource: KeySource; athleteA?: string; athleteB?: string }) {
  await enforceRateLimit(ctx.admin, `analyze-match:start:${ctx.user.id}`, START_LIMIT);
  const match = await loadOwnedMatch(ctx, body.matchId, ['draft', 'failed']);
  if (match.duration_ms > (await maxVideoMs(ctx))) throw new HttpError(413, 'video_too_long');

  const allFrames = (await listFrames(ctx.admin, ctx.user.id, match.id)).filter((frame) => frame.t <= match.duration_ms + 2000);
  if (allFrames.length < MIN_FRAMES) throw new HttpError(422, 'frames_missing', 'Upload frames before starting analysis');
  const frames = subsample(allFrames, env.analysisMaxFrames());

  const { data: videoObjects } = await ctx.admin.storage.from('match-videos').list(`${ctx.user.id}/${match.id}`, { limit: 5 });
  const hasVideo = (videoObjects ?? []).some((object) => object.name === 'video.mp4' || object.name === 'video.mov');

  const provider = await createProvider(ctx, body.keySource);
  const log = ctx.log.child({ matchId: match.id });
  const hints: AthleteHints = { athleteA: cleanHint(body.athleteA), athleteB: cleanHint(body.athleteB) };

  const reservation = await withAnalysisQuota(
    { admin: ctx.admin, userId: ctx.user.id, matchId: match.id, keySource: body.keySource, log },
    async () => {
      try {
        await runAnalysisPipeline({ admin: ctx.admin, provider, match, frames, log, ...hints, ...batching() });
      } catch (error) {
        await setStatus(ctx.admin, match.id, 'failed', { p_error_code: errorCode(error) }).catch(() => undefined);
        throw error;
      }
    },
    () => setStatus(ctx.admin, match.id, 'queued', { p_frame_count: frames.length, p_has_video: hasVideo, p_error_code: null }),
  );

  return json(
    {
      matchId: match.id,
      status: 'queued',
      frames: frames.length,
      usage: { used: reservation.used, monthlyLimit: reservation.monthlyLimit, isUnlimited: reservation.isUnlimited },
    },
    202,
  );
}

// live -------------------------------------------------------------------------------

interface LiveSession {
  owner_id: string;
  reservation_id: string;
  key_source: KeySource;
  athlete_a: string | null;
  athlete_b: string | null;
}

async function loadLiveSession(ctx: RequestContext, id: string): Promise<LiveSession> {
  const { data, error } = await ctx.admin.rpc('svc_get_live_session', { p_match_id: id });
  if (error) throw new Error(`loading live session failed: ${error.message}`);
  const session = (Array.isArray(data) ? data[0] : data) as LiveSession | undefined;
  if (!session || session.owner_id !== ctx.user.id) throw new HttpError(409, 'no_live_session');
  return session;
}

async function handleLiveStart(ctx: RequestContext, body: { matchId: string; keySource: KeySource; athleteA?: string; athleteB?: string }) {
  await enforceRateLimit(ctx.admin, `analyze-match:start:${ctx.user.id}`, START_LIMIT);
  const match = await loadOwnedMatch(ctx, body.matchId, ['draft']);
  // Fail fast on a missing / undecryptable BYOK key before reserving anything.
  await createProvider(ctx, body.keySource);

  const reservation = await reserveAnalysis(ctx.admin, ctx.user.id, match.id, body.keySource);
  const { error } = await ctx.admin.rpc('svc_start_live_session', {
    p_match_id: match.id,
    p_reservation_id: reservation.id,
    p_key_source: body.keySource,
    p_athlete_a: cleanHint(body.athleteA) ?? null,
    p_athlete_b: cleanHint(body.athleteB) ?? null,
  });
  if (error) {
    await settleUsage(ctx.admin, reservation.id, false).catch(() => undefined);
    throw new Error(`starting live session failed: ${error.message}`);
  }
  return json({
    matchId: match.id,
    status: 'live',
    usage: { used: reservation.used, monthlyLimit: reservation.monthlyLimit, isUnlimited: reservation.isUnlimited },
  });
}

async function handleLiveBatch(ctx: RequestContext, body: { matchId: string; batchIndex: number; frameTs: number[] }) {
  const match = await loadOwnedMatch(ctx, body.matchId, ['live']);
  const session = await loadLiveSession(ctx, match.id);
  const limitMs = await maxVideoMs(ctx);

  const available = (await listFrames(ctx.admin, ctx.user.id, match.id)).filter((frame) => frame.t <= limitMs + 2000);
  const frames = selectFrames(available, body.frameTs);
  if (!frames) throw new HttpError(422, 'frames_missing', 'Some frames of this batch were not uploaded');

  const { data: claim, error } = await ctx.admin.rpc('svc_claim_live_batch', {
    p_match_id: match.id,
    p_batch_index: body.batchIndex,
    p_frame_ts: frames.map((frame) => frame.t),
    p_max_frames: env.analysisMaxFrames(),
  });
  if (error) throw new Error(`claiming batch failed: ${error.message}`);
  if (claim === 'duplicate') return json({ status: 'duplicate' });
  if (claim !== 'claimed') throw new HttpError(409, String(claim));

  const provider = await createProvider(ctx, session.key_source);
  const log = ctx.log.child({ matchId: match.id, batchIndex: body.batchIndex });
  const hints: AthleteHints = { athleteA: session.athlete_a ?? undefined, athleteB: session.athlete_b ?? undefined };

  runInBackground(
    (async () => {
      try {
        const output = await analyzeOneBatch(ctx.admin, provider, match, frames, hints, body.batchIndex, null);
        await ctx.admin.rpc('svc_complete_live_batch', {
          p_match_id: match.id,
          p_batch_index: body.batchIndex,
          p_status: 'done',
          p_events: output.events,
          p_observations: output.observations,
          p_error_code: null,
        });
      } catch (caught) {
        log.error('live batch failed', { error: caught });
        await ctx.admin.rpc('svc_complete_live_batch', {
          p_match_id: match.id,
          p_batch_index: body.batchIndex,
          p_status: 'failed',
          p_events: null,
          p_observations: null,
          p_error_code: errorCode(caught),
        });
      }
    })(),
  );
  return json({ status: 'accepted', frames: frames.length }, 202);
}

async function handleLiveFinalize(ctx: RequestContext, body: { matchId: string }) {
  await enforceRateLimit(ctx.admin, `analyze-match:finalize:${ctx.user.id}`, { max: 30, windowSeconds: 3600 });
  const match = await loadOwnedMatch(ctx, body.matchId, ['live']);
  const session = await loadLiveSession(ctx, match.id);
  if (match.duration_ms > (await maxVideoMs(ctx))) throw new HttpError(413, 'video_too_long');

  const frames = (await listFrames(ctx.admin, ctx.user.id, match.id)).filter((frame) => frame.t <= match.duration_ms + 2000);
  if (frames.length < MIN_FRAMES) throw new HttpError(422, 'frames_missing');

  const { data: videoObjects } = await ctx.admin.storage.from('match-videos').list(`${ctx.user.id}/${match.id}`, { limit: 5 });
  const hasVideo = (videoObjects ?? []).some((object) => object.name === 'video.mp4' || object.name === 'video.mov');
  await setStatus(ctx.admin, match.id, 'queued', { p_frame_count: frames.length, p_has_video: hasVideo, p_error_code: null });

  const provider = await createProvider(ctx, session.key_source);
  const log = ctx.log.child({ matchId: match.id });
  const hints: AthleteHints = { athleteA: session.athlete_a ?? undefined, athleteB: session.athlete_b ?? undefined };

  runInBackground(
    (async () => {
      let success = false;
      try {
        await runLiveFinalize({
          admin: ctx.admin,
          provider,
          match,
          frames,
          log,
          maxFrames: env.analysisMaxFrames(),
          ...hints,
          ...batching(),
        });
        success = true;
      } catch (error) {
        log.error('live finalize failed', { error });
        await setStatus(ctx.admin, match.id, 'failed', { p_error_code: errorCode(error) }).catch(() => undefined);
      } finally {
        await ctx.admin.rpc('svc_end_live_session', { p_match_id: match.id }).then(undefined, () => undefined);
        await settleUsage(ctx.admin, session.reservation_id, success).catch((error) =>
          log.error('failed to settle usage', { error })
        );
      }
    })(),
  );
  return json({ matchId: match.id, status: 'queued' }, 202);
}

async function handleLiveCancel(ctx: RequestContext, body: { matchId: string }) {
  const match = await loadOwnedMatch(ctx, body.matchId, ['live', 'draft']);
  const { data: reservationId, error } = await ctx.admin.rpc('svc_end_live_session', { p_match_id: match.id });
  if (error) throw new Error(`ending live session failed: ${error.message}`);
  if (typeof reservationId === 'string') await settleUsage(ctx.admin, reservationId, false);
  if (match.status === 'live') await setStatus(ctx.admin, match.id, 'draft');
  return json({ matchId: match.id, status: 'cancelled' });
}

async function handle(ctx: RequestContext): Promise<Response> {
  const raw = await readJson(ctx.req, z.record(z.string(), z.unknown()), 8192);
  // Older clients sent no action: treat as a one-shot analysis.
  const parsed = requestSchema.safeParse({ action: 'analyze', ...raw });
  if (!parsed.success) {
    throw new HttpError(422, 'validation_failed', parsed.error.issues.map((issue) => issue.message).join('; ').slice(0, 500));
  }
  const body = parsed.data;
  switch (body.action) {
    case 'analyze':
      return handleAnalyze(ctx, body);
    case 'live_start':
      return handleLiveStart(ctx, body);
    case 'live_batch':
      return handleLiveBatch(ctx, body);
    case 'live_finalize':
      return handleLiveFinalize(ctx, body);
    case 'live_cancel':
      return handleLiveCancel(ctx, body);
  }
}

// Live batches arrive every ~20 s during a round, so the per-user limit is
// generous; expensive starts have their own stricter limit above, and the
// per-match frame budget caps AI work regardless of request count.
Deno.serve(createHandler({ name: 'analyze-match', methods: ['POST'], rateLimit: { max: 300, windowSeconds: 3600 } }, handle));
