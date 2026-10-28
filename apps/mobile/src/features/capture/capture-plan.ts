/**
 * Capture plans: which frame rate and which outputs a recording uses.
 *
 * 60 FPS needs more sensor and ISP bandwidth than 30 FPS, and every extra
 * camera stream (here: the frame output used for live AI sampling) competes
 * for the same bandwidth. Many devices can do 1080p60 with preview + video,
 * but not with a third stream. So instead of hoping, the app probes the
 * device (see useCapturePlan) and walks this candidate list in order:
 *
 *   auto: 60 FPS + live sampling  ->  60 FPS, sample after recording
 *         -> 30 FPS + live sampling  ->  30 FPS, sample after recording
 *
 * Pure module (types only from VisionCamera) so it is unit-testable in Node.
 */

import type { CameraOutput, Constraint, TargetDynamicRange } from 'react-native-vision-camera';

export type FpsPreference = 'auto' | '60' | '30';

export interface CapturePlan {
  /** Target frame rate for preview and recording. */
  fps: 30 | 60;
  /**
   * true: a frame output samples frames for AI analysis while recording.
   * false: only preview + video run; frames are sampled from the finished file.
   */
  liveSampling: boolean;
}

export interface ProbeResult {
  candidate: CapturePlan;
  supported: boolean;
  /** FPS the device negotiated for this combination (undefined = unknown). */
  selectedFps: number | undefined;
}

/** Most compatible configuration; used when probing is impossible. */
export const FALLBACK_PLAN: CapturePlan = { fps: 30, liveSampling: false };

export function candidatesFor(preference: FpsPreference): CapturePlan[] {
  const sixty: CapturePlan[] = [
    { fps: 60, liveSampling: true },
    { fps: 60, liveSampling: false },
  ];
  const thirty: CapturePlan[] = [
    { fps: 30, liveSampling: true },
    { fps: 30, liveSampling: false },
  ];
  if (preference === '60') return sixty;
  if (preference === '30') return thirty;
  return [...sixty, ...thirty];
}

/** 59.94 / 29.97 count as meeting 60 / 30. */
export function meetsTarget(result: ProbeResult): boolean {
  return result.supported && (result.selectedFps ?? 0) >= result.candidate.fps * 0.98;
}

/**
 * Picks the first candidate (in priority order) the device fully supports.
 * If none hits its target exactly, takes the supported result with the
 * highest negotiated frame rate, as long as it is still at least 24 FPS.
 */
export function choosePlan(results: readonly ProbeResult[]): CapturePlan | null {
  const exact = results.find(meetsTarget);
  if (exact) return exact.candidate;

  const best = results
    .filter((result) => result.supported && (result.selectedFps ?? 0) >= 24)
    .sort((a, b) => (b.selectedFps ?? 0) - (a.selectedFps ?? 0))[0];
  if (!best) return null;
  return { fps: (best.selectedFps ?? 0) >= 59 ? 60 : 30, liveSampling: best.candidate.liveSampling };
}

const SDR: TargetDynamicRange = { bitDepth: 'sdr-8-bit', colorSpace: 'srgb', colorRange: 'full' };

/**
 * Session constraints, highest priority first. Everything after `fps` is
 * chosen to keep 60 FPS sustainable (bandwidth, latency, heat):
 *  - recording resolution beats the low-res analysis stream
 *  - stabilization off: no crop/latency, sparring is usually filmed on a tripod
 *  - 8-bit SDR: HDR often caps devices at 30 FPS and is useless for analysis
 *  - binned sensor readouts move far less data per frame
 */
export function captureConstraints(fps: number, videoOutput: CameraOutput): Constraint[] {
  return [
    { fps },
    { resolutionBias: videoOutput },
    { videoStabilizationMode: 'off' },
    { previewStabilizationMode: 'off' },
    { videoDynamicRange: SDR },
    { binned: true },
  ];
}

/** HEVC/H.264 target bit rates for 1080p sparring footage. */
export function bitRateFor(preference: FpsPreference): number {
  return preference === '30' ? 9_000_000 : 14_000_000;
}
