/**
 * MMA ruleset: projected 10-point-must round scoring.
 *
 * Judging under the Unified Rules weighs effective striking/grappling
 * (impact) first, then effective aggressiveness, then fighting-area
 * control. This module turns detected events into a weighted impact score
 * per round and maps the gap to 10-10 / 10-9 / 10-8 / 10-7.
 *
 * The output is an *estimate* to support training feedback - it is not
 * an official judging tool. Every weight lives in MMA_WEIGHTS and can be
 * overridden via `pointOverrides`.
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
  ATHLETES,
  type EventBase,
  type MatchResult,
  opponentOf,
  type Phase,
  type ResolvedScoreOptions,
  type RoundScore,
  type RulesetModule,
  type Scorecard,
} from '../core/types.ts';
import { cleanLabel, isAthlete, isRecord, oneOf, parseBase, parseEnd } from '../core/validate.ts';
import { SUBMISSION_DEPTHS, type SubmissionDepth } from './bjj.ts';

export const MMA_VERSION = 'mma-2026.1';
export const MMA_VARIANTS = ['unified'] as const;
export type MmaVariant = (typeof MMA_VARIANTS)[number];

export const STRIKE_TARGETS = ['head', 'body', 'legs'] as const;
export const STRIKE_KINDS = ['punch', 'kick', 'knee', 'elbow'] as const;
export const STRIKE_POSITIONS = ['distance', 'clinch', 'ground'] as const;
export const CONTROL_POSITIONS = ['clinch', 'ground_top', 'back'] as const;
export const FINISH_METHODS = ['ko', 'tko', 'submission'] as const;

export type StrikeTarget = (typeof STRIKE_TARGETS)[number];
export type StrikePosition = (typeof STRIKE_POSITIONS)[number];

/** `athlete` performs the action; for `point_deduction` it is the penalised athlete. */
export type MmaEvent =
  | (EventBase & {
      type: 'strike';
      athlete: Athlete;
      landed: boolean;
      significant: boolean;
      target: StrikeTarget;
      kind: (typeof STRIKE_KINDS)[number];
      position: StrikePosition;
    })
  | (EventBase & { type: 'knockdown' | 'reversal'; athlete: Athlete })
  | (EventBase & { type: 'takedown'; athlete: Athlete; landed: boolean })
  | (EventBase & { type: 'submission_attempt'; athlete: Athlete; technique: string; depth: SubmissionDepth })
  | (EventBase & { type: 'control'; athlete: Athlete; endT: number; position: (typeof CONTROL_POSITIONS)[number] })
  | (EventBase & { type: 'finish'; athlete: Athlete; method: (typeof FINISH_METHODS)[number]; technique?: string })
  | (EventBase & { type: 'point_deduction'; athlete: Athlete; points: number });

export const MMA_EVENT_TYPES = [
  'strike',
  'knockdown',
  'reversal',
  'takedown',
  'submission_attempt',
  'control',
  'finish',
  'point_deduction',
] as const;

export const MMA_WEIGHTS = {
  sig_head: 1,
  sig_body: 0.75,
  sig_legs: 0.5,
  non_significant: 0.2,
  knockdown: 6,
  takedown: 2,
  reversal: 1,
  sub_shallow: 1,
  sub_deep: 2.5,
  sub_near_finish: 4,
  control_per_30s: 0.5,
  /** Impact difference below which a round is scored 10-10. */
  even_threshold: 0.75,
  ten_eight_ratio: 2.5,
  ten_eight_min_diff: 12,
  ten_seven_ratio: 6,
  ten_seven_min_diff: 30,
} as const;
type Weights = { -readonly [K in keyof typeof MMA_WEIGHTS]: number };

export interface MmaAthleteStats {
  strikesLanded: number;
  strikesThrown: number;
  strikeAccuracy: number | null;
  significantLanded: number;
  significantThrown: number;
  significantAccuracy: number | null;
  significantPerMinute: number;
  landedByTarget: Record<StrikeTarget, number>;
  landedByPosition: Record<StrikePosition, number>;
  knockdowns: number;
  takedownsLanded: number;
  takedownsAttempted: number;
  takedownAccuracy: number | null;
  submissionAttempts: number;
  reversals: number;
  controlMs: number;
}

export type MmaStats = Record<Athlete, MmaAthleteStats>;

function parseEvent(raw: unknown): MmaEvent | null {
  if (!isRecord(raw) || !oneOf(MMA_EVENT_TYPES, raw.type)) return null;
  const base = parseBase(raw);
  if (!base || !isAthlete(raw.athlete)) return null;
  const athlete = raw.athlete;

  switch (raw.type) {
    case 'strike':
      if (!oneOf(STRIKE_TARGETS, raw.target) || !oneOf(STRIKE_KINDS, raw.kind) || !oneOf(STRIKE_POSITIONS, raw.position)) {
        return null;
      }
      if (typeof raw.landed !== 'boolean') return null;
      return {
        ...base,
        type: 'strike',
        athlete,
        landed: raw.landed,
        significant: raw.significant === true,
        target: raw.target,
        kind: raw.kind,
        position: raw.position,
      };
    case 'takedown':
      if (typeof raw.landed !== 'boolean') return null;
      return { ...base, type: 'takedown', athlete, landed: raw.landed };
    case 'submission_attempt':
      if (!oneOf(SUBMISSION_DEPTHS, raw.depth)) return null;
      return { ...base, type: 'submission_attempt', athlete, technique: cleanLabel(raw.technique) ?? 'unknown', depth: raw.depth };
    case 'control': {
      const endT = parseEnd(raw, base.t);
      if (endT === null || !oneOf(CONTROL_POSITIONS, raw.position)) return null;
      return { ...base, type: 'control', athlete, endT, position: raw.position };
    }
    case 'finish': {
      if (!oneOf(FINISH_METHODS, raw.method)) return null;
      const technique = cleanLabel(raw.technique);
      return technique
        ? { ...base, type: 'finish', athlete, method: raw.method, technique }
        : { ...base, type: 'finish', athlete, method: raw.method };
    }
    case 'point_deduction': {
      const points = raw.points;
      if (points !== 1 && points !== 2) return null;
      return { ...base, type: 'point_deduction', athlete, points };
    }
    default:
      return { ...base, type: raw.type, athlete };
  }
}

function resolveWeights(overrides: Record<string, number>): Weights {
  const weights: Weights = { ...MMA_WEIGHTS };
  for (const key of Object.keys(weights) as (keyof Weights)[]) {
    const value = overrides[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) weights[key] = value;
  }
  return weights;
}

function emptyAthleteStats(): MmaAthleteStats {
  return {
    strikesLanded: 0,
    strikesThrown: 0,
    strikeAccuracy: null,
    significantLanded: 0,
    significantThrown: 0,
    significantAccuracy: null,
    significantPerMinute: 0,
    landedByTarget: { head: 0, body: 0, legs: 0 },
    landedByPosition: { distance: 0, clinch: 0, ground: 0 },
    knockdowns: 0,
    takedownsLanded: 0,
    takedownsAttempted: 0,
    takedownAccuracy: null,
    submissionAttempts: 0,
    reversals: 0,
    controlMs: 0,
  };
}

interface ControlInterval extends Interval {
  athlete: Athlete;
  position: (typeof CONTROL_POSITIONS)[number];
}

function controlTimeline(events: readonly MmaEvent[], endAt: number): ControlInterval[] {
  const raw: ControlInterval[] = [];
  for (const event of events) {
    if (event.type !== 'control' || event.t >= endAt) continue;
    raw.push({ start: event.t, end: Math.min(event.endT, endAt), athlete: event.athlete, position: event.position });
  }
  raw.sort((a, b) => a.start - b.start);
  return mergeAdjacent(flattenTimeline(raw), (iv) => `${iv.athlete}:${iv.position}`, 1000);
}

/** Weighted impact of a single event for the athlete who performed it. */
function impactOf(event: MmaEvent, weights: Weights): number {
  switch (event.type) {
    case 'strike':
      if (!event.landed) return 0;
      if (!event.significant) return weights.non_significant;
      return event.target === 'head' ? weights.sig_head : event.target === 'body' ? weights.sig_body : weights.sig_legs;
    case 'knockdown':
      return weights.knockdown;
    case 'takedown':
      return event.landed ? weights.takedown : 0;
    case 'reversal':
      return weights.reversal;
    case 'submission_attempt':
      return event.depth === 'near_finish' ? weights.sub_near_finish : event.depth === 'deep' ? weights.sub_deep : weights.sub_shallow;
    default:
      return 0;
  }
}

function scoreRound(
  round: number,
  window: Interval,
  events: readonly MmaEvent[],
  control: readonly ControlInterval[],
  weights: Weights,
  ledger: ScoreLedger,
): RoundScore {
  const impact: Record<Athlete, number> = { A: 0, B: 0 };
  const knockdowns: Record<Athlete, number> = { A: 0, B: 0 };
  const significant: Record<Athlete, number> = { A: 0, B: 0 };
  const deductions: Record<Athlete, number> = { A: 0, B: 0 };

  for (const event of events) {
    if (event.t < window.start || event.t >= window.end) continue;
    impact[event.athlete] += impactOf(event, weights);
    if (event.type === 'knockdown') knockdowns[event.athlete]++;
    if (event.type === 'strike' && event.landed && event.significant) significant[event.athlete]++;
    if (event.type === 'point_deduction') deductions[event.athlete] += event.points;
  }
  for (const interval of control) {
    const ms = Math.max(0, Math.min(interval.end, window.end) - Math.max(interval.start, window.start));
    impact[interval.athlete] += (ms / 30_000) * weights.control_per_30s;
  }

  const scores: Record<Athlete, number> = { A: 10, B: 10 };
  const diff = Math.abs(impact.A - impact.B);
  const winner = diff < weights.even_threshold ? null : leader(impact.A, impact.B);
  let rationale: string;

  if (!winner) {
    rationale = 'Even round: no clear difference in impact';
  } else {
    const loser = opponentOf(winner);
    const ratio = impact[loser] > 0 ? impact[winner] / impact[loser] : Number.POSITIVE_INFINITY;
    const knockdownMargin = knockdowns[winner] - knockdowns[loser];
    let loserScore = 9;
    if (knockdownMargin >= 3 || (ratio >= weights.ten_seven_ratio && diff >= weights.ten_seven_min_diff)) {
      loserScore = 7;
    } else if (
      knockdownMargin >= 2 ||
      (knockdownMargin >= 1 && diff >= 10) ||
      (ratio >= weights.ten_eight_ratio && diff >= weights.ten_eight_min_diff)
    ) {
      loserScore = 8;
    }
    scores[loser] = loserScore;
    const parts = [`${winner} landed ${significant[winner]}-${significant[loser]} significant strikes`];
    if (knockdowns[winner] > 0) parts.push(`${knockdowns[winner]} knockdown(s)`);
    rationale = `${parts.join(' with ')} (impact ${impact[winner].toFixed(1)} vs ${impact[loser].toFixed(1)})`;
  }

  for (const athlete of ATHLETES) {
    if (deductions[athlete] > 0) {
      scores[athlete] -= deductions[athlete];
      rationale += `; ${athlete} deducted ${deductions[athlete]}`;
    }
    ledger.award(window.end, athlete, { points: scores[athlete] }, `Round ${round}`);
    if (deductions[athlete] > 0) ledger.award(window.end, athlete, { penalties: deductions[athlete] }, `Round ${round} deduction`);
  }

  return { round, start: window.start, end: window.end, scores, rationale };
}

function computeStats(events: readonly MmaEvent[], control: readonly ControlInterval[], endAt: number): MmaStats {
  const stats: MmaStats = { A: emptyAthleteStats(), B: emptyAthleteStats() };
  for (const event of events) {
    if (event.t > endAt) continue;
    const s = stats[event.athlete];
    switch (event.type) {
      case 'strike':
        s.strikesThrown++;
        if (event.significant) s.significantThrown++;
        if (event.landed) {
          s.strikesLanded++;
          s.landedByTarget[event.target]++;
          s.landedByPosition[event.position]++;
          if (event.significant) s.significantLanded++;
        }
        break;
      case 'knockdown':
        s.knockdowns++;
        break;
      case 'takedown':
        s.takedownsAttempted++;
        if (event.landed) s.takedownsLanded++;
        break;
      case 'submission_attempt':
        s.submissionAttempts++;
        break;
      case 'reversal':
        s.reversals++;
        break;
      default:
        break;
    }
  }
  for (const interval of control) stats[interval.athlete].controlMs += durationOf(interval);
  const minutes = endAt / 60_000;
  for (const athlete of ATHLETES) {
    const s = stats[athlete];
    s.strikeAccuracy = s.strikesThrown > 0 ? s.strikesLanded / s.strikesThrown : null;
    s.significantAccuracy = s.significantThrown > 0 ? s.significantLanded / s.significantThrown : null;
    s.takedownAccuracy = s.takedownsAttempted > 0 ? s.takedownsLanded / s.takedownsAttempted : null;
    s.significantPerMinute = minutes > 0 ? s.significantLanded / minutes : 0;
  }
  return stats;
}

function buildPhases(events: readonly MmaEvent[], control: readonly ControlInterval[], endAt: number): Phase[] {
  const phases: Phase[] = [];
  const pushStriking = (start: number, end: number) => {
    if (end - start < 1000) return;
    const landed: Record<Athlete, number> = { A: 0, B: 0 };
    for (const event of events) {
      if (event.type === 'strike' && event.landed && event.significant && event.t >= start && event.t < end) {
        landed[event.athlete]++;
      }
    }
    const busier = Math.abs(landed.A - landed.B) >= 3 ? leader(landed.A, landed.B) : null;
    phases.push({ start, end, kind: 'striking', label: busier ? `Striking (${busier} busier)` : 'Striking exchange', dominant: busier });
  };

  let cursor = 0;
  for (const interval of control) {
    pushStriking(cursor, interval.start);
    const kind = interval.position === 'clinch' ? 'clinch' : 'ground';
    const label = kind === 'clinch' ? `Clinch (${interval.athlete} controlling)` : `Ground (${interval.athlete} on top)`;
    phases.push({ start: interval.start, end: interval.end, kind, label, dominant: interval.athlete });
    cursor = interval.end;
  }
  pushStriking(cursor, endAt);
  return compactPhases(phases);
}

function flurryCandidates(events: readonly MmaEvent[], windowMs = 5000, minLanded = 4): HighlightCandidate[] {
  const candidates: HighlightCandidate[] = [];
  for (const athlete of ATHLETES) {
    const times = events
      .filter((event) => event.type === 'strike' && event.landed && event.athlete === athlete)
      .map((event) => event.t);
    let i = 0;
    while (i < times.length) {
      let j = i;
      while (j + 1 < times.length && (times[j + 1] as number) - (times[i] as number) <= windowMs) j++;
      const count = j - i + 1;
      if (count >= minLanded) {
        candidates.push({ t: times[i] as number, athlete, label: `${athlete} flurry: ${count} strikes landed`, weight: 3 });
        i = j + 1;
      } else {
        i++;
      }
    }
  }
  return candidates;
}

function score(events: MmaEvent[], options: ResolvedScoreOptions<MmaVariant>): Scorecard<MmaStats> {
  const warnings: string[] = [
    'Projected scoring estimates judging criteria from detected events; it is not an official decision.',
  ];
  const weights = resolveWeights(options.pointOverrides);
  const ledger = new ScoreLedger();

  const finish = events.find((event) => event.type === 'finish');
  const endAt = finish ? Math.min(finish.t, options.durationMs) : options.durationMs;
  const control = controlTimeline(events, endAt);
  const inPlay = events.filter((event) => event.t <= endAt);

  const roundMs = Math.max(60_000, options.roundDurationMs);
  const rounds: RoundScore[] = [];
  for (let start = 0, round = 1; start < endAt; start += roundMs, round++) {
    rounds.push(scoreRound(round, { start, end: Math.min(start + roundMs, endAt) }, inPlay, control, weights, ledger));
  }

  const totals = ledger.totals();
  let result: MatchResult;
  if (finish) {
    const how = finish.method === 'submission' ? `submission${finish.technique ? ` (${finish.technique})` : ''}` : finish.method.toUpperCase();
    result = {
      winner: finish.athlete,
      method: finish.method === 'submission' ? 'submission' : 'ko_tko',
      at: finish.t,
      summary: `${finish.athlete} wins by ${how} at ${formatClock(finish.t)}`,
    };
  } else {
    const winner = leader(totals.A.points, totals.B.points);
    result = winner
      ? { winner, method: 'decision', summary: `${winner} wins the projected decision ${totals[winner].points}-${totals[opponentOf(winner)].points}` }
      : { winner: null, method: 'draw', summary: `Projected draw ${totals.A.points}-${totals.B.points}` };
  }

  const highlightCandidates: HighlightCandidate[] = flurryCandidates(inPlay);
  for (const event of inPlay) {
    if (event.type === 'knockdown') highlightCandidates.push({ t: event.t, athlete: event.athlete, label: 'Knockdown', weight: 8 });
    if (event.type === 'takedown' && event.landed) {
      highlightCandidates.push({ t: event.t, athlete: event.athlete, label: 'Takedown', weight: 2 });
    }
    if (event.type === 'submission_attempt') {
      const weight = event.depth === 'near_finish' ? 5 : event.depth === 'deep' ? 3 : 1;
      highlightCandidates.push({ t: event.t, athlete: event.athlete, label: `${event.technique} attempt`, weight });
    }
  }
  if (finish) highlightCandidates.push({ t: finish.t, athlete: finish.athlete, label: result.summary, weight: 10 });

  return {
    discipline: 'mma',
    variant: options.variant,
    rulesetVersion: MMA_VERSION,
    durationMs: options.durationMs,
    result,
    totals,
    rounds,
    scoreLog: ledger.lines,
    stats: computeStats(inPlay, control, endAt),
    phases: buildPhases(inPlay, control, endAt),
    highlights: selectHighlights(highlightCandidates, options.durationMs, options.maxHighlights),
    warnings,
    droppedEvents: 0,
  };
}

export const mmaRuleset: RulesetModule<MmaEvent, MmaStats, MmaVariant> = {
  discipline: 'mma',
  version: MMA_VERSION,
  variants: MMA_VARIANTS,
  defaultVariant: 'unified',
  parseEvent,
  score,
};
