/**
 * Per-fighter stat lines from a scorecard, and career totals per discipline.
 *
 * Ranked matches always have Fighter 1 = athlete A (the recording user) and
 * Fighter 2 = athlete B (the opponent who confirms), so a scorecard yields
 * one line per fighter. Totals are stored as JSON next to the rating and
 * re-read with `parseTotals`, which tolerates missing (newer) counters.
 */

import type { BjjStats } from '../disciplines/bjj.ts';
import type { MmaStats } from '../disciplines/mma.ts';
import type { WrestlingStats } from '../disciplines/wrestling.ts';
import { type Athlete, opponentOf, type ResultMethod, type Scorecard } from '../core/types.ts';

export type Outcome = 'win' | 'loss' | 'draw';

const COUNTERS = [
  'takedowns',
  'sweeps',
  'reversals',
  'guardPasses',
  'backTakes',
  'escapes',
  'submissionAttempts',
  'nearFalls',
  'controlMs',
  'significantLanded',
  'significantAbsorbed',
  'knockdownsScored',
  'knockdownsAbsorbed',
] as const;
type Counter = (typeof COUNTERS)[number];

export type FighterStatLine = Record<Counter, number> & { outcome: Outcome; method: ResultMethod };

const RECORD_FIELDS = [
  'matches',
  'wins',
  'losses',
  'draws',
  'submissionWins',
  'koWins',
  'fallWins',
  'techFallWins',
  'finishLosses',
  'koLosses',
  'currentStreak',
  'bestStreak',
  'biggestUpset',
] as const;
type RecordField = (typeof RECORD_FIELDS)[number];

export type CareerTotals = Record<RecordField | Counter, number>;

export function emptyCareerTotals(): CareerTotals {
  return Object.fromEntries([...RECORD_FIELDS, ...COUNTERS].map((key) => [key, 0])) as CareerTotals;
}

/** Reads stored totals; unknown keys are dropped, bad or missing values become 0. */
export function parseTotals(raw: unknown): CareerTotals {
  const totals = emptyCareerTotals();
  if (raw === null || typeof raw !== 'object') return totals;
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(totals) as (keyof CareerTotals)[]) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) totals[key] = Math.round(value);
  }
  return totals;
}

function bjjLine(stats: BjjStats, scorecard: Scorecard, athlete: Athlete): Record<Counter, number> {
  const backTakes = scorecard.scoreLog.filter((line) => line.athlete === athlete && line.points > 0 && line.label.startsWith('Back control')).length;
  return {
    takedowns: stats.takedowns[athlete],
    sweeps: stats.sweeps[athlete],
    reversals: stats.reversals[athlete],
    guardPasses: stats.guardPasses[athlete],
    backTakes,
    escapes: stats.escapes[athlete],
    submissionAttempts: stats.submissionAttempts[athlete],
    nearFalls: 0,
    controlMs: stats.topControlMs[athlete],
    significantLanded: 0,
    significantAbsorbed: 0,
    knockdownsScored: 0,
    knockdownsAbsorbed: 0,
  };
}

function wrestlingLine(stats: WrestlingStats, athlete: Athlete): Record<Counter, number> {
  return {
    takedowns: stats.takedowns[athlete],
    sweeps: 0,
    reversals: stats.reversals[athlete],
    guardPasses: 0,
    backTakes: 0,
    escapes: stats.escapes[athlete],
    submissionAttempts: 0,
    nearFalls: stats.nearFalls[athlete],
    controlMs: stats.controlMs[athlete],
    significantLanded: 0,
    significantAbsorbed: 0,
    knockdownsScored: 0,
    knockdownsAbsorbed: 0,
  };
}

function mmaLine(stats: MmaStats, athlete: Athlete): Record<Counter, number> {
  const mine = stats[athlete];
  const theirs = stats[opponentOf(athlete)];
  return {
    takedowns: mine.takedownsLanded,
    sweeps: 0,
    reversals: mine.reversals,
    guardPasses: 0,
    backTakes: 0,
    escapes: 0,
    submissionAttempts: mine.submissionAttempts,
    nearFalls: 0,
    controlMs: mine.controlMs,
    significantLanded: mine.significantLanded,
    significantAbsorbed: theirs.significantLanded,
    knockdownsScored: mine.knockdowns,
    knockdownsAbsorbed: theirs.knockdowns,
  };
}

export function statLine(scorecard: Scorecard, athlete: Athlete): FighterStatLine {
  const { winner, method } = scorecard.result;
  const outcome: Outcome = winner === null ? 'draw' : winner === athlete ? 'win' : 'loss';
  let counters: Record<Counter, number>;
  switch (scorecard.discipline) {
    case 'bjj':
      counters = bjjLine(scorecard.stats as BjjStats, scorecard, athlete);
      break;
    case 'wrestling':
      counters = wrestlingLine(scorecard.stats as WrestlingStats, athlete);
      break;
    case 'mma':
      counters = mmaLine(scorecard.stats as MmaStats, athlete);
      break;
  }
  return { ...counters, outcome, method };
}

const FINISHES: ReadonlySet<ResultMethod> = new Set(['submission', 'ko_tko', 'fall']);

/**
 * Adds one match to a fighter's totals. `ratingGap` is the opponent's rating
 * minus the fighter's, both before the match (positive for an underdog).
 */
export function addMatch(totals: CareerTotals, line: FighterStatLine, ratingGap: number): CareerTotals {
  const next = { ...totals };
  for (const counter of COUNTERS) next[counter] += Math.max(0, Math.round(line[counter]));
  next.matches++;
  if (line.outcome === 'win') {
    next.wins++;
    next.currentStreak++;
    next.bestStreak = Math.max(next.bestStreak, next.currentStreak);
    next.biggestUpset = Math.max(next.biggestUpset, Math.round(ratingGap));
    if (line.method === 'submission') next.submissionWins++;
    if (line.method === 'ko_tko') next.koWins++;
    if (line.method === 'fall') next.fallWins++;
    if (line.method === 'technical_superiority') next.techFallWins++;
  } else {
    next.currentStreak = 0;
    if (line.outcome === 'loss') {
      next.losses++;
      if (FINISHES.has(line.method)) next.finishLosses++;
      if (line.method === 'ko_tko') next.koLosses++;
    } else {
      next.draws++;
    }
  }
  return next;
}
