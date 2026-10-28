/**
 * Settles one confirmed ranked match: Elo for both fighters, updated career
 * totals and the titles each fighter now qualifies for. Pure, so the server
 * can retry it safely when a concurrent match changed a rating first.
 */

import type { Athlete, ResultMethod, Scorecard } from '../core/types.ts';
import { addMatch, type CareerTotals, emptyCareerTotals, statLine } from './career.ts';
import { type EloChange, RATING, rateMatch } from './elo.ts';
import { unlockedTitles } from './titles.ts';

export interface FighterState {
  rating: number;
  games: number;
  peakRating: number;
  totals: CareerTotals;
}

export interface SettledFighter extends FighterState {
  change: EloChange;
  /** Every title the fighter qualifies for after this match (stored idempotently). */
  titles: string[];
}

export interface SettledMatch {
  winner: Athlete | null;
  method: ResultMethod;
  A: SettledFighter;
  B: SettledFighter;
}

export function newFighterState(): FighterState {
  return { rating: RATING.initial, games: 0, peakRating: RATING.initial, totals: emptyCareerTotals() };
}

export function settleRankedMatch(scorecard: Scorecard, fighters: Record<Athlete, FighterState>): SettledMatch {
  const { winner, method } = scorecard.result;
  const changes = rateMatch(fighters, winner, method);

  const settle = (athlete: Athlete, opponent: Athlete): SettledFighter => {
    const before = fighters[athlete];
    const change = changes[athlete];
    const totals = addMatch(before.totals, statLine(scorecard, athlete), fighters[opponent].rating - before.rating);
    return {
      rating: change.after,
      games: before.games + 1,
      peakRating: Math.max(before.peakRating, change.after),
      totals,
      change,
      titles: unlockedTitles(scorecard.discipline, totals, change.after),
    };
  };

  return { winner, method, A: settle('A', 'B'), B: settle('B', 'A') };
}
