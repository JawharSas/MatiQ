/**
 * Live capture at 30-60 FPS with live AI frame sampling.
 *
 * Threading model:
 *  - Preview and recording are fully native: VisionCamera 5 (Nitro/JSI)
 *    streams camera buffers straight into the preview layer and the hardware
 *    encoder (AVCaptureMovieFileOutput / CameraX VideoCapture). JS never
 *    touches full-rate frames.
 *  - AI sampling runs as a worklet on the frame output's own thread
 *    (frame-thread-sampler.ts): it measures the real delivered FPS and
 *    converts ~1 frame/s to a small JPEG. The UI thread and JS thread are not
 *    involved per frame.
 *  - The output combination and frame rate come from a per-device probe
 *    (useCapturePlan). Devices that cannot add the analysis stream at 60 FPS
 *    record preview + video only and are sampled from the file afterwards.
 *  - Nothing in here triggers React re-renders while recording; HUD values
 *    flow through the telemetry store.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import {
  type CameraSessionConfig,
  CommonResolutions,
  type InterruptionReason,
  type Recorder,
  useCameraDevice,
  useFrameOutput,
  useVideoOutput,
} from 'react-native-vision-camera';
import { bitRateFor, captureConstraints, type CapturePlan, type FpsPreference } from './capture-plan';
import { createTelemetryStore } from './capture-telemetry';
import { type SampledFrame, toFileUri } from './frame-processor';
import { planSampling } from './frame-sampling';
import { createFrameSampler, createSamplerControls, type FrameStats } from './frame-thread-sampler';
import { useCapturePlan } from './useCapturePlan';

export type LiveCaptureState = 'idle' | 'recording' | 'finishing';

export interface LiveCaptureResult {
  videoUri: string;
  durationMs: number;
  plan: CapturePlan;
  /** false: frames still need to be sampled from `videoUri`. */
  liveSampled: boolean;
  stats: { kept: number; pruned: number; failed: number };
}

export interface LiveCaptureOptions {
  maxDurationMs: number;
  maxFrames: number;
  enableAudio: boolean;
  fpsPreference: FpsPreference;
  onFrame: (frame: SampledFrame) => void;
  /** 0..1 fill level of the upload queue, used for backpressure. */
  uploadPressure: () => number;
  /** Recording stopped on its own (max duration / file size). */
  onAutoStop?: () => void;
  /** App left the foreground or the OS interrupted the camera mid-recording. */
  onInterrupted?: (reason: InterruptionReason | 'background') => void;
}

export function useLiveCapture(options: LiveCaptureOptions) {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const device = useCameraDevice('back');
  const telemetry = useMemo(() => createTelemetryStore(), []);

  const videoOutput = useVideoOutput({
    targetResolution: CommonResolutions.FHD_16_9,
    // iOS records HEVC; Android records H.264 (compressed to HEVC before upload).
    targetBitRate: bitRateFor(options.fpsPreference, { maxDurationMs: options.maxDurationMs, recordsHevc: Platform.OS === 'ios' }),
    enableAudio: options.enableAudio,
    fileType: 'mp4',
  });

  // Live sampling: shared controls + worklet on the frame output thread.
  const baseIntervalMs = planSampling(options.maxDurationMs, options.maxFrames, 1).intervalMs;
  const controls = useMemo(() => createSamplerControls(baseIntervalMs), [baseIntervalMs]);

  const onSample = useCallback(
    (t: number, uri: string, motion: number) => {
      optionsRef.current.onFrame({ t, uri, motion });
      // Halve the sampling rate while the upload queue is backing up.
      const backedUp = optionsRef.current.uploadPressure() > 0.75;
      controls.intervalMs.setBlocking(backedUp ? baseIntervalMs * 2 : baseIntervalMs);
    },
    [controls, baseIntervalMs],
  );
  const onStats = useCallback(
    (stats: FrameStats) =>
      telemetry.set({
        measuredFps: Math.round(stats.fps),
        keptFrames: stats.kept,
        prunedFrames: stats.pruned,
        failedFrames: stats.failed,
      }),
    [telemetry],
  );
  const onFrame = useMemo(() => createFrameSampler(controls, onSample, onStats), [controls, onSample, onStats]);

  const frameOutput = useFrameOutput({
    // Analysis only needs small frames; preview-sized buffers keep memory
    // bandwidth low and leave headroom for 60 FPS recording.
    targetResolution: CommonResolutions.HD_16_9,
    enablePreviewSizedOutputBuffers: true,
    dropFramesWhileBusy: true,
    allowDeferredStart: true,
    onFrame,
  });

  const planState = useCapturePlan(device, videoOutput, frameOutput, options.fpsPreference);
  const plan = planState.plan;
  useEffect(() => {
    telemetry.set({
      plan,
      configuredFps: null,
      measuredFps: null,
      warning: planState.degraded ? 'Could not probe camera capabilities; using 30 FPS.' : null,
    });
  }, [telemetry, plan, planState.degraded]);

  // Stable props for <Camera>: identity only changes with the plan.
  const outputs = useMemo(
    () => (plan === null ? [] : plan.liveSampling ? [videoOutput, frameOutput] : [videoOutput]),
    [plan, videoOutput, frameOutput],
  );
  const constraints = useMemo(() => (plan === null ? [] : captureConstraints(plan.fps, videoOutput)), [plan, videoOutput]);
  const onSessionConfigSelected = useCallback(
    (config: CameraSessionConfig) => telemetry.set({ configuredFps: config.selectedFPS ?? null }),
    [telemetry],
  );

  // Recording ------------------------------------------------------------------
  const [state, setState] = useState<LiveCaptureState>('idle');
  const recorderRef = useRef<Recorder | null>(null);
  const finishedRef = useRef<Promise<string> | null>(null);
  const startedAtRef = useRef(0);

  const resetClock = useCallback(() => {
    controls.recordingStartedAt.setBlocking(0);
    telemetry.set({ recordingStartedAt: 0 });
  }, [controls, telemetry]);

  const start = useCallback(async () => {
    if (recorderRef.current || !plan) return;
    controls.intervalMs.setBlocking(baseIntervalMs);
    telemetry.set({ keptFrames: 0, prunedFrames: 0, failedFrames: 0, warning: null });

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
        .then(() => {
          // Sample timestamps are relative to the moment recording really started.
          const startedAt = Date.now();
          startedAtRef.current = startedAt;
          controls.recordingStartedAt.setBlocking(startedAt);
          telemetry.set({ recordingStartedAt: startedAt });
        })
        .catch(reject);
    });
    setState('recording');
  }, [plan, controls, baseIntervalMs, telemetry, videoOutput]);

  const stop = useCallback(async (): Promise<LiveCaptureResult | null> => {
    const recorder = recorderRef.current;
    const finished = finishedRef.current;
    if (!recorder || !finished || !plan) return null;
    setState('finishing');
    const durationMs = Date.now() - (startedAtRef.current || Date.now());
    resetClock();
    try {
      if (recorder.isRecording) await recorder.stopRecording();
      const filePath = await finished;
      const { keptFrames, prunedFrames, failedFrames } = telemetry.get();
      return {
        videoUri: toFileUri(filePath),
        durationMs,
        plan,
        liveSampled: plan.liveSampling,
        stats: { kept: keptFrames, pruned: prunedFrames, failed: failedFrames },
      };
    } finally {
      recorderRef.current = null;
      finishedRef.current = null;
      setState('idle');
    }
  }, [plan, resetClock, telemetry]);

  const cancel = useCallback(async () => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    finishedRef.current = null;
    resetClock();
    setState('idle');
    if (recorder?.isRecording) await recorder.cancelRecording();
  }, [resetClock]);

  const onInterruptionStarted = useCallback(
    (reason: InterruptionReason) => {
      if (reason === 'video-device-not-available-due-to-system-pressure') {
        telemetry.set({ warning: 'The camera is overheating. Recording was stopped; try 30 FPS.' });
      }
      if (recorderRef.current) optionsRef.current.onInterrupted?.(reason);
    },
    [telemetry],
  );

  // The OS suspends the camera in the background: finish the take cleanly.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && recorderRef.current) optionsRef.current.onInterrupted?.('background');
    });
    return () => subscription.remove();
  }, []);

  return {
    device,
    plan,
    probing: planState.probing,
    outputs,
    constraints,
    telemetry,
    state,
    start,
    stop,
    cancel,
    onSessionConfigSelected,
    onInterruptionStarted,
  };
}
