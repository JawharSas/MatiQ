/**
 * Frame processor for live AI sampling. Runs on the frame output's own
 * native thread (react-native-worklets runtime), never on the UI or JS
 * thread, and never touches the preview or the hardware video encoder.
 *
 * Per frame (30-60 times a second) it only increments a counter, which gives
 * a real delivered-FPS measurement, and disposes the frame immediately so the
 * camera's buffer pool never runs dry (an undisposed frame stalls the whole
 * pipeline). Once per sampling interval it converts the frame, downscales it,
 * computes a 16-px luminance signature, drops it if nothing moved, and
 * otherwise encodes a JPEG asynchronously and hands only the file path to JS.
 *
 * Kept in a plain module (not a component) so React Compiler never rewrites
 * the worklet.
 */

import type { Image } from 'react-native-nitro-image';
import { type Frame, HybridFrameConverter } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN, type Synchronizable } from 'react-native-worklets';
import { FRAME_JPEG_QUALITY, FRAME_MAX_SIDE, toFileUri } from './frame-processor';
import { createPruneState, decidePrune, DEFAULT_PRUNE, lumaSignature, type PruneOptions, type PruneState } from './frame-sampling';

const SIGNATURE_WIDTH = 16;

export interface SamplerControls {
  /** Wall-clock ms when recording started; 0 while only previewing (FPS is still measured). */
  recordingStartedAt: Synchronizable<number>;
  /** Current sampling interval; JS raises it when the upload queue backs up. */
  intervalMs: Synchronizable<number>;
}

export function createSamplerControls(intervalMs: number): SamplerControls {
  return { recordingStartedAt: createSynchronizable(0), intervalMs: createSynchronizable(intervalMs) };
}

export interface FrameStats {
  /** Frames delivered to the frame output per second, i.e. the live camera rate. */
  fps: number;
  kept: number;
  pruned: number;
  failed: number;
}

interface SamplerState {
  session: number;
  windowStart: number;
  windowFrames: number;
  lastSampleAt: number;
  saving: boolean;
  failed: number;
  prune: PruneState;
}

export function createFrameSampler(
  controls: SamplerControls,
  onSample: (t: number, uri: string, motion: number) => void,
  onStats: (stats: FrameStats) => void,
  prune: PruneOptions = DEFAULT_PRUNE,
): (frame: Frame) => void {
  // Per-instance key for state that lives on the worklet runtime.
  const stateKey = `__matiqSampler_${Math.random().toString(36).slice(2)}`;

  return (frame: Frame): void => {
    'worklet';
    // Every path below releases the camera buffer exactly once (finally).
    try {
      const scope = globalThis as unknown as Record<string, SamplerState | undefined>;
      const now = Date.now();
      const startedAt = controls.recordingStartedAt.getDirty();

      let state = scope[stateKey];
      if (!state || state.session !== startedAt) {
        state = {
          session: startedAt,
          windowStart: now,
          windowFrames: 0,
          lastSampleAt: 0,
          saving: false,
          failed: 0,
          prune: createPruneState(),
        };
        scope[stateKey] = state;
      }

      // 1. Live FPS measurement (cheap, every frame).
      state.windowFrames++;
      const windowMs = now - state.windowStart;
      if (windowMs >= 1000) {
        scheduleOnRN(onStats, {
          fps: (state.windowFrames * 1000) / windowMs,
          kept: state.prune.kept,
          pruned: state.prune.pruned,
          failed: state.failed,
        });
        state.windowStart = now;
        state.windowFrames = 0;
      }

      // 2. Most frames: nothing else to do.
      const due = startedAt > 0 && !state.saving && now - state.lastSampleAt >= controls.intervalMs.getDirty();
      if (!due) return;
      state.lastSampleAt = now;

      // 3. Sampled frame: downscale, score, maybe encode.
      let image: Image | undefined;
      let scaled: Image | undefined;
      let tiny: Image | undefined;
      let handedOff = false;
      try {
        image = HybridFrameConverter.convertFrameToImage(frame);
        const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        scaled = scale < 1 ? image.resize(width, height) : image;
        tiny = scaled.resize(SIGNATURE_WIDTH, Math.max(1, Math.round((SIGNATURE_WIDTH * height) / width)));
        const raw = tiny.toRawPixelData();
        const t = now - startedAt;
        const signature = lumaSignature(new Uint8Array(raw.buffer), raw.width, raw.height, raw.pixelFormat);
        const { keep, motion } = decidePrune(state.prune, t, signature, prune);

        if (keep) {
          const target = scaled;
          const owner = state;
          owner.saving = true;
          handedOff = true;
          target.saveToTemporaryFileAsync('jpg', FRAME_JPEG_QUALITY).then(
            (path) => {
              owner.saving = false;
              target.dispose();
              scheduleOnRN(onSample, t, toFileUri(path), motion);
            },
            () => {
              owner.saving = false;
              owner.failed++;
              target.dispose();
            },
          );
        }
      } catch {
        state.failed++;
      } finally {
        tiny?.dispose();
        if (image && image !== scaled) image.dispose();
        if (scaled && !handedOff) scaled.dispose();
      }
    } finally {
      frame.dispose();
    }
  };
}
