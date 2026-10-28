/**
 * Analysis pipeline building blocks:
 *
 *   frames (storage) -> batched vision analysis (Claude) -> rules engine
 *   -> coaching summary -> save analysis -> delete frames
 *
 * Used by both the one-shot analysis (after upload / recording) and live
 * analysis (batches analysed while recording, leftovers at finalize).
 * Frames are only analysis input: they are deleted after a successful run
 * (data minimisation). Raw detected events are stored with the scorecard so a
 * match can be re-scored when rules change, without another AI call.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { type AnalysisProvider, type Frame } from '../_shared/ai/anthropic.ts';
import type { BatchOutput } from '../_shared/ai/schemas.ts';
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

export interface AthleteHints {
  athleteA?: string;
  athleteB?: string;
}

export interface BatchingOptions {
  framesPerRequest: number;
  concurrency: number;
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
  if (max <= 0) return [];
  if (max === 1) return items.slice(0, 1);
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)] as T);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Resolves requested frame timestamps against what is actually in storage.
 * Returns null when any requested frame is missing or duplicated, so a
 * client can never make the server analyse frames it did not upload.
 */
export function selectFrames(available: readonly FrameRef[], requestedTs: readonly number[]): FrameRef[] | null {
  if (new Set(requestedTs).size !== requestedTs.length) return null;
  const byT = new Map(available.map((frame) => [frame.t, frame]));
  const selected: FrameRef[] = [];
  for (const t of requestedTs) {
    const frame = byT.get(t);
    if (!frame) return null;
    selected.push(frame);
  }
  return selected.sort((a, b) => a.t - b.t);
}

/** Frames not analysed by any completed live batch. */
export function uncoveredFrames(all: readonly FrameRef[], covered: Iterable<number>): FrameRef[] {
  const done = new Set(covered);
  return all.filter((frame) => !done.has(frame.t));
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

/** Analyses one batch of frames (one model request). */
export async function analyzeOneBatch(
  admin: SupabaseClient,
  provider: AnalysisProvider,
  match: MatchRow,
  refs: readonly FrameRef[],
  hints: AthleteHints,
  batchIndex: number,
  batchCount: number | null,
): Promise<BatchOutput> {
  const frames = await mapWithConcurrency(refs, 6, (ref) => downloadFrame(admin, ref));
  return provider.analyzeBatch(
    {
      discipline: match.discipline,
      variant: match.variant,
      durationMs: match.duration_ms,
      batchIndex,
      batchCount,
      athleteA: hints.athleteA,
      athleteB: hints.athleteB,
    },
    frames,
  );
}

/** Analyses frames in batches with bounded concurrency. */
export function analyzeFrames(
  admin: SupabaseClient,
  provider: AnalysisProvider,
  match: MatchRow,
  refs: readonly FrameRef[],
  hints: AthleteHints,
  options: BatchingOptions,
): Promise<BatchOutput[]> {
  const batches = chunk(refs, options.framesPerRequest);
  return mapWithConcurrency(batches, options.concurrency, (batch, index) =>
    analyzeOneBatch(admin, provider, match, batch, hints, index, batches.length)
  );
}

/** Rules engine + coaching notes + save (marks the match completed). */
export async function scoreAndSave(
  admin: SupabaseClient,
  provider: AnalysisProvider,
  match: MatchRow,
  outputs: readonly BatchOutput[],
  log: Logger,
): Promise<void> {
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
  log.info('analysis saved', { matchId: match.id, events: events.length, winner: scorecard.result.winner });
}

export async function deleteFrames(admin: SupabaseClient, refs: readonly FrameRef[], log: Logger): Promise<void> {
  for (const batch of chunk(refs.map((frame) => frame.path), 100)) {
    const { error } = await admin.storage.from(FRAMES_BUCKET).remove(batch);
    if (error) log.warn('frame cleanup failed', { error: error.message });
  }
}

export async function setStatus(admin: SupabaseClient, matchId: string, status: string, extra: Record<string, unknown> = {}): Promise<void> {
  const { error } = await admin.rpc('svc_set_match_status', { p_match_id: matchId, p_status: status, ...extra });
  if (error) throw new Error(`updating match status failed: ${error.message}`);
}

// One-shot analysis ----------------------------------------------------------------

export interface PipelineOptions extends BatchingOptions, AthleteHints {
  admin: SupabaseClient;
  provider: AnalysisProvider;
  match: MatchRow;
  frames: FrameRef[];
  log: Logger;
}

export async function runAnalysisPipeline(options: PipelineOptions): Promise<void> {
  const { admin, provider, match, log } = options;
  log.info('analysis started', { matchId: match.id, frames: options.frames.length });
  await setStatus(admin, match.id, 'processing');
  const outputs = await analyzeFrames(admin, provider, match, options.frames, options, options);
  await scoreAndSave(admin, provider, match, outputs, log);
  await deleteFrames(admin, options.frames, log);
}

// Live finalize --------------------------------------------------------------------

interface LiveBatchRow {
  batch_index: number;
  frame_ts: number[];
  status: 'processing' | 'done' | 'failed';
  events: Record<string, unknown>[];
  observations: string[];
}

async function loadLiveBatches(admin: SupabaseClient, matchId: string): Promise<LiveBatchRow[]> {
  const { data, error } = await admin
    .from('match_live_batches')
    .select('batch_index, frame_ts, status, events, observations')
    .eq('match_id', matchId)
    .order('batch_index');
  if (error) throw new Error(`loading live batches failed: ${error.message}`);
  return (data ?? []) as LiveBatchRow[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface LiveFinalizeOptions extends PipelineOptions {
  maxFrames: number;
  /** How long to wait for batches that are still being analysed. */
  waitForInFlightMs?: number;
}

/**
 * Completes a live session: waits briefly for in-flight batches, analyses
 * only the frames no completed batch covered (e.g. the last seconds, or
 * batches that failed), merges everything and scores it once.
 */
export async function runLiveFinalize(options: LiveFinalizeOptions): Promise<void> {
  const { admin, provider, match, log } = options;
  await setStatus(admin, match.id, 'processing');

  let batches = await loadLiveBatches(admin, match.id);
  const deadline = Date.now() + (options.waitForInFlightMs ?? 60_000);
  while (batches.some((batch) => batch.status === 'processing') && Date.now() < deadline) {
    await sleep(2000);
    batches = await loadLiveBatches(admin, match.id);
  }

  const done = batches.filter((batch) => batch.status === 'done');
  const covered = done.flatMap((batch) => batch.frame_ts);
  const remaining = subsample(uncoveredFrames(options.frames, covered), Math.max(0, options.maxFrames - covered.length));
  log.info('live finalize', { matchId: match.id, liveBatches: done.length, remainingFrames: remaining.length });

  const leftovers = await analyzeFrames(admin, provider, match, remaining, options, options);
  const liveOutputs: BatchOutput[] = done.map((batch) => ({ events: batch.events, observations: batch.observations }));
  await scoreAndSave(admin, provider, match, [...liveOutputs, ...leftovers], log);
  await deleteFrames(admin, options.frames, log);
}
