/**
 * Append-only record of everything that changed the score, so every number on
 * a scorecard can be traced back to a timestamped reason.
 */

import type { Athlete, AthleteTotals, ScoreLine } from './types.ts';

export interface Award {
  points?: number;
  advantages?: number;
  penalties?: number;
}

export function emptyTotals(): Record<Athlete, AthleteTotals> {
  return {
    A: { points: 0, advantages: 0, penalties: 0 },
    B: { points: 0, advantages: 0, penalties: 0 },
  };
}

export class ScoreLedger {
  private readonly entries: ScoreLine[] = [];

  award(t: number, athlete: Athlete, award: Award, label: string): void {
    const line: ScoreLine = {
      t,
      athlete,
      points: award.points ?? 0,
      advantages: award.advantages ?? 0,
      penalties: award.penalties ?? 0,
      label,
    };
    if (line.points === 0 && line.advantages === 0 && line.penalties === 0) return;
    this.entries.push(line);
  }

  /** Score log ordered by time (stable for equal timestamps). */
  get lines(): ScoreLine[] {
    return this.entries
      .map((line, index) => ({ line, index }))
      .sort((a, b) => a.line.t - b.line.t || a.index - b.index)
      .map(({ line }) => line);
  }

  /** Totals of all entries with `t <= until`. */
  totals(until = Number.POSITIVE_INFINITY): Record<Athlete, AthleteTotals> {
    const totals = emptyTotals();
    for (const line of this.entries) {
      if (line.t > until) continue;
      totals[line.athlete].points += line.points;
      totals[line.athlete].advantages += line.advantages;
      totals[line.athlete].penalties += line.penalties;
    }
    return totals;
  }

  /** Drops every entry after `t` (used when a finish ends the match). */
  truncateAfter(t: number): void {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i];
      if (entry && entry.t > t) this.entries.splice(i, 1);
    }
  }
}

/** Returns the athlete with the larger value, or null on a tie. */
export function leader(a: number, b: number): Athlete | null {
  if (a > b) return 'A';
  if (b > a) return 'B';
  return null;
}
