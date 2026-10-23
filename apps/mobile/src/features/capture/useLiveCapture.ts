/**
 * Live capture: hardware-encoded 1080p/30 FPS recording plus 1-2 FPS frame
 * sampling for analysis.
 *
 * Threading model:
 *  - Preview and video encoding never touch JS: VisionCamera streams frames
 *    from the camera straight into the native preview and the hardware
 *    encoder (AVAssetWriter / MediaCodec), keeping the UI thread at 60 FPS.
 *  - Sampling grabs a preview snapshot on a timer. Snapshot, resize, pixel
 *    read and JPEG encode all run natively in the background; JS only
 *    receives a file path and a 16-px signature.
 *  - Backpressure: a tick is skipped while the previous snapshot is still
 *    being processed, and every other tick is skipped when the upload queue
 *    is filling up, so slow devices degrade gracefully instead of piling up
 *    work (heat, memory).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { type CameraRef, CommonResolutions, type Recorder, useVideoOutput } from 'react-native-vision-camera';
import { processFrame, type SampledFrame, toFileUri } from './frame-processor';
import { FramePruner, planSampling } from './frame-sampling';

export type LiveCaptureState = 'idle' | 'recording' | 'finishing';

export interface LiveCaptureResult {
  videoUri: string;
  durationMs: number;
  stats: { sampled: number; kept: number; pruned: number; skippedTicks: number };
}

export interface LiveCaptureOptions {
  maxDurationMs: number;
  maxFrames: number;
  enableAudio: boolean;
  onFrame: (frame: SampledFrame) => void;
  /** 0..1 fill level of the upload queue, used for backpressure. */
  uploadPressure: () => number;
  /** Called when the recording stopped on its own (max duration / file size). */
  onAutoStop?: () => void;
  /** Called when the app leaves the foreground mid-recording. */
  onInterrupted?: () => void;
}

/** ~8 Mbps keeps 1080p sparring footage sharp at roughly 60 MB/minute. */
const TARGET_BITRATE = 8_000_000;

export function useLiveCapture(options: LiveCaptureOptions) {
  const cameraRef = useRef<CameraRef>(null);
  const videoOutput = useVideoOutput({
    targetResolution: CommonResolutions.FHD_16_9,
    targetBitRate: TARGET_BITRATE,
    enableAudio: options.enableAudio,
    fileType: 'mp4',
  });

  const [state, setState] = useState<LiveCaptureState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [keptFrames, setKeptFrames] = useState(0);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const recorderRef = useRef<Recorder | null>(null);
  const startedAtRef = useRef(0);
  const timersRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const finishedRef = useRef<Promise<string> | null>(null);
  const statsRef = useRef({ sampled: 0, skippedTicks: 0, tick: 0, pruner: new FramePruner(), inFlight: false });

  const clearTimers = () => {
    for (const timer of timersRef.current) clearInterval(timer);
    timersRef.current = [];
  };

  const sample = useCallback(async () => {
    const stats = statsRef.current;
    stats.tick++;
    const camera = cameraRef.current;
    const pressure = optionsRef.current.uploadPressure();
    if (stats.inFlight || !camera || (pressure > 0.75 && stats.tick % 2 === 0)) {
      stats.skippedTicks++;
      return;
    }
    stats.inFlight = true;
    try {
      const t = Date.now() - startedAtRef.current;
      const snapshot = await camera.takeSnapshot();
      stats.sampled++;
      const frame = await processFrame(snapshot, t, stats.pruner);
      if (frame) {
        optionsRef.current.onFrame(frame);
        setKeptFrames(stats.pruner.kept);
      }
    } catch {
      // A dropped sample is acceptable; the recording itself is unaffected.
      stats.skippedTicks++;
    } finally {
      stats.inFlight = false;
    }
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    const { intervalMs } = planSampling(optionsRef.current.maxDurationMs, optionsRef.current.maxFrames, 1);
    statsRef.current = { sampled: 0, skippedTicks: 0, tick: 0, pruner: new FramePruner(), inFlight: false };
    setKeptFrames(0);

    const recorder = await videoOutput.createRecorder({ maxDuration: optionsRef.current.maxDurationMs / 1000 });
    recorderRef.current = recorder;
    finishedRef.current = new Promise<string>((resolve, reject) => {
      recorder
        .startRecording(
          (filePath, reason) => {
            resolve(filePath);
            if (reason !== 'stopped') optionsRef.current.onAutoStop?.();
          },
          (error) => reject(error),
        )
        .catch(reject);
    });
    startedAtRef.current = Date.now();
    setState('recording');

    void sample();
    timersRef.current.push(setInterval(() => void sample(), intervalMs));
    timersRef.current.push(setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 500));
  }, [sample, videoOutput]);

  const stop = useCallback(async (): Promise<LiveCaptureResult | null> => {
    const recorder = recorderRef.current;
    if (!recorder || !finishedRef.current) return null;
    setState('finishing');
    clearTimers();
    const durationMs = Date.now() - startedAtRef.current;
    try {
      if (recorder.isRecording) await recorder.stopRecording();
      const filePath = await finishedRef.current;
      const { sampled, skippedTicks, pruner } = statsRef.current;
      return {
        videoUri: toFileUri(filePath),
        durationMs,
        stats: { sampled, kept: pruner.kept, pruned: pruner.pruned, skippedTicks },
      };
    } finally {
      recorderRef.current = null;
      finishedRef.current = null;
      setState('idle');
    }
  }, []);

  const cancel = useCallback(async () => {
    clearTimers();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    finishedRef.current = null;
    setState('idle');
    if (recorder?.isRecording) await recorder.cancelRecording();
  }, []);

  // The OS suspends the camera in the background: let the screen finish the
  // take cleanly instead of losing it.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && recorderRef.current) optionsRef.current.onInterrupted?.();
    });
    return () => {
      subscription.remove();
      clearTimers();
    };
  }, []);

  return { cameraRef, videoOutput, state, elapsedMs, keptFrames, start, stop, cancel };
}
