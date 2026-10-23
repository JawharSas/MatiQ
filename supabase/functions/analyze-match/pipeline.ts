/**
 * Background analysis pipeline for one match:
 *
 *   frames (storage) -> batched vision analysis (Claude) -> rules engine
 *   -> coaching summary -> save analysis -> delete frames
 *
 * Frames are only analysis input: they are deleted after a successful run
 * (data minimisation). Raw detected events are stored with the scorecard so a
 * match can be re-scored when rules change, without another AI call.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { type AnalysisProvider, type Frame } from '../_shared/ai/anthropic.ts';
import { toBase64 } from '../_shared/crypto.ts';
import type { Logger } from '../_shared/log.ts';
import { analyzeMatch, type Discipline, MAX_EVENTS } from '../_shared/rules-engine/index.ts';

const FRAMES_BUCKET = 'match-frames';
const FRAME_NAME = /^(\d{1,8})\.jpg$/;
const MAX_FRAME_BYTES = 1024 * 1024;

export interface MatchRow {
  id: string;
  owner_id: string;
  discipline: Discipline;
  variant: string;
  duration_ms: number;
  round_duration_ms: number | null;
}

export interface FrameRef {
  t: number;
  path: string;
}

/** Lists `{owner}/{match}/{t}.jpg` objects, sorted by timestamp. */
export async function listFrames(admin: SupabaseClient, ownerId: string, matchId: string): Promise<FrameRef[]> {
  const folder = `${ownerId}/${matchId}`;
  const frames: FrameRef[] = [];
  for (let offset = 0; offset < 4000; offset += 1000) {
    const { data, error } = await admin.storage.from(FRAMES_BUCKET).list(folder, { limit: 1000, offset });
    if (error) throw new Error(`listing frames failed: ${error.message}`);
    for (const object of data ?? []) {
      const match = FRAME_NAME.exec(object.name);
      if (match?.[1]) frames.push({ t: Number(match[1]), path: `${folder}/${object.name}` });
    }
    if (!data || data.length < 1000) break;
  }
  return frames.sort((a, b) => a.t - b.t);
}

/** Evenly subsamples `items` down to at most `max` entries, keeping the ends. */
export function subsample<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  if (max <= 1) return items.slice(0, max);
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)] as T);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Runs `fn` over `items` with at most `limit` promises in flight; keeps order. */
export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function downloadFrame(admin: SupabaseClient, ref: FrameRef): Promise<Frame> {
  const { data, error } = await admin.storage.from(FRAMES_BUCKET).download(ref.path);
  if (error || !data) throw new Error(`downloading frame failed: ${error?.message ?? 'empty'}`);
  if (data.size > MAX_FRAME_BYTES) throw new Error('frame exceeds size limit');
  const bytes = new Uint8Array(await data.arrayBuffer());
  // JPEG magic number check: never forward arbitrary uploads to the model.
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('frame is not a JPEG');
  return { t: ref.t, data: toBase64(bytes) };
}

export interface PipelineOptions {
  admin: SupabaseClient;
  provider: AnalysisProvider;
  match: MatchRow;
  frames: FrameRef[];
  framesPerRequest: number;
  concurrency: number;
  athleteA?: string;
  athleteB?: string;
  log: Logger;
}

export async function runAnalysisPipeline(options: PipelineOptions): Promise<void> {
  const { admin, provider, match, log } = options;
  const batches = chunk(options.frames, options.framesPerRequest);
  log.info('analysis started', { matchId: match.id, frames: options.frames.length, batches: batches.length });

  await setStatus(admin, match.id, 'processing');

  const outputs = await mapWithConcurrency(batches, options.concurrency, async (refs, batchIndex) => {
    const frames = await mapWithConcurrency(refs, 6, (ref) => downloadFrame(admin, ref));
    return provider.analyzeBatch(
      {
        discipline: match.discipline,
        variant: match.variant,
        durationMs: match.duration_ms,
        batchIndex,
        batchCount: batches.length,
        athleteA: options.athleteA,
        athleteB: options.athleteB,
      },
      frames,
    );
  });

  const events = outputs.flatMap((output) => output.events).slice(0, MAX_EVENTS);
  const observations = outputs.flatMap((output) => output.observations).slice(0, 40);

  const scorecard = analyzeMatch(match.discipline, events, {
    durationMs: match.duration_ms,
    variant: match.variant,
    roundDurationMs: match.round_duration_ms ?? undefined,
  });

  let coaching = '';
  try {
    coaching = await provider.coachingSummary(
      match.discipline,
      { result: scorecard.result, totals: scorecard.totals, rounds: scorecard.rounds, stats: scorecard.stats, warnings: scorecard.warnings },
      observations,
    );
  } catch (error) {
    // Coaching text is a nice-to-have; the scorecard is still saved.
    log.warn('coaching summary failed', { error });
  }

  const { error } = await admin.rpc('svc_save_analysis', {
    p_match_id: match.id,
    p_ruleset_version: scorecard.rulesetVersion,
    p_model: provider.model,
    p_events: events,
    p_scorecard: scorecard,
    p_coaching_summary: coaching || null,
  });
  if (error) throw new Error(`saving analysis failed: ${error.message}`);

  const { error: removeError } = await admin.storage.from(FRAMES_BUCKET).remove(options.frames.map((frame) => frame.path));
  if (removeError) log.warn('frame cleanup failed', { error: removeError.message });

  log.info('analysis completed', { matchId: match.id, events: events.length, winner: scorecard.result.winner });
}

export async function setStatus(admin: SupabaseClient, matchId: string, status: string, extra: Record<string, unknown> = {}): Promise<void> {
  const { error } = await admin.rpc('svc_set_match_status', { p_match_id: matchId, p_status: status, ...extra });
  if (error) throw new Error(`updating match status failed: ${error.message}`);
}
