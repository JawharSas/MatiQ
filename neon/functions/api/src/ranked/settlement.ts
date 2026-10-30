/**
 * Pure helpers for settling ranked matches: validating the stored scorecard,
 * turning stored rating rows into fighter state, and building the payload
 * svc_apply_ranked_result expects.
 */

import {
  type Athlete,
  type Discipline,
  type FighterState,
  isDiscipline,
  newFighterState,
  parseTotals,
  type Scorecard,
  type SettledFighter,
} from '@matiq/rules-engine';

export interface RatingRow {
  rating: number;
  games: number;
  peak_rating: number;
  totals: unknown;
  version: number;
}

export interface FighterPayload {
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  peak: number;
  delta: number;
  outcome: 'win' | 'loss' | 'draw';
  totals: Record<string, number>;
  titles: string[];
}

const METHOD = /^[a-z_]{2,32}$/;

/**
 * Accepts a stored scorecard only if it belongs to this discipline and has
 * the fields settlement reads; anything else is a data error, not a result.
 */
export function parseStoredScorecard(raw: unknown, discipline: Discipline): Scorecard | null {
  if (raw === null || typeof raw !== 'object') return null;
  const card = raw as Partial<Scorecard>;
  if (!isDiscipline(card.discipline) || card.discipline !== discipline) return null;
  const result = card.result;
  if (!result || typeof result !== 'object') return null;
  if (result.winner !== null && result.winner !== 'A' && result.winner !== 'B') return null;
  if (typeof result.method !== 'string' || !METHOD.test(result.method)) return null;
  if (!card.stats || typeof card.stats !== 'object' || !Array.isArray(card.scoreLog)) return null;
  return card as Scorecard;
}

export function fighterState(row: RatingRow | null | undefined): { state: FighterState; version: number } {
  if (!row) return { state: newFighterState(), version: 0 };
  return {
    state: { rating: row.rating, games: row.games, peakRating: row.peak_rating, totals: parseTotals(row.totals) },
    version: row.version,
  };
}

export function outcomeFor(athlete: Athlete, winner: Athlete | null): FighterPayload['outcome'] {
  if (winner === null) return 'draw';
  return winner === athlete ? 'win' : 'loss';
}

export function toPayload(fighter: SettledFighter, outcome: FighterPayload['outcome']): FighterPayload {
  return {
    rating: fighter.rating,
    games: fighter.games,
    wins: fighter.totals.wins,
    losses: fighter.totals.losses,
    draws: fighter.totals.draws,
    streak: fighter.totals.currentStreak,
    peak: fighter.peakRating,
    delta: fighter.change.delta,
    outcome,
    totals: { ...fighter.totals },
    titles: fighter.titles,
  };
}
