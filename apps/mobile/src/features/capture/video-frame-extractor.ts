/**
 * Frame extraction for videos picked from the gallery. Produces the same
 * SampledFrame stream as live capture, so both input modes share the upload
 * and analysis pipeline.
 *
 * Frames are decoded one at a time by the platform's video decoder and
 * processed natively; the loop yields between frames so the UI stays
 * responsive, and it can be cancelled with an AbortSignal.
 */

import * as VideoThumbnails from 'expo-video-thumbnails';
import { Images } from 'react-native-nitro-image';
import { processFrame, type SampledFrame, toFilePath } from './frame-processor';
import { FramePruner, planSampling } from './frame-sampling';
import { deleteLocalFile } from './match-session';

export interface ExtractionOptions {
  durationMs: number;
  maxFrames: number;
  onFrame: (frame: SampledFrame) => void;
  onProgress?: (fraction: number) => void;
  /** 0..1 upload queue fill level; extraction pauses while it is high. */
  uploadPressure?: () => number;
  signal?: AbortSignal;
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function extractFrames(videoUri: string, options: ExtractionOptions): Promise<{ kept: number; pruned: number }> {
  const { intervalMs } = planSampling(options.durationMs, options.maxFrames, 1);
  const pruner = new FramePruner();

  for (let t = 0; t <= options.durationMs; t += intervalMs) {
    if (options.signal?.aborted) throw new DOMException('Frame extraction cancelled', 'AbortError');
    while ((options.uploadPressure?.() ?? 0) > 0.9 && !options.signal?.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    let thumbnailUri: string | undefined;
    try {
      const thumbnail = await VideoThumbnails.getThumbnailAsync(videoUri, { time: t, quality: 0.9 });
      thumbnailUri = thumbnail.uri;
      const image = await Images.loadFromFileAsync(toFilePath(thumbnail.uri));
      const frame = await processFrame(image, t, pruner);
      if (frame) options.onFrame(frame);
    } catch {
      // Some containers cannot seek to every timestamp; skip that sample.
    } finally {
      if (thumbnailUri) deleteLocalFile(thumbnailUri);
    }

    options.onProgress?.(Math.min(1, t / options.durationMs));
    await yieldToUi();
  }
  options.onProgress?.(1);
  return { kept: pruner.kept, pruned: pruner.pruned };
}
