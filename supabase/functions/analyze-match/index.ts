/**
 * analyze-match: starts AI analysis of an uploaded or live-recorded match.
 *
 *   POST { matchId, keySource?: 'platform' | 'byok', athleteA?, athleteB? }
 *   -> 202 { status: 'queued', usage }
 *
 * Checks, in order: authentication, per-user rate limit, ownership, match
 * state, video-length entitlement, uploaded frames, BYOK key availability and
 * finally the atomic quota reservation. The analysis then runs in the
 * background; the app follows progress through a Realtime subscription on
 * its `matches` row.
 */

import { z } from 'zod';
import { AnalysisError, createAnthropicProvider } from '../_shared/ai/anthropic.ts';
import { decryptSecret } from '../_shared/crypto.ts';
import { env } from '../_shared/env.ts';
import { HttpError, json, readJson, sanitizeText } from '../_shared/http.ts';
import { createHandler, type RequestContext } from '../_shared/middleware.ts';
import { type KeySource, withAnalysisQuota } from '../_shared/quota.ts';
import { variantsFor } from '../_shared/rules-engine/index.ts';
import { listFrames, type MatchRow, runAnalysisPipeline, setStatus, subsample } from './pipeline.ts';

const MIN_FRAMES = 3;

const bodySchema = z
  .object({
    matchId: z.string().uuid(),
    keySource: z.enum(['platform', 'byok']).default('platform'),
    athleteA: z.string().max(80).optional(),
    athleteB: z.string().max(80).optional(),
  })
  .strict();

/** Athlete descriptions go into the prompt: keep them short and tag-free. */
function cleanHint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = sanitizeText(value, 80).replace(/[<>{}\[\]`]/g, '');
  return cleaned.length > 0 ? cleaned : undefined;
}

async function resolveApiKey(ctx: RequestContext, keySource: KeySource): Promise<string> {
  if (keySource === 'platform') return env.anthropicApiKey();

  const { data, error } = await ctx.admin.rpc('svc_get_api_key', { p_user_id: ctx.user.id, p_provider: 'anthropic' });
  if (error) throw new Error(`loading key failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as
    | { id: string; ciphertext: string; iv: string; key_version: number }
    | undefined;
  if (!row) throw new HttpError(422, 'byok_key_missing', 'No API key stored for this provider');

  const apiKey = await decryptSecret(
    { ciphertext: row.ciphertext, iv: row.iv, keyVersion: row.key_version },
    ctx.user.id,
    'anthropic',
  );
  await ctx.admin.rpc('svc_touch_api_key', { p_key_id: row.id });
  return apiKey;
}

async function handle(ctx: RequestContext): Promise<Response> {
  const body = await readJson(ctx.req, bodySchema, 4096);

  const { data: match, error } = await ctx.admin
    .from('matches')
    .select('id, owner_id, discipline, variant, duration_ms, round_duration_ms, status')
    .eq('id', body.matchId)
    .maybeSingle();
  if (error) throw new Error(`loading match failed: ${error.message}`);
  // Same response for "missing" and "not yours": no id probing.
  if (!match || match.owner_id !== ctx.user.id) throw new HttpError(404, 'not_found');
  if (match.status !== 'draft' && match.status !== 'failed') {
    throw new HttpError(409, 'invalid_state', `Match is already ${match.status}`);
  }
  if (!variantsFor(match.discipline).includes(match.variant)) {
    throw new HttpError(422, 'invalid_variant');
  }

  const { data: entitlements, error: entitlementError } = await ctx.admin
    .from('user_entitlements')
    .select('max_video_seconds')
    .eq('user_id', ctx.user.id)
    .single();
  if (entitlementError) throw new Error(`loading entitlements failed: ${entitlementError.message}`);
  if (match.duration_ms > entitlements.max_video_seconds * 1000) {
    throw new HttpError(413, 'video_too_long', `Videos are limited to ${entitlements.max_video_seconds} seconds`);
  }

  const allFrames = (await listFrames(ctx.admin, ctx.user.id, match.id)).filter((frame) => frame.t <= match.duration_ms + 2000);
  if (allFrames.length < MIN_FRAMES) throw new HttpError(422, 'frames_missing', 'Upload frames before starting analysis');
  const frames = subsample(allFrames, env.analysisMaxFrames());

  const { data: videoObjects } = await ctx.admin.storage.from('match-videos').list(`${ctx.user.id}/${match.id}`, { limit: 5 });
  const hasVideo = (videoObjects ?? []).some((object) => object.name === 'video.mp4' || object.name === 'video.mov');

  const apiKey = await resolveApiKey(ctx, body.keySource);
  const provider = createAnthropicProvider({ apiKey, model: env.analysisModel(), effort: env.analysisEffort() });
  const log = ctx.log.child({ matchId: match.id });

  const reservation = await withAnalysisQuota(
    { admin: ctx.admin, userId: ctx.user.id, matchId: match.id, keySource: body.keySource, log },
    async () => {
      try {
        await runAnalysisPipeline({
          admin: ctx.admin,
          provider,
          match: match as MatchRow,
          frames,
          framesPerRequest: env.analysisFramesPerRequest(),
          concurrency: env.analysisConcurrency(),
          athleteA: cleanHint(body.athleteA),
          athleteB: cleanHint(body.athleteB),
          log,
        });
      } catch (error) {
        const code = error instanceof AnalysisError ? error.code : 'internal_error';
        await setStatus(ctx.admin, match.id, 'failed', { p_error_code: code }).catch(() => undefined);
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

Deno.serve(createHandler({ name: 'analyze-match', methods: ['POST'], rateLimit: { max: 20, windowSeconds: 3600 } }, handle));
