/**
 * Brazilian Jiu-Jitsu ruleset.
 *
 * Variants:
 *  - `ibjjf`: IBJJF-style points (takedown/sweep/knee-on-belly 2, guard pass 3,
 *    mount/back control 4), 3-second stabilisation, advantages and the
 *    penalty progression (2nd = opponent advantage, 3rd = opponent 2 points,
 *    4th = disqualification).
 *  - `ibjjf_reversals`: IBJJF plus 2 points for a stabilised reversal from a
 *    bottom position other than guard (bottom of mount, side control, back
 *    or turtle). IBJJF itself only scores reversals that start in guard (as
 *    sweeps); this house-rules variant is common in local and in-gym events.
 *  - `submission_only`: only submissions decide the match.
 *
 * Point values and timings are data (see IBJJF_POINTS / BJJ_TIMING) and can
 * be overridden per call because federations revise them between seasons.
 */

import { leader, ScoreLedger } from '../core/ledger.ts';
import {
  compactPhases,
  coveredMs,
  durationOf,
  flattenTimeline,
  formatClock,
  mergeAdjacent,
  overlap,
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
  type RulesetModule,
  type Scorecard,
} from '../core/types.ts';
import { cleanLabel, isAthlete, isRecord, oneOf, parseBase, parseEnd } from '../core/validate.ts';

export const BJJ_VERSION = 'bjj-2026.1';
export const BJJ_VARIANTS = ['ibjjf', 'ibjjf_reversals', 'submission_only'] as const;
export type BjjVariant = (typeof BJJ_VARIANTS)[number];

export const BJJ_POSITIONS = [
  'standing',
  'scramble',
  'closed_guard',
  'open_guard',
  'half_guard',
  'turtle',
  'side_control',
  'north_south',
  'knee_on_belly',
  'mount',
  'back_control',
] as const;
export type BjjPosition = (typeof BJJ_POSITIONS)[number];

/**
 * Who `athlete` refers to on a position event:
 *  - top positions: the athlete in control (on top / on the back)
 *  - guard positions and turtle: the athlete on the bottom
 *  - neutral positions: nobody (null)
 */
export const TOP_POSITIONS: ReadonlySet<BjjPosition> = new Set([
  'side_control',
  'north_south',
  'knee_on_belly',
  'mount',
  'back_control',
]);
export const GUARD_POSITIONS: ReadonlySet<BjjPosition> = new Set(['closed_guard', 'open_guard', 'half_guard']);
export const NEUTRAL_POSITIONS: ReadonlySet<BjjPosition> = new Set(['standing', 'scramble']);

export const SUBMISSION_DEPTHS = ['shallow', 'deep', 'near_finish'] as const;
export type SubmissionDepth = (typeof SUBMISSION_DEPTHS)[number];

const ACTION_TYPES = ['takedown', 'sweep', 'guard_pass', 'reversal', 'escape'] as const;
type ActionType = (typeof ACTION_TYPES)[number];

export type BjjEvent =
  | (EventBase & { type: 'position'; position: BjjPosition; endT: number; athlete: Athlete | null })
  | (EventBase & { type: ActionType; athlete: Athlete })
  | (EventBase & { type: 'submission_attempt'; athlete: Athlete; technique: string; depth: SubmissionDepth })
  | (EventBase & { type: 'submission'; athlete: Athlete; technique: string })
  | (EventBase & { type: 'advantage'; athlete: Athlete; reason?: string })
  | (EventBase & { type: 'penalty'; athlete: Athlete; reason?: string });

export const BJJ_EVENT_TYPES = [
  'position',
  ...ACTION_TYPES,
  'submission_attempt',
  'submission',
  'advantage',
  'penalty',
] as const;

export const IBJJF_POINTS = {
  takedown: 2,
  sweep: 2,
  knee_on_belly: 2,
  guard_pass: 3,
  mount: 4,
  back_control: 4,
} as const;
type PointKey = keyof typeof IBJJF_POINTS;

/** Reversal value for the `ibjjf_reversals` variant (override key `reversal`). */
export const BJJ_REVERSAL_POINTS = 2;

export const BJJ_TIMING = {
  /** A position must be held this long to score. */
  stabilizationMs: 3000,
  /** Reaching (but not stabilising) a scoring position for this long earns an advantage. */
  advantageMinHoldMs: 1000,
  /** Same-position detections closer than this are merged. */
  mergeGapMs: 1000,
  /** Slack after an action in which the stabilised position may start. */
  actionSlackMs: 2000,
} as const;

/** Penalty number (1-based) → consequence, per IBJJF progression. */
const PENALTY_PROGRESSION: Record<number, 'none' | 'advantage' | 'points' | 'dq'> = {
  1: 'none',
  2: 'advantage',
  3: 'points',
  4: 'dq',
};

export interface BjjStats {
  /** Analysed time covered by position data. */
  analysedMs: number;
  neutralMs: number;
  /** Time each athlete held each position (see position semantics above). */
  positionMs: Record<Athlete, Partial<Record<BjjPosition, number>>>;
  /** Time in dominant top positions (side control, N/S, knee on belly, mount, back). */
  topControlMs: Record<Athlete, number>;
  /** Time spent playing guard (bottom of closed/open/half guard). */
  guardMs: Record<Athlete, number>;
  /** topControlMs / analysedMs. */
  controlShare: Record<Athlete, number>;
  takedowns: Record<Athlete, number>;
  sweeps: Record<Athlete, number>;
  guardPasses: Record<Athlete, number>;
  reversals: Record<Athlete, number>;
  escapes: Record<Athlete, number>;
  submissionAttempts: Record<Athlete, number>;
  submissionAttemptsByTechnique: Record<Athlete, Record<string, number>>;
}

interface PositionInterval extends Interval {
  position: BjjPosition;
  holder: Athlete | null;
}

const POSITION_LABELS: Record<BjjPosition, string> = {
  standing: 'Standing',
  scramble: 'Scramble',
  closed_guard: 'Closed guard',
  open_guard: 'Open guard',
  half_guard: 'Half guard',
  turtle: 'Turtle',
  side_control: 'Side control',
  north_south: 'North-south',
  knee_on_belly: 'Knee on belly',
  mount: 'Mount',
  back_control: 'Back control',
};

const ACTION_LABELS: Record<ActionType, string> = {
  takedown: 'Takedown',
  sweep: 'Sweep',
  guard_pass: 'Guard pass',
  reversal: 'Reversal',
  escape: 'Escape',
};

function parseEvent(raw: unknown): BjjEvent | null {
  if (!isRecord(raw) || !oneOf(BJJ_EVENT_TYPES, raw.type)) return null;
  const base = parseBase(raw);
  if (!base) return null;

  if (raw.type === 'position') {
    if (!oneOf(BJJ_POSITIONS, raw.position)) return null;
    const endT = parseEnd(raw, base.t);
    if (endT === null) return null;
    const neutral = NEUTRAL_POSITIONS.has(raw.position);
    if (!neutral && !isAthlete(raw.athlete)) return null;
    return {
      ...base,
      type: 'position',
      position: raw.position,
      endT,
      athlete: neutral ? null : (raw.athlete as Athlete),
    };
  }

  if (!isAthlete(raw.athlete)) return null;
  const athlete = raw.athlete;

  switch (raw.type) {
    case 'submission_attempt': {
      if (!oneOf(SUBMISSION_DEPTHS, raw.depth)) return null;
      return {
        ...base,
        type: 'submission_attempt',
        athlete,
        technique: cleanLabel(raw.technique) ?? 'unknown',
        depth: raw.depth,
      };
    }
    case 'submission':
      return { ...base, type: 'submission', athlete, technique: cleanLabel(raw.technique) ?? 'unknown' };
    case 'advantage':
    case 'penalty': {
      const reason = cleanLabel(raw.reason);
      return reason ? { ...base, type: raw.type, athlete, reason } : { ...base, type: raw.type, athlete };
    }
    default:
      return { ...base, type: raw.type, athlete };
  }
}

function resolvePoints(overrides: Record<string, number>): Record<PointKey | 'reversal', number> {
  const points: Record<PointKey | 'reversal', number> = { ...IBJJF_POINTS, reversal: BJJ_REVERSAL_POINTS };
  for (const key of Object.keys(points) as (PointKey | 'reversal')[]) {
    const value = overrides[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) points[key] = value;
  }
  return points;
}

function buildPositionTimeline(events: readonly BjjEvent[], endAt: number): PositionInterval[] {
  const raw: PositionInterval[] = [];
  for (const event of events) {
    if (event.type !== 'position' || event.t >= endAt) continue;
    raw.push({ start: event.t, end: Math.min(event.endT, endAt), position: event.position, holder: event.athlete });
  }
  raw.sort((a, b) => a.start - b.start);
  const flattened = flattenTimeline(raw);
  return mergeAdjacent(flattened, (iv) => `${iv.position}:${iv.holder ?? '-'}`, BJJ_TIMING.mergeGapMs);
}

/**
 * Whether `interval` shows `actor` in a position that "completes" the given
 * action (e.g. after a takedown the actor must be on top, including inside
 * the opponent's guard).
 */
function completesAction(type: 'takedown' | 'sweep' | 'guard_pass' | 'reversal', actor: Athlete, interval: PositionInterval): boolean {
  const opponent = opponentOf(actor);
  if (TOP_POSITIONS.has(interval.position)) return interval.holder === actor;
  if (type === 'guard_pass') return interval.position === 'turtle' && interval.holder === opponent;
  if (GUARD_POSITIONS.has(interval.position) || interval.position === 'turtle') return interval.holder === opponent;
  return false;
}

function perAthlete<T>(make: () => T): Record<Athlete, T> {
  return { A: make(), B: make() };
}

function computeStats(events: readonly BjjEvent[], positions: readonly PositionInterval[], endAt: number): BjjStats {
  const stats: BjjStats = {
    analysedMs: 0,
    neutralMs: 0,
    positionMs: perAthlete(() => ({})),
    topControlMs: perAthlete(() => 0),
    guardMs: perAthlete(() => 0),
    controlShare: perAthlete(() => 0),
    takedowns: perAthlete(() => 0),
    sweeps: perAthlete(() => 0),
    guardPasses: perAthlete(() => 0),
    reversals: perAthlete(() => 0),
    escapes: perAthlete(() => 0),
    submissionAttempts: perAthlete(() => 0),
    submissionAttemptsByTechnique: perAthlete(() => ({})),
  };

  for (const interval of positions) {
    const ms = durationOf(interval);
    stats.analysedMs += ms;
    if (interval.holder === null) {
      stats.neutralMs += ms;
      continue;
    }
    const held = stats.positionMs[interval.holder];
    held[interval.position] = (held[interval.position] ?? 0) + ms;
    if (TOP_POSITIONS.has(interval.position)) stats.topControlMs[interval.holder] += ms;
    if (GUARD_POSITIONS.has(interval.position)) stats.guardMs[interval.holder] += ms;
  }

  for (const athlete of ATHLETES) {
    stats.controlShare[athlete] = stats.analysedMs > 0 ? stats.topControlMs[athlete] / stats.analysedMs : 0;
  }

  for (const event of events) {
    if (event.t > endAt) continue;
    switch (event.type) {
      case 'takedown':
        stats.takedowns[event.athlete]++;
        break;
      case 'sweep':
        stats.sweeps[event.athlete]++;
        break;
      case 'guard_pass':
        stats.guardPasses[event.athlete]++;
        break;
      case 'reversal':
        stats.reversals[event.athlete]++;
        break;
      case 'escape':
        stats.escapes[event.athlete]++;
        break;
      case 'submission_attempt':
      case 'submission': {
        stats.submissionAttempts[event.athlete]++;
        const byTechnique = stats.submissionAttemptsByTechnique[event.athlete];
        byTechnique[event.technique] = (byTechnique[event.technique] ?? 0) + 1;
        break;
      }
      default:
        break;
    }
  }
  return stats;
}

function buildPhases(positions: readonly PositionInterval[]): Phase[] {
  const phases: Phase[] = positions.map((interval) => {
    if (interval.position === 'standing') {
      return { start: interval.start, end: interval.end, kind: 'standing', label: 'Standing exchange', dominant: null };
    }
    if (interval.position === 'scramble' || interval.holder === null) {
      return { start: interval.start, end: interval.end, kind: 'scramble', label: 'Scramble', dominant: null };
    }
    if (GUARD_POSITIONS.has(interval.position)) {
      const top = opponentOf(interval.holder);
      return { start: interval.start, end: interval.end, kind: 'guard', label: `Guard play (${top} on top)`, dominant: top };
    }
    const controller = interval.position === 'turtle' ? opponentOf(interval.holder) : interval.holder;
    return { start: interval.start, end: interval.end, kind: 'top_control', label: `${controller} in control`, dominant: controller };
  });
  return compactPhases(phases);
}

function score(events: BjjEvent[], options: ResolvedScoreOptions<BjjVariant>): Scorecard<BjjStats> {
  const warnings: string[] = [];
  const ledger = new ScoreLedger();
  const scoresPoints = options.variant !== 'submission_only';
  const scoresReversals = options.variant === 'ibjjf_reversals';
  const points = resolvePoints(options.pointOverrides);
  // A reversal reported next to a sweep by the same athlete is the same action.
  const sweepTimes = events.flatMap((event) => (event.type === 'sweep' ? [{ t: event.t, athlete: event.athlete }] : []));

  // 1. Terminal events: the first submission, or a 4th-penalty disqualification.
  const submission = events.find((event) => event.type === 'submission');
  const penaltyCount: Record<Athlete, number> = { A: 0, B: 0 };
  let disqualification: { athlete: Athlete; t: number } | null = null;
  for (const event of events) {
    if (event.type !== 'penalty') continue;
    penaltyCount[event.athlete]++;
    if (PENALTY_PROGRESSION[penaltyCount[event.athlete]] === 'dq') {
      disqualification = { athlete: event.athlete, t: event.t };
      break;
    }
  }
  const terminalT = Math.min(submission?.t ?? Number.POSITIVE_INFINITY, disqualification?.t ?? Number.POSITIVE_INFINITY);
  const endAt = Math.min(options.durationMs, terminalT);
  const ignoredAfterFinish = events.filter((event) => event.t > endAt && event.type !== 'position').length;
  if (Number.isFinite(terminalT) && ignoredAfterFinish > 0) {
    warnings.push(`${ignoredAfterFinish} event(s) after the match ended were ignored.`);
  }

  const positions = buildPositionTimeline(events, endAt);
  const highlightCandidates: HighlightCandidate[] = [];

  // 2. Points for stabilised positions.
  if (scoresPoints) {
    for (const interval of positions) {
      if (interval.holder === null) continue;
      const key = interval.position as PointKey;
      if (!(key in points) || key === 'takedown' || key === 'sweep' || key === 'guard_pass') continue;
      const held = durationOf(interval);
      const label = POSITION_LABELS[interval.position];
      if (held >= BJJ_TIMING.stabilizationMs) {
        ledger.award(interval.start + BJJ_TIMING.stabilizationMs, interval.holder, { points: points[key] }, `${label} (+${points[key]})`);
      } else if (held >= BJJ_TIMING.advantageMinHoldMs) {
        ledger.award(interval.start, interval.holder, { advantages: 1 }, `${label} not stabilised (advantage)`);
      }
    }
  }

  // 3. Actions, submission attempts, advantages and penalties in time order.
  let unverifiableActions = 0;
  const penaltiesSeen: Record<Athlete, number> = { A: 0, B: 0 };
  for (const event of events) {
    if (event.t > endAt) break;
    switch (event.type) {
      case 'takedown':
      case 'sweep':
      case 'guard_pass':
      case 'reversal': {
        if (!scoresPoints) break;
        if (event.type === 'reversal') {
          if (!scoresReversals) break;
          const { t, athlete } = event;
          if (sweepTimes.some((sweep) => sweep.athlete === athlete && Math.abs(sweep.t - t) <= BJJ_TIMING.actionSlackMs)) break;
        }
        const window: Interval = {
          start: event.t,
          end: event.t + BJJ_TIMING.stabilizationMs + BJJ_TIMING.actionSlackMs,
        };
        const nearby = positions.filter((interval) => overlap(interval, window) > 0);
        const label = ACTION_LABELS[event.type];
        if (nearby.length === 0) {
          unverifiableActions++;
          ledger.award(event.t, event.athlete, { points: points[event.type] }, `${label} (+${points[event.type]})`);
          break;
        }
        const { type, athlete } = event;
        const stabilised = coveredMs(nearby, window, (interval) => completesAction(type, athlete, interval));
        if (stabilised >= BJJ_TIMING.stabilizationMs) {
          ledger.award(event.t, event.athlete, { points: points[event.type] }, `${label} (+${points[event.type]})`);
        } else {
          ledger.award(event.t, event.athlete, { advantages: 1 }, `${label} not stabilised (advantage)`);
        }
        break;
      }
      case 'submission_attempt': {
        if (scoresPoints && event.depth !== 'shallow') {
          ledger.award(event.t, event.athlete, { advantages: 1 }, `Submission attempt: ${event.technique} (advantage)`);
        }
        const weight = event.depth === 'near_finish' ? 5 : event.depth === 'deep' ? 3 : 1;
        highlightCandidates.push({ t: event.t, athlete: event.athlete, label: `${event.technique} attempt`, weight });
        break;
      }
      case 'advantage':
        if (scoresPoints) ledger.award(event.t, event.athlete, { advantages: 1 }, event.reason ? `Advantage: ${event.reason}` : 'Advantage');
        break;
      case 'penalty': {
        penaltiesSeen[event.athlete]++;
        const nth = penaltiesSeen[event.athlete];
        const reason = event.reason ? `: ${event.reason}` : '';
        ledger.award(event.t, event.athlete, { penalties: 1 }, `Penalty ${nth}${reason}`);
        const consequence = PENALTY_PROGRESSION[nth];
        const opponent = opponentOf(event.athlete);
        if (scoresPoints && consequence === 'advantage') {
          ledger.award(event.t, opponent, { advantages: 1 }, `Advantage from opponent penalty ${nth}`);
        } else if (scoresPoints && consequence === 'points') {
          ledger.award(event.t, opponent, { points: 2 }, `2 points from opponent penalty ${nth}`);
        }
        break;
      }
      default:
        break;
    }
  }
  if (unverifiableActions > 0) {
    warnings.push(
      `${unverifiableActions} scoring action(s) had no position data to verify the 3-second stabilisation; points were awarded on the detection alone.`,
    );
  }

  // 4. Result.
  const totals = ledger.totals(endAt);
  let result: MatchResult;
  if (submission && submission.t <= endAt && submission.t === terminalT) {
    result = {
      winner: submission.athlete,
      method: 'submission',
      at: submission.t,
      summary: `${submission.athlete} wins by submission (${submission.technique}) at ${formatClock(submission.t)}`,
    };
    highlightCandidates.push({ t: submission.t, athlete: submission.athlete, label: `Submission: ${submission.technique}`, weight: 10 });
  } else if (disqualification && disqualification.t === terminalT) {
    const winner = opponentOf(disqualification.athlete);
    result = {
      winner,
      method: 'disqualification',
      at: disqualification.t,
      summary: `${winner} wins by disqualification (4th penalty) at ${formatClock(disqualification.t)}`,
    };
  } else if (!scoresPoints) {
    result = { winner: null, method: 'draw', summary: 'No submission: draw under submission-only rules' };
  } else {
    result = decideOnPoints(totals.A, totals.B);
  }

  for (const line of ledger.lines) {
    highlightCandidates.push({ t: line.t, athlete: line.athlete, label: line.label, weight: line.points * 2 + line.advantages });
  }

  return {
    discipline: 'bjj',
    variant: options.variant,
    rulesetVersion: BJJ_VERSION,
    durationMs: options.durationMs,
    result,
    totals,
    scoreLog: ledger.lines.filter((line) => line.t <= endAt),
    stats: computeStats(events, positions, endAt),
    phases: buildPhases(positions),
    highlights: selectHighlights(highlightCandidates, options.durationMs, options.maxHighlights),
    warnings,
    droppedEvents: 0,
  };
}

function decideOnPoints(a: { points: number; advantages: number; penalties: number }, b: typeof a): MatchResult {
  const byPoints = leader(a.points, b.points);
  if (byPoints) {
    return { winner: byPoints, method: 'points', summary: `${byPoints} wins on points (${a.points}-${b.points})` };
  }
  const byAdvantages = leader(a.advantages, b.advantages);
  if (byAdvantages) {
    return {
      winner: byAdvantages,
      method: 'advantages',
      summary: `${byAdvantages} wins on advantages (${a.advantages}-${b.advantages}) after ${a.points}-${b.points} on points`,
    };
  }
  // Fewer penalties wins.
  const byPenalties = leader(b.penalties, a.penalties);
  if (byPenalties) {
    return { winner: byPenalties, method: 'penalties', summary: `${byPenalties} wins on fewer penalties` };
  }
  return { winner: null, method: 'draw', summary: `Draw (${a.points}-${b.points}); a referee decision would settle it` };
}

export const bjjRuleset: RulesetModule<BjjEvent, BjjStats, BjjVariant> = {
  discipline: 'bjj',
  version: BJJ_VERSION,
  variants: BJJ_VARIANTS,
  defaultVariant: 'ibjjf',
  parseEvent,
  score,
};
