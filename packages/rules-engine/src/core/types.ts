/**
 * Core types shared by every discipline module.
 *
 * Time is always expressed in integer milliseconds from the start of the
 * recording. Athlete "A" is the athlete the user tagged as themselves (or the
 * athlete on the left at the start of the clip when untagged); "B" is the
 * opponent.
 */

export type Discipline = 'bjj' | 'wrestling' | 'mma';
export type Athlete = 'A' | 'B';

export const ATHLETES: readonly Athlete[] = ['A', 'B'];

export function opponentOf(athlete: Athlete): Athlete {
  return athlete === 'A' ? 'B' : 'A';
}

/** Fields every AI-detected (or manually entered) event carries. */
export interface EventBase {
  /** Milliseconds from the start of the recording. */
  t: number;
  /** Model confidence in [0, 1]. Manual events use 1. */
  confidence: number;
  source?: 'ai' | 'manual';
}

/** One line of the scoring log: why a point/advantage/penalty was given. */
export interface ScoreLine {
  t: number;
  athlete: Athlete;
  points: number;
  advantages: number;
  penalties: number;
  label: string;
}

/** A contiguous segment of the match with a dominant theme. */
export interface Phase {
  start: number;
  end: number;
  kind: string;
  label: string;
  /** Athlete who controlled the phase, or null for neutral phases. */
  dominant: Athlete | null;
}

/** A moment worth clipping for the timeline / social highlights. */
export interface Highlight {
  t: number;
  start: number;
  end: number;
  athlete: Athlete | null;
  label: string;
  /** Relative importance; higher is more significant. */
  weight: number;
}

export type ResultMethod =
  | 'submission'
  | 'fall'
  | 'ko_tko'
  | 'technical_superiority'
  | 'points'
  | 'advantages'
  | 'penalties'
  | 'criteria'
  | 'decision'
  | 'disqualification'
  | 'draw';

export interface MatchResult {
  winner: Athlete | null;
  method: ResultMethod;
  /** Time the match ended (finishes / DQ). Undefined when it went the distance. */
  at?: number;
  summary: string;
}

export interface AthleteTotals {
  points: number;
  advantages: number;
  penalties: number;
}

export interface RoundScore {
  round: number;
  start: number;
  end: number;
  /** Projected 10-point-must scores. */
  scores: Record<Athlete, number>;
  rationale: string;
}

export interface Scorecard<Stats = unknown> {
  discipline: Discipline;
  variant: string;
  rulesetVersion: string;
  durationMs: number;
  result: MatchResult;
  totals: Record<Athlete, AthleteTotals>;
  rounds?: RoundScore[];
  scoreLog: ScoreLine[];
  stats: Stats;
  phases: Phase[];
  highlights: Highlight[];
  /** Human-readable caveats (low-confidence data, unverifiable rules, ...). */
  warnings: string[];
  /** Events dropped by validation or the confidence filter. */
  droppedEvents: number;
}

export interface ScoreOptions {
  /** Total length of the analysed recording. */
  durationMs: number;
  /** Ruleset variant, e.g. 'ibjjf' or 'freestyle'. Defaults per module. */
  variant?: string;
  /** Events below this confidence are ignored. Default 0.6. */
  minConfidence?: number;
  /** Round length for round-based disciplines (MMA). Default 5 minutes. */
  roundDurationMs?: number;
  /** Max highlights returned. Default 8. */
  maxHighlights?: number;
  /** Override individual point values of the selected variant. */
  pointOverrides?: Record<string, number>;
}

/** Contract every discipline module implements. */
export interface RulesetModule<Event extends EventBase, Stats, Variant extends string = string> {
  readonly discipline: Discipline;
  readonly version: string;
  readonly variants: readonly Variant[];
  readonly defaultVariant: Variant;
  /** Validates one untrusted event (e.g. AI output). Returns null if invalid. */
  parseEvent(raw: unknown): Event | null;
  /** Scores validated, confidence-filtered, time-sorted events. */
  score(events: Event[], options: ResolvedScoreOptions<Variant>): Scorecard<Stats>;
}

export interface ResolvedScoreOptions<Variant extends string = string> {
  durationMs: number;
  variant: Variant;
  minConfidence: number;
  roundDurationMs: number;
  maxHighlights: number;
  pointOverrides: Record<string, number>;
}
