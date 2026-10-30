/**
 * Compresses a video on the phone before upload (see video-quality.ts for
 * the rates). Tries HEVC first and H.264 where HEVC is missing or fails;
 * when nothing works, or the result isn't smaller, the original is uploaded.
 */

import type { VideoCheckPassed } from '@matiq/rules-engine/media';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { compress, encoders } from '../../../modules/video-compressor';
import { type CompressionPlan, keepCompressed, planCompression } from './video-quality';

type Encode = Extract<CompressionPlan, { compress: true }>;

/** The encodes to try, best first; empty when the video is uploaded as it is. */
export function compressionPlans(video: VideoCheckPassed, sizeBytes: number, durationMs: number): Encode[] {
  const source = { width: video.video.width, height: video.video.height, fps: video.video.fps, durationMs, sizeBytes };
  const plans: Encode[] = [];
  for (const codec of encoders()) {
    const plan = planCompression(source, { codec });
    // Already compact: no encode at all.
    if (!plan.compress) return [];
    plans.push(plan);
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
  for (const plan of plans) {
    const output = new File(Paths.cache, `matiq-compressed-${Crypto.randomUUID()}.mp4`);
    try {
      const result = await compress(uri, { output: output.uri, codec: plan.codec, bitRate: plan.bitRate, shortSide: plan.shortSide }, options);
      if (keepCompressed({ originalBytes, compressedBytes: result.sizeBytes })) return { uri: result.uri, sizeBytes: result.sizeBytes };
      remove(output);
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
