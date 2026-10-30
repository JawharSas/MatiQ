/**
 * Compresses a video on the phone before upload (see video-quality.ts for
 * the rates). Tries HEVC first and H.264 where HEVC is missing or fails;
 * when nothing works, or the result isn't smaller, the original is uploaded.
 */

import type { VideoCheckPassed } from '@matiq/rules-engine/media';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { compress, encoders } from '../../../modules/video-compressor';
import { type CompressionPlan, fallbackPlan, keepCompressed, MAX_VIDEO_BYTES, planCompression } from './video-quality';

type Encode = Extract<CompressionPlan, { compress: true }>;

/** The encodes to try, best first; empty when the video is uploaded as it is. */
export function compressionPlans(video: VideoCheckPassed, sizeBytes: number, durationMs: number): Encode[] {
  const source = { width: video.video.width, height: video.video.height, fps: video.video.fps, durationMs, sizeBytes };
  const codecs = encoders();
  const plans: Encode[] = [];
  for (const codec of codecs) {
    const plan = planCompression(source, { codec });
    // Already compact: no encode at all.
    if (!plan.compress) return [];
    plans.push(plan);
  }
  // An original over the limit must shrink to fit: if the encodes above
  // don't get it there, try 720p (on iOS with H.264: HEVC has no 720p preset).
  const first = plans[0];
  if (first && sizeBytes > MAX_VIDEO_BYTES) {
    const codec = Platform.OS === 'ios' ? 'h264' : first.codec;
    const fallback = codecs.includes(codec) ? fallbackPlan(first, { codec, durationMs }) : null;
    if (fallback) plans.push(fallback);
  }
  return plans;
}

/**
 * Runs the first encode that works and returns the compressed copy (a
 * temporary file the caller deletes), or null to upload the original.
 */
export async function compressForUpload(
  uri: string,
  plans: readonly Encode[],
  originalBytes: number,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<{ uri: string; sizeBytes: number } | null> {
  // Short side of an encode that came out over the limit: only smaller ones are worth trying.
  let tooBigAt: number | null = null;
  for (const plan of plans) {
    if (tooBigAt !== null && plan.shortSide >= tooBigAt) continue;
    const output = new File(Paths.cache, `matiq-compressed-${Crypto.randomUUID()}.mp4`);
    try {
      const result = await compress(uri, { output: output.uri, codec: plan.codec, bitRate: plan.bitRate, shortSide: plan.shortSide }, options);
      if (keepCompressed({ originalBytes, compressedBytes: result.sizeBytes })) return { uri: result.uri, sizeBytes: result.sizeBytes };
      remove(output);
      if (result.sizeBytes > MAX_VIDEO_BYTES) {
        // Still over the limit: try a smaller encode.
        tooBigAt = plan.shortSide;
        continue;
      }
      return null;
    } catch (error) {
      remove(output);
      if (options.signal?.aborted) throw error;
      // This phone couldn't encode it this way: try the next codec.
    }
  }
  return null;
}

function remove(file: File) {
  try {
    if (file.exists) file.delete();
  } catch {
    // Temp files are also purged by the OS.
  }
}
