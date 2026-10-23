/**
 * Wrestling ruleset.
 *
 * Variants:
 *  - `folkstyle`: US collegiate style. Takedown 3, escape 1, reversal 2,
 *    near fall 2/3/4 by hold duration, riding-time point for >= 1:00 net
 *    control, technical fall at a 15-point lead.
 *  - `freestyle`: UWW style. Takedown 2 (4 straight to danger), grand
 *    amplitude 4/5, exposure 2, step-out 1, reversal 1, technical
 *    superiority at a 10-point lead, criteria tie-breaks.
 *
 * Rule values change between seasons, so every number lives in the tables
 * below and can be overridden per call via `pointOverrides`.
 */

import { leader, ScoreLedger } from '../core/ledger.ts';
import {
  compactPhases,
  durationOf,
  flattenTimeline,
  formatClock,
  mergeAdjacent,
  selectHighlights,
  type HighlightCandidate,
  type Interval,
} from '../core/timeline.ts';
import {
  type Athlete,
  type EventBase,
  type MatchResult,
  opponentOf,
  type Phase,
  type ResolvedScoreOptions,
  type RulesetModule,
  type Scorecard,
} from '../core/types.ts';
import { isAthlete, isRecord, oneOf, parseBase, parseEnd } from '../core/validate.ts';

export const WRESTLING_VERSION = 'wrestling-2026.1';
export const WRESTLING_VARIANTS = ['folkstyle', 'freestyle'] as const;
export type WrestlingVariant = (typeof WRESTLING_VARIANTS)[number];

export const PENALTY_KINDS = ['stalling', 'caution', 'technical_violation', 'unsportsmanlike', 'passivity'] as const;
export type PenaltyKind = (typeof PENALTY_KINDS)[number];

const SIMPLE_TYPES = ['shot_attempt', 'escape', 'reversal', 'exposure', 'step_out', 'fall'] as const;
type SimpleType = (typeof SIMPLE_TYPES)[number];

/**
 * `athlete` is always the athlete who performed the action / benefits from
 * it, except for `penalty` where it is the penalised athlete.
 * `shot_attempt` is a shot that did NOT finish as a takedown.
 * `control` is an interval where `athlete` rides / controls from the top.
 */
export type WrestlingEvent =
  | (EventBase & { type: 'takedown'; athlete: Athlete; toDangerPosition: boolean; grandAmplitude: boolean })
  | (EventBase & { type: SimpleType; athlete: Athlete })
  | (EventBase & { type: 'near_fall'; athlete: Athlete; endT: number })
  | (EventBase & { type: 'control'; athlete: Athlete; endT: number })
  | (EventBase & { type: 'penalty'; athlete: Athlete; kind: PenaltyKind });

export const WRESTLING_EVENT_TYPES = ['takedown', ...SIMPLE_TYPES, 'near_fall', 'control', 'penalty'] as const;

export const FOLKSTYLE_POINTS = {
  takedown: 3,
  escape: 1,
  reversal: 2,
  near_fall_2s: 2,
  near_fall_3s: 3,
  near_fall_4s: 4,
  riding_time: 1,
  riding_time_threshold_ms: 60_000,
  technical_fall_margin: 15,
} as const;

export const FREESTYLE_POINTS = {
  takedown: 2,
  takedown_to_danger: 4,
  grand_amplitude: 4,
  grand_amplitude_to_danger: 5,
  exposure: 2,
  step_out: 1,
  reversal: 1,
  passivity: 1,
  caution: 1,
  technical_superiority_margin: 10,
} as const;

/** Folkstyle penalty consequences: points to the opponent, or 'dq'. */
const FOLKSTYLE_STALLING: readonly (number | 'dq')[] = [0, 1, 1, 2, 'dq'];
const FOLKSTYLE_INFRACTION: readonly (number | 'dq')[] = [1, 1, 2, 'dq'];
/** Freestyle: third caution disqualifies. */
const FREESTYLE_MAX_CAUTIONS = 3;

export interface WrestlingStats {
  takedowns: Record<Athlete, number>;
  /** Shots that did not finish. */
  missedShots: Record<Athlete, number>;
  /** takedowns / (takedowns + missed shots); null without any attempts. */
  takedownConversion: Record<Athlete, number | null>;
  escapes: Record<Athlete, number>;
  reversals: Record<Athlete, number>;
  nearFalls: Record<Athlete, number>;
  exposures: Record<Athlete, number>;
  stepOuts: Record<Athlete, number>;
  controlMs: Record<Athlete, number>;
  /** Positive when A has more riding time, negative when B does. */
  ridingTimeAdvantageMs: number;
  penalties: Record<Athlete, number>;
}

function parseEvent(raw: unknown): WrestlingEvent | null {
  if (!isRecord(raw) || !oneOf(WRESTLING_EVENT_TYPES, raw.type)) return null;
  const base = parseBase(raw);
  if (!base || !isAthlete(raw.athlete)) return null;
  const athlete = raw.athlete;

  switch (raw.type) {
    case 'takedown':
      return {
        ...base,
        type: 'takedown',
        athlete,
        toDangerPosition: raw.toDangerPosition === true,
        grandAmplitude: raw.grandAmplitude === true,
      };
    case 'near_fall':
    case 'control': {
      const endT = parseEnd(raw, base.t);
      if (endT === null) return null;
      return { ...base, type: raw.type, athlete, endT };
    }
    case 'penalty':
      if (!oneOf(PENALTY_KINDS, raw.kind)) return null;
      return { ...base, type: 'penalty', athlete, kind: raw.kind };
    default:
      return { ...base, type: raw.type, athlete };
  }
}

function withOverrides<T extends Record<string, number>>(table: T, overrides: Record<string, number>): T {
  const resolved: Record<string, number> = { ...table };
  for (const key of Object.keys(table)) {
    const value = overrides[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) resolved[key] = value;
  }
  return resolved as T;
}

function perAthlete<T>(make: () => T): Record<Athlete, T> {
  return { A: make(), B: make() };
}

interface ControlInterval extends Interval {
  athlete: Athlete;
}

function controlTimeline(events: readonly WrestlingEvent[], endAt: number): ControlInterval[] {
  const raw: ControlInterval[] = [];
  for (const event of events) {
    if (event.type !== 'control' || event.t >= endAt) continue;
    raw.push({ start: event.t, end: Math.min(event.endT, endAt), athlete: event.athlete });
  }
  raw.sort((a, b) => a.start - b.start);
  return mergeAdjacent(flattenTimeline(raw), (iv) => iv.athlete, 1000);
}

interface ScoringState {
  ledger: ScoreLedger;
  biggestMove: Record<Athlete, number>;
  lastScorer: Athlete | null;
}

function award(state: ScoringState, t: number, athlete: Athlete, points: number, label: string): void {
  if (points <= 0) return;
  state.ledger.award(t, athlete, { points }, `${label} (+${points})`);
  state.biggestMove[athlete] = Math.max(state.biggestMove[athlete], points);
  state.lastScorer = athlete;
}

function score(events: WrestlingEvent[], options: ResolvedScoreOptions<WrestlingVariant>): Scorecard<WrestlingStats> {
  const warnings: string[] = [];
  const folk = withOverrides(FOLKSTYLE_POINTS, options.pointOverrides);
  const free = withOverrides(FREESTYLE_POINTS, options.pointOverrides);
  const isFolkstyle = options.variant === 'folkstyle';
  const margin = isFolkstyle ? folk.technical_fall_margin : free.technical_superiority_margin;

  const state: ScoringState = { ledger: new ScoreLedger(), biggestMove: { A: 0, B: 0 }, lastScorer: null };
  const stallingCount: Record<Athlete, number> = { A: 0, B: 0 };
  const infractionCount: Record<Athlete, number> = { A: 0, B: 0 };
  const highlightCandidates: HighlightCandidate[] = [];

  let result: MatchResult | null = null;
  let endAt = options.durationMs;

  for (const event of events) {
    if (event.t > endAt) break;
    const { athlete, t } = event;
    const opponent = opponentOf(athlete);

    switch (event.type) {
      case 'takedown': {
        if (isFolkstyle) {
          award(state, t, athlete, folk.takedown, 'Takedown');
        } else if (event.grandAmplitude) {
          const points = event.toDangerPosition ? free.grand_amplitude_to_danger : free.grand_amplitude;
          award(state, t, athlete, points, 'Grand amplitude throw');
        } else {
          const points = event.toDangerPosition ? free.takedown_to_danger : free.takedown;
          award(state, t, athlete, points, event.toDangerPosition ? 'Takedown to danger' : 'Takedown');
        }
        break;
      }
      case 'escape':
        if (isFolkstyle) award(state, t, athlete, folk.escape, 'Escape');
        break;
      case 'reversal':
        award(state, t, athlete, isFolkstyle ? folk.reversal : free.reversal, 'Reversal');
        break;
      case 'near_fall': {
        const held = event.endT - event.t;
        if (isFolkstyle) {
          const points =
            held >= 4000 ? folk.near_fall_4s : held >= 3000 ? folk.near_fall_3s : held >= 2000 ? folk.near_fall_2s : 0;
          award(state, event.endT, athlete, points, `Near fall ${Math.floor(held / 1000)}s`);
        } else {
          award(state, t, athlete, free.exposure, 'Exposure');
        }
        break;
      }
      case 'exposure':
        if (!isFolkstyle) award(state, t, athlete, free.exposure, 'Exposure');
        break;
      case 'step_out':
        if (!isFolkstyle) award(state, t, athlete, free.step_out, 'Step out');
        break;
      case 'fall':
        endAt = t;
        result = { winner: athlete, method: 'fall', at: t, summary: `${athlete} wins by fall at ${formatClock(t)}` };
        highlightCandidates.push({ t, athlete, label: 'Fall (pin)', weight: 10 });
        break;
      case 'penalty': {
        state.ledger.award(t, athlete, { penalties: 1 }, `Penalty: ${event.kind.replace(/_/g, ' ')}`);
        const outcome = penaltyOutcome(event.kind, athlete, isFolkstyle, stallingCount, infractionCount, free);
        if (outcome === 'dq') {
          endAt = t;
          result = {
            winner: opponent,
            method: 'disqualification',
            at: t,
            summary: `${opponent} wins by disqualification at ${formatClock(t)}`,
          };
        } else if (outcome > 0) {
          state.ledger.award(t, opponent, { points: outcome }, `Penalty point(s) (+${outcome})`);
          state.lastScorer = opponent;
        }
        break;
      }
      default:
        break;
    }
    if (result) break;

    // Technical fall / superiority ends the bout as soon as the margin is reached.
    const totals = state.ledger.totals();
    const lead = Math.abs(totals.A.points - totals.B.points);
    if (lead >= margin) {
      const winner = leader(totals.A.points, totals.B.points) as Athlete;
      endAt = t;
      result = {
        winner,
        method: 'technical_superiority',
        at: t,
        summary: `${winner} wins by ${isFolkstyle ? 'technical fall' : 'technical superiority'} (${totals[winner].points}-${totals[opponentOf(winner)].points}) at ${formatClock(t)}`,
      };
      break;
    }
  }

  const control = controlTimeline(events, endAt);
  const controlMs: Record<Athlete, number> = { A: 0, B: 0 };
  for (const interval of control) controlMs[interval.athlete] += durationOf(interval);
  const ridingAdvantage = controlMs.A - controlMs.B;

  if (!result && isFolkstyle && Math.abs(ridingAdvantage) >= folk.riding_time_threshold_ms) {
    const rider: Athlete = ridingAdvantage > 0 ? 'A' : 'B';
    state.ledger.award(endAt, rider, { points: folk.riding_time }, `Riding time ${formatClock(Math.abs(ridingAdvantage))} (+${folk.riding_time})`);
  }

  const totals = state.ledger.totals(endAt);
  if (!result) {
    result = decide(totals.A.points, totals.B.points, isFolkstyle, state, totals.A.penalties, totals.B.penalties);
  }
  if (control.length === 0 && isFolkstyle) {
    warnings.push('No top-control intervals were detected, so riding time could not be computed.');
  }

  for (const line of state.ledger.lines) {
    highlightCandidates.push({ t: line.t, athlete: line.athlete, label: line.label, weight: line.points * 2 });
  }

  return {
    discipline: 'wrestling',
    variant: options.variant,
    rulesetVersion: WRESTLING_VERSION,
    durationMs: options.durationMs,
    result,
    totals,
    scoreLog: state.ledger.lines.filter((line) => line.t <= endAt),
    stats: computeStats(events, endAt, controlMs, ridingAdvantage),
    phases: buildPhases(control, endAt),
    highlights: selectHighlights(highlightCandidates, options.durationMs, options.maxHighlights),
    warnings,
    droppedEvents: 0,
  };
}

function penaltyOutcome(
  kind: PenaltyKind,
  athlete: Athlete,
  isFolkstyle: boolean,
  stallingCount: Record<Athlete, number>,
  infractionCount: Record<Athlete, number>,
  free: typeof FREESTYLE_POINTS,
): number | 'dq' {
  if (isFolkstyle) {
    if (kind === 'stalling' || kind === 'passivity') {
      const nth = ++stallingCount[athlete];
      return FOLKSTYLE_STALLING[Math.min(nth, FOLKSTYLE_STALLING.length) - 1] ?? 'dq';
    }
    const nth = ++infractionCount[athlete];
    return FOLKSTYLE_INFRACTION[Math.min(nth, FOLKSTYLE_INFRACTION.length) - 1] ?? 'dq';
  }
  if (kind === 'passivity' || kind === 'stalling') return free.passivity;
  const nth = ++infractionCount[athlete];
  return nth >= FREESTYLE_MAX_CAUTIONS ? 'dq' : free.caution;
}

function decide(
  a: number,
  b: number,
  isFolkstyle: boolean,
  state: ScoringState,
  penaltiesA: number,
  penaltiesB: number,
): MatchResult {
  const byPoints = leader(a, b);
  if (byPoints) return { winner: byPoints, method: 'points', summary: `${byPoints} wins on points (${a}-${b})` };
  if (isFolkstyle) {
    return { winner: null, method: 'draw', summary: `Tied ${a}-${b}; sudden-victory overtime would decide` };
  }
  // UWW criteria: biggest single move, then fewest cautions, then last point scored.
  const byBiggestMove = leader(state.biggestMove.A, state.biggestMove.B);
  if (byBiggestMove) {
    return { winner: byBiggestMove, method: 'criteria', summary: `${byBiggestMove} wins on criteria (highest-value move) at ${a}-${b}` };
  }
  const byCautions = leader(penaltiesB, penaltiesA);
  if (byCautions) {
    return { winner: byCautions, method: 'criteria', summary: `${byCautions} wins on criteria (fewer cautions) at ${a}-${b}` };
  }
  if (state.lastScorer) {
    return { winner: state.lastScorer, method: 'criteria', summary: `${state.lastScorer} wins on criteria (last point scored) at ${a}-${b}` };
  }
  return { winner: null, method: 'draw', summary: 'No score: draw' };
}

function computeStats(
  events: readonly WrestlingEvent[],
  endAt: number,
  controlMs: Record<Athlete, number>,
  ridingTimeAdvantageMs: number,
): WrestlingStats {
  const stats: WrestlingStats = {
    takedowns: perAthlete(() => 0),
    missedShots: perAthlete(() => 0),
    takedownConversion: perAthlete<number | null>(() => null),
    escapes: perAthlete(() => 0),
    reversals: perAthlete(() => 0),
    nearFalls: perAthlete(() => 0),
    exposures: perAthlete(() => 0),
    stepOuts: perAthlete(() => 0),
    controlMs,
    ridingTimeAdvantageMs,
    penalties: perAthlete(() => 0),
  };
  for (const event of events) {
    if (event.t > endAt) continue;
    const { athlete } = event;
    switch (event.type) {
      case 'takedown':
        stats.takedowns[athlete]++;
        break;
      case 'shot_attempt':
        stats.missedShots[athlete]++;
        break;
      case 'escape':
        stats.escapes[athlete]++;
        break;
      case 'reversal':
        stats.reversals[athlete]++;
        break;
      case 'near_fall':
        stats.nearFalls[athlete]++;
        break;
      case 'exposure':
        stats.exposures[athlete]++;
        break;
      case 'step_out':
        stats.stepOuts[athlete]++;
        break;
      case 'penalty':
        stats.penalties[athlete]++;
        break;
      default:
        break;
    }
  }
  for (const athlete of ['A', 'B'] as const) {
    const attempts = stats.takedowns[athlete] + stats.missedShots[athlete];
    stats.takedownConversion[athlete] = attempts > 0 ? stats.takedowns[athlete] / attempts : null;
  }
  return stats;
}

function buildPhases(control: readonly ControlInterval[], endAt: number): Phase[] {
  const phases: Phase[] = [];
  let cursor = 0;
  for (const interval of control) {
    if (interval.start - cursor >= 1000) {
      phases.push({ start: cursor, end: interval.start, kind: 'neutral', label: 'Neutral', dominant: null });
    }
    phases.push({
      start: interval.start,
      end: interval.end,
      kind: 'control',
      label: `${interval.athlete} riding`,
      dominant: interval.athlete,
    });
    cursor = interval.end;
  }
  if (control.length > 0 && endAt - cursor >= 1000) {
    phases.push({ start: cursor, end: endAt, kind: 'neutral', label: 'Neutral', dominant: null });
  }
  return compactPhases(phases);
}

export const wrestlingRuleset: RulesetModule<WrestlingEvent, WrestlingStats, WrestlingVariant> = {
  discipline: 'wrestling',
  version: WRESTLING_VERSION,
  variants: WRESTLING_VARIANTS,
  defaultVariant: 'folkstyle',
  parseEvent,
  score,
};
