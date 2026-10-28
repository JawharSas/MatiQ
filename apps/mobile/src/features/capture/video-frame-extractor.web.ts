/**
 * Browser UI preview only: emits synthetic frames on the normal sampling
 * schedule so the upload queue and progress UI behave like on a device.
 */

import type { SampledFrame } from './frame-processor';
import { planSampling } from './frame-sampling';

export interface ExtractionOptions {
  durationMs: number;
  maxFrames: number;
  onFrame: (frame: SampledFrame) => void;
  onProgress?: (fraction: number) => void;
  uploadPressure?: () => number;
  signal?: AbortSignal;
}

export async function extractFrames(_videoUri: string, options: ExtractionOptions): Promise<{ kept: number; pruned: number }> {
  const { intervalMs } = planSampling(options.durationMs, options.maxFrames, 1);
  const step = Math.max(intervalMs, Math.ceil(options.durationMs / 40));
  let kept = 0;
  for (let t = 0; t <= options.durationMs; t += step) {
    if (options.signal?.aborted) throw new DOMException('Frame extraction cancelled', 'AbortError');
    options.onFrame({ t, uri: `preview://frames/${t}.jpg`, motion: 0.5 });
    kept++;
    options.onProgress?.(Math.min(1, t / options.durationMs));
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  options.onProgress?.(1);
  return { kept, pruned: 0 };
}
