/**
 * @matiq/rules-engine
 *
 * Deterministic, dependency-free scoring for BJJ, wrestling and MMA. The AI
 * layer only *detects* events; every point on a scorecard is computed here so
 * results are reproducible, auditable and identical on device and server.
 *
 * Runs unchanged in React Native (Metro), Node 22+ and Deno (Supabase Edge
 * Functions) - imports therefore use explicit `.ts` extensions.
 */

import { bjjRuleset } from './disciplines/bjj.ts';
import { mmaRuleset } from './disciplines/mma.ts';
import { wrestlingRuleset } from './disciplines/wrestling.ts';
import type { Discipline, EventBase, ResolvedScoreOptions, RulesetModule, Scorecard, ScoreOptions } from './core/types.ts';
import { isRecord } from './core/validate.ts';

export * from './core/types.ts';
export { formatClock } from './core/timeline.ts';
export * from './disciplines/bjj.ts';
export * from './disciplines/mma.ts';
export * from './disciplines/wrestling.ts';
export * from './ranking/index.ts';

export const RULESETS = {
  bjj: bjjRuleset,
  wrestling: wrestlingRuleset,
  mma: mmaRuleset,
} as const satisfies Record<Discipline, { readonly discipline: Discipline }>;

export const DISCIPLINES = Object.keys(RULESETS) as Discipline[];

/** Hard cap on events per analysis; protects against runaway model output. */
export const MAX_EVENTS = 5000;

export const DEFAULT_MIN_CONFIDENCE = 0.6;

export function isDiscipline(value: unknown): value is Discipline {
  return typeof value === 'string' && value in RULESETS;
}

export function variantsFor(discipline: Discipline): readonly string[] {
  return RULESETS[discipline].variants;
}

export class RulesEngineError extends Error {
  override name = 'RulesEngineError';
}

/**
 * Validates untrusted events, applies the confidence filter, sorts by time
 * and scores them with the selected discipline module.
 */
export function analyzeMatch(discipline: Discipline, rawEvents: unknown, options: ScoreOptions): Scorecard {
  if (!isDiscipline(discipline)) throw new RulesEngineError(`Unknown discipline: ${String(discipline)}`);
  if (!Array.isArray(rawEvents)) throw new RulesEngineError('Events must be an array');
  if (!Number.isFinite(options.durationMs) || options.durationMs <= 0) {
    throw new RulesEngineError('durationMs must be a positive number');
  }
  // The registry is keyed by discipline, so the module and its events agree.
  const module = RULESETS[discipline] as unknown as RulesetModule<EventBase, unknown>;

  const variant = options.variant ?? module.defaultVariant;
  if (!module.variants.includes(variant)) {
    throw new RulesEngineError(`Unknown ${discipline} variant: ${variant}`);
  }

  const resolved: ResolvedScoreOptions = {
    durationMs: Math.round(options.durationMs),
    variant,
    minConfidence: clamp(options.minConfidence ?? DEFAULT_MIN_CONFIDENCE, 0, 1),
    roundDurationMs: options.roundDurationMs ?? 5 * 60 * 1000,
    maxHighlights: Math.max(0, Math.min(options.maxHighlights ?? 8, 50)),
    pointOverrides: sanitizeOverrides(options.pointOverrides),
  };

  const warnings: string[] = [];
  if (rawEvents.length > MAX_EVENTS) {
    warnings.push(`Only the first ${MAX_EVENTS} of ${rawEvents.length} events were analysed.`);
  }

  let dropped = 0;
  let lowConfidence = 0;
  const events: EventBase[] = [];
  for (const raw of rawEvents.slice(0, MAX_EVENTS)) {
    const event = module.parseEvent(raw);
    if (!event || event.t > resolved.durationMs) {
      dropped++;
      continue;
    }
    if (event.confidence < resolved.minConfidence) {
      lowConfidence++;
      continue;
    }
    events.push(event);
  }
  events.sort((a, b) => a.t - b.t);

  if (dropped > 0) warnings.push(`${dropped} malformed or out-of-range event(s) were discarded.`);
  if (lowConfidence > 0) {
    warnings.push(`${lowConfidence} event(s) below ${Math.round(resolved.minConfidence * 100)}% confidence were ignored.`);
  }

  const scorecard = module.score(events, resolved);
  return {
    ...scorecard,
    warnings: [...warnings, ...scorecard.warnings],
    droppedEvents: dropped + lowConfidence,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}

function sanitizeOverrides(overrides: unknown): Record<string, number> {
  const clean: Record<string, number> = {};
  if (!isRecord(overrides)) return clean;
  for (const [key, value] of Object.entries(overrides)) {
    if (/^[a-z0-9_]{1,40}$/.test(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000) {
      clean[key] = value;
    }
  }
  return clean;
}
