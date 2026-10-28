/**
 * Live capture telemetry (configured FPS, measured FPS, frame counts,
 * recording clock) in a tiny external store.
 *
 * Only the HUD subscribes, via useSyncExternalStore with primitive
 * selectors, so stats updates and the recording timer never re-render the
 * <Camera> subtree (each re-render there would push new native props to the
 * preview view while it is streaming at 60 FPS).
 */

import { useSyncExternalStore } from 'react';
import type { CapturePlan } from './capture-plan';

export interface CaptureTelemetry {
  plan: CapturePlan | null;
  /** FPS the session was configured with (from VisionCamera's negotiation). */
  configuredFps: number | null;
  /** FPS actually delivered by the camera (frame-thread counter; live-sampling plans only). */
  measuredFps: number | null;
  /** Wall-clock ms when recording started, 0 when not recording. */
  recordingStartedAt: number;
  keptFrames: number;
  prunedFrames: number;
  failedFrames: number;
  warning: string | null;
}

export interface TelemetryStore {
  get(): CaptureTelemetry;
  set(patch: Partial<CaptureTelemetry>): void;
  subscribe(listener: () => void): () => void;
}

export const INITIAL_TELEMETRY: CaptureTelemetry = {
  plan: null,
  configuredFps: null,
  measuredFps: null,
  recordingStartedAt: 0,
  keptFrames: 0,
  prunedFrames: 0,
  failedFrames: 0,
  warning: null,
};

export function createTelemetryStore(initial: CaptureTelemetry = INITIAL_TELEMETRY): TelemetryStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const key of Object.keys(patch) as (keyof CaptureTelemetry)[]) {
        if (!Object.is(state[key], patch[key])) changed = true;
      }
      if (!changed) return;
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Subscribes to one value; return primitives so unrelated updates are ignored. */
export function useTelemetry<T>(store: TelemetryStore, select: (telemetry: CaptureTelemetry) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get()),
  );
}
