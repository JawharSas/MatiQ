/**
 * Interval, phase and highlight helpers shared by the discipline modules.
 */

import type { Athlete, Highlight, Phase } from './types.ts';

export interface Interval {
  start: number;
  end: number;
}

export function durationOf(interval: Interval): number {
  return Math.max(0, interval.end - interval.start);
}

export function overlap(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export function clampInterval<T extends Interval>(interval: T, min: number, max: number): T | null {
  const start = Math.max(min, interval.start);
  const end = Math.min(max, interval.end);
  return end > start ? { ...interval, start, end } : null;
}

/**
 * Merges consecutive intervals that share the same key when the gap between
 * them is at most `maxGapMs`. Input must be sorted by start.
 *
 * Frame sampling at 1-2 FPS makes the model split one long position into
 * several adjacent detections; merging prevents scoring the same position
 * twice.
 */
export function mergeAdjacent<T extends Interval>(
  intervals: readonly T[],
  keyOf: (interval: T) => string,
  maxGapMs: number,
): T[] {
  const merged: T[] = [];
  for (const interval of intervals) {
    const last = merged[merged.length - 1];
    if (last && keyOf(last) === keyOf(interval) && interval.start - last.end <= maxGapMs) {
      merged[merged.length - 1] = { ...last, end: Math.max(last.end, interval.end) };
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * Resolves overlapping intervals so each moment belongs to one interval:
 * a later-starting interval truncates the earlier one. Input must be sorted.
 */
export function flattenTimeline<T extends Interval>(intervals: readonly T[]): T[] {
  const result: T[] = [];
  for (const interval of intervals) {
    const last = result[result.length - 1];
    if (last && interval.start < last.end) {
      if (interval.start <= last.start) {
        result.pop();
      } else {
        result[result.length - 1] = { ...last, end: interval.start };
      }
    }
    result.push({ ...interval });
  }
  return result.filter((interval) => interval.end > interval.start);
}

/** Total time covered by intervals matching `predicate` within `window`. */
export function coveredMs<T extends Interval>(
  intervals: readonly T[],
  window: Interval,
  predicate: (interval: T) => boolean,
): number {
  let total = 0;
  for (const interval of intervals) {
    if (predicate(interval)) total += overlap(interval, window);
  }
  return total;
}

/** Merges consecutive phases with identical kind and dominant athlete. */
export function compactPhases(phases: readonly Phase[], maxGapMs = 1500): Phase[] {
  return mergeAdjacent(
    [...phases].sort((a, b) => a.start - b.start),
    (phase) => `${phase.kind}:${phase.dominant ?? '-'}`,
    maxGapMs,
  );
}

export interface HighlightCandidate {
  t: number;
  athlete: Athlete | null;
  label: string;
  weight: number;
}

/**
 * Picks the most significant moments, gives each a clip window and merges
 * overlapping windows so the same few seconds are never clipped twice.
 */
export function selectHighlights(
  candidates: readonly HighlightCandidate[],
  durationMs: number,
  maxHighlights: number,
  leadMs = 5000,
  tailMs = 5000,
): Highlight[] {
  const top = [...candidates]
    .filter((candidate) => candidate.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.t - b.t)
    .slice(0, Math.max(0, maxHighlights * 2));

  const windows: Highlight[] = top
    .map((candidate) => ({
      ...candidate,
      start: Math.max(0, candidate.t - leadMs),
      end: Math.min(durationMs, candidate.t + tailMs),
    }))
    .sort((a, b) => a.start - b.start);

  const merged: Highlight[] = [];
  for (const window of windows) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end) {
      const keepWindow = window.weight > last.weight;
      merged[merged.length - 1] = {
        t: keepWindow ? window.t : last.t,
        athlete: keepWindow ? window.athlete : last.athlete,
        label: keepWindow ? window.label : last.label,
        weight: last.weight + window.weight,
        start: last.start,
        end: Math.max(last.end, window.end),
      };
    } else {
      merged.push(window);
    }
  }

  return merged
    .sort((a, b) => b.weight - a.weight || a.t - b.t)
    .slice(0, maxHighlights)
    .sort((a, b) => a.t - b.t);
}

/** Formats milliseconds as m:ss for human-readable summaries. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
