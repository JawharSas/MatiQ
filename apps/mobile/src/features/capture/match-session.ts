/**
 * Server-side lifecycle of one capture, shared by both input modes:
 *
 *   createDraftMatch -> upload frames (progressively) -> finalizeDuration
 *   -> uploadVideo (optional, native streaming) -> requestAnalysis
 *
 * Storage paths are deterministic ({user}/{match}/...) and enforced by the
 * storage policies, so a client can only ever write into its own matches.
 * Videos go to `upload.{mp4|mov}`; analyze-match checks that copy and
 * publishes it as `video.*`, the only name anyone can watch.
 */

import type { Discipline } from '@matiq/rules-engine';
import { isJpeg, type VideoCheckPassed } from '@matiq/rules-engine/media';
import * as Crypto from 'expo-crypto';
import { File, UploadType } from 'expo-file-system';
import { AppError, fromFunctionError, fromPostgrest } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import type { SampledFrame } from './frame-processor';
import { removePersonalMetadata, requireVideo } from './video-check';

export interface MatchSetup {
  discipline: Discipline;
  variant: string;
  title: string;
  athleteALabel: string;
  athleteBLabel: string;
  athleteAHint?: string;
  athleteBHint?: string;
  roundDurationMs?: number;
  keySource: 'platform' | 'byok';
  uploadVideo: boolean;
}

export interface AnalysisStarted {
  matchId: string;
  status: 'queued';
  frames: number;
  usage: { used: number; monthlyLimit: number; isUnlimited: boolean };
}

export async function createDraftMatch(setup: MatchSetup, source: 'live' | 'upload', durationMs: number): Promise<string> {
  const id = Crypto.randomUUID();
  const { error } = await supabase.from('matches').insert({
    id,
    discipline: setup.discipline,
    variant: setup.variant,
    title: setup.title,
    athlete_a_label: setup.athleteALabel,
    athlete_b_label: setup.athleteBLabel,
    source,
    duration_ms: Math.max(1000, Math.round(durationMs)),
    round_duration_ms: setup.discipline === 'mma' ? (setup.roundDurationMs ?? 300_000) : null,
  });
  if (error) throw fromPostgrest(error);
  return id;
}

export async function finalizeDuration(matchId: string, durationMs: number): Promise<void> {
  const { error } = await supabase
    .from('matches')
    .update({ duration_ms: Math.max(1000, Math.round(durationMs)) })
    .eq('id', matchId);
  if (error) throw fromPostgrest(error);
}

export function deleteLocalFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Temp files are also purged by the OS; never fail a capture over cleanup.
  }
}

/** Uploads one frame and deletes the local copy on success. */
export async function uploadFrame(userId: string, matchId: string, frame: SampledFrame): Promise<void> {
  const bytes = await new File(frame.uri).arrayBuffer();
  if (!isJpeg(new Uint8Array(bytes))) throw new AppError('upload_failed', 'A video frame could not be read');
  const { error } = await supabase.storage
    .from('match-frames')
    .upload(`${userId}/${matchId}/${frame.t}.jpg`, bytes, { contentType: 'image/jpeg', upsert: false });
  // A retried frame that already exists is a success.
  if (error && !/exists|duplicate/i.test(error.message)) throw new AppError('upload_failed', 'Uploading a frame failed');
  deleteLocalFile(frame.uri);
}

/**
 * Checks the whole video file (unless the caller already did), removes
 * location and device metadata, then streams it from disk to Storage through
 * a short-lived signed upload URL using the platform's native uploader (no JS
 * memory pressure, continues in the background on iOS).
 */
export async function uploadVideo(
  userId: string,
  matchId: string,
  videoUri: string,
  options: { verified?: VideoCheckPassed; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  const checkShare = options.verified ? 0 : 0.2;
  const verified =
    options.verified ??
    (await requireVideo(videoUri, {
      onProgress: (fraction) => options.onProgress?.(fraction * checkShare),
      ...(options.signal ? { signal: options.signal } : {}),
    }));
  const isMov = verified.container === 'mov';
  // Location (GPS) and phone details never leave the phone.
  const clean = await removePersonalMetadata(videoUri, verified.container);
  try {
    const path = `${userId}/${matchId}/upload.${isMov ? 'mov' : 'mp4'}`;
    const { data, error } = await supabase.storage.from('match-videos').createSignedUploadUrl(path, { upsert: true });
    if (error || !data) throw new AppError('upload_failed', 'Could not start the video upload');
    await sendVideo(clean.uri, data.signedUrl, isMov, checkShare, options);
  } finally {
    if (clean.temporary) deleteLocalFile(clean.uri);
  }
}

async function sendVideo(
  uri: string,
  signedUrl: string,
  isMov: boolean,
  checkShare: number,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal },
): Promise<void> {
  const result = await new File(uri).upload(signedUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { 'Content-Type': isMov ? 'video/quicktime' : 'video/mp4', 'x-upsert': 'true' },
    sessionType: 'background',
    onProgress: ({ bytesSent, totalBytes }) =>
      options.onProgress?.(checkShare + (1 - checkShare) * (totalBytes > 0 ? bytesSent / totalBytes : 0)),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (result.status < 200 || result.status >= 300) throw new AppError('upload_failed', 'The video upload failed');
}

export async function requestAnalysis(
  matchId: string,
  setup: Pick<MatchSetup, 'keySource' | 'athleteAHint' | 'athleteBHint'>,
): Promise<AnalysisStarted> {
  const { data, error } = await supabase.functions.invoke<AnalysisStarted>('analyze-match', {
    body: {
      matchId,
      keySource: setup.keySource,
      ...(setup.athleteAHint ? { athleteA: setup.athleteAHint } : {}),
      ...(setup.athleteBHint ? { athleteB: setup.athleteBHint } : {}),
    },
  });
  if (error || !data) throw await fromFunctionError(error);
  return data;
}

/** Removes a capture the user abandoned (files first, then the row). */
export async function discardMatch(userId: string, matchId: string): Promise<void> {
  for (const bucket of ['match-frames', 'match-videos'] as const) {
    const { data } = await supabase.storage.from(bucket).list(`${userId}/${matchId}`, { limit: 1000 });
    const paths = (data ?? []).map((object) => `${userId}/${matchId}/${object.name}`);
    if (paths.length > 0) await supabase.storage.from(bucket).remove(paths);
  }
  await supabase.from('matches').delete().eq('id', matchId);
}
