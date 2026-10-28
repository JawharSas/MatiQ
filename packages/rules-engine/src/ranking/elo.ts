/**
 * Elo rating for ranked matches between two MatIQ users.
 *
 *   expected(A) = 1 / (1 + 10^((R_B - R_A) / 400))
 *   delta(A)    = round(K(A) * finish multiplier * (score(A) - expected(A)))
 *
 * K is 40 while a fighter has fewer than 10 ranked matches (fast placement),
 * 24 afterwards and 16 from the Grandmaster threshold up (a stable top of the
 * ladder). Finishes (submission, KO/TKO, fall) count 25% more, technical
 * superiority 15% more; the multiplier applies to both fighters, so a
 * finish moves both ratings further. A decisive result always moves each
 * rating by at least one point, and ratings never drop below the floor.
 */

import type { Athlete, ResultMethod } from '../core/types.ts';

export const RATING = {
  initial: 1000,
  floor: 100,
  /** Matches with the higher, placement K-factor. */
  provisionalGames: 10,
  /** Rating from which the low K-factor applies (Grandmaster tier). */
  eliteRating: 1500,
} as const;

export const K_FACTOR = { provisional: 40, standard: 24, elite: 16 } as const;

export interface RatedFighter {
  rating: number;
  /** Ranked matches played before this one. */
  games: number;
}

export interface EloChange {
  before: number;
  after: number;
  delta: number;
  /** Expected score in [0, 1] before the match. */
  expected: number;
}

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400));
}

export function kFactor(fighter: RatedFighter): number {
  if (fighter.games < RATING.provisionalGames) return K_FACTOR.provisional;
  if (fighter.rating >= RATING.eliteRating) return K_FACTOR.elite;
  return K_FACTOR.standard;
}

export function finishMultiplier(method: ResultMethod): number {
  switch (method) {
    case 'submission':
    case 'ko_tko':
    case 'fall':
      return 1.25;
    case 'technical_superiority':
      return 1.15;
    default:
      return 1;
  }
}

function change(fighter: RatedFighter, opponent: RatedFighter, score: 0 | 0.5 | 1, multiplier: number): EloChange {
  const expected = expectedScore(fighter.rating, opponent.rating);
  let delta = Math.round(kFactor(fighter) * multiplier * (score - expected));
  if (score === 1) delta = Math.max(1, delta);
  if (score === 0) delta = Math.min(-1, delta);
  const after = Math.max(RATING.floor, fighter.rating + delta);
  return { before: fighter.rating, after, delta: after - fighter.rating, expected };
}

/** Rating changes for both fighters; `winner` null means a draw. */
export function rateMatch(
  fighters: Record<Athlete, RatedFighter>,
  winner: Athlete | null,
  method: ResultMethod,
): Record<Athlete, EloChange> {
  const multiplier = winner === null ? 1 : finishMultiplier(method);
  const scoreOf = (athlete: Athlete): 0 | 0.5 | 1 => (winner === null ? 0.5 : winner === athlete ? 1 : 0);
  return {
    A: change(fighters.A, fighters.B, scoreOf('A'), multiplier),
    B: change(fighters.B, fighters.A, scoreOf('B'), multiplier),
  };
}

/** Projected change for a win / draw / loss, e.g. for matchmaking previews. */
export function previewMatch(me: RatedFighter, opponent: RatedFighter): { win: number; draw: number; loss: number } {
  const fighters = { A: me, B: opponent };
  return {
    win: rateMatch(fighters, 'A', 'points').A.delta,
    draw: rateMatch(fighters, null, 'draw').A.delta,
    loss: rateMatch(fighters, 'B', 'points').A.delta,
  };
}
