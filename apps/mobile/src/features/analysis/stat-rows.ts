/**
 * Turns discipline-specific scorecard stats into uniform head-to-head rows
 * for the dashboard ("A value | label | B value").
 */

import type { BjjStats, MmaStats, Scorecard, WrestlingStats } from '@matiq/rules-engine';

export interface StatRow {
  label: string;
  a: string;
  b: string;
  /** Share of the total for A in [0, 1], used for the comparison bar. */
  share: number;
}

const pct = (value: number | null) => (value === null ? '–' : `${Math.round(value * 100)}%`);
const secs = (ms: number) => `${Math.round(ms / 1000)}s`;

function row(label: string, a: number, b: number, format: (value: number) => string = String): StatRow {
  const total = a + b;
  return { label, a: format(a), b: format(b), share: total > 0 ? a / total : 0.5 };
}

function bjjRows(stats: BjjStats): StatRow[] {
  return [
    row('Top control', stats.topControlMs.A, stats.topControlMs.B, secs),
    row('Guard time', stats.guardMs.A, stats.guardMs.B, secs),
    row('Takedowns', stats.takedowns.A, stats.takedowns.B),
    row('Sweeps', stats.sweeps.A, stats.sweeps.B),
    row('Guard passes', stats.guardPasses.A, stats.guardPasses.B),
    row('Submission attempts', stats.submissionAttempts.A, stats.submissionAttempts.B),
    row('Escapes', stats.escapes.A, stats.escapes.B),
    row('Reversals', stats.reversals.A, stats.reversals.B),
  ];
}

function wrestlingRows(stats: WrestlingStats): StatRow[] {
  const conversion = (athlete: 'A' | 'B') => stats.takedownConversion[athlete];
  return [
    row('Takedowns', stats.takedowns.A, stats.takedowns.B),
    {
      label: 'Shot conversion',
      a: pct(conversion('A')),
      b: pct(conversion('B')),
      share: (conversion('A') ?? 0) + (conversion('B') ?? 0) > 0 ? (conversion('A') ?? 0) / ((conversion('A') ?? 0) + (conversion('B') ?? 0)) : 0.5,
    },
    row('Escapes', stats.escapes.A, stats.escapes.B),
    row('Reversals', stats.reversals.A, stats.reversals.B),
    row('Near falls', stats.nearFalls.A, stats.nearFalls.B),
    row('Exposures', stats.exposures.A, stats.exposures.B),
    row('Riding time', stats.controlMs.A, stats.controlMs.B, secs),
    row('Penalties', stats.penalties.A, stats.penalties.B),
  ];
}

function mmaRows(stats: MmaStats): StatRow[] {
  const { A, B } = stats;
  return [
    row('Significant strikes', A.significantLanded, B.significantLanded),
    { label: 'Significant accuracy', a: pct(A.significantAccuracy), b: pct(B.significantAccuracy), share: 0.5 },
    row('Total strikes', A.strikesLanded, B.strikesLanded),
    row('Head', A.landedByTarget.head, B.landedByTarget.head),
    row('Body', A.landedByTarget.body, B.landedByTarget.body),
    row('Legs', A.landedByTarget.legs, B.landedByTarget.legs),
    row('Knockdowns', A.knockdowns, B.knockdowns),
    row('Takedowns', A.takedownsLanded, B.takedownsLanded),
    { label: 'Takedown accuracy', a: pct(A.takedownAccuracy), b: pct(B.takedownAccuracy), share: 0.5 },
    row('Submission attempts', A.submissionAttempts, B.submissionAttempts),
    row('Control time', A.controlMs, B.controlMs, secs),
  ];
}

export function statRows(scorecard: Scorecard): StatRow[] {
  switch (scorecard.discipline) {
    case 'bjj':
      return bjjRows(scorecard.stats as BjjStats);
    case 'wrestling':
      return wrestlingRows(scorecard.stats as WrestlingStats);
    case 'mma':
      return mmaRows(scorecard.stats as MmaStats);
  }
}
