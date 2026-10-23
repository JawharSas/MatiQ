/**
 * Tiny dependency-free validators for untrusted event payloads.
 *
 * Model output is treated exactly like user input: every field is checked and
 * anything malformed is dropped rather than coerced.
 */

import type { Athlete, EventBase } from './types.ts';

/** Upper bound for any timestamp: 4 hours. Rejects absurd values early. */
export const MAX_TIMESTAMP_MS = 4 * 60 * 60 * 1000;

export type UnknownRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_TIMESTAMP_MS;
}

export function isAthlete(value: unknown): value is Athlete {
  return value === 'A' || value === 'B';
}

export function oneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** Short, printable label (technique names, penalty reasons). */
export function cleanLabel(value: unknown, maxLength = 48): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N} _\-/'().]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Parses the fields shared by all events. Returns null when `t` or
 * `confidence` is invalid.
 */
export function parseBase(raw: UnknownRecord): EventBase | null {
  if (!isTimestamp(raw.t)) return null;
  const confidence = raw.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return null;
  }
  const base: EventBase = { t: Math.round(raw.t), confidence };
  if (raw.source === 'manual' || raw.source === 'ai') base.source = raw.source;
  return base;
}

/** Parses an optional interval end; must be after `t`. */
export function parseEnd(raw: UnknownRecord, t: number): number | null {
  if (!isTimestamp(raw.endT)) return null;
  const endT = Math.round(raw.endT);
  return endT > t ? endT : null;
}
