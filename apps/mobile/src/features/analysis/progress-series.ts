/**
 * Progress over time on the Matches tab: per month, for one sport, your
 * average points per round, average time in control, or win rate. Only
 * analysed rounds count (they have a result). Fighter 1 is you.
 */

import { athleteNumbers } from './athlete-stats.ts';

export type ProgressMetric = 'points' | 'control' | 'win_rate';

export interface ProgressMatch {
  discipline: string;
  recorded_at: string;
  result: { winner: 'A' | 'B' | null } | null;
  totals: { A: { points: number } } | null;
  stats: unknown;
}

export interface SeriesPoint {
  /** YYYY-MM */
  key: string;
  /** Short month name, in the phone's language ("Oct"). */
  label: string;
  /** null for a month without analysed rounds. */
  value: number | null;
  rounds: number;
}

const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/** The last `months` months up to `now`, oldest first. */
export function progressSeries(matches: readonly ProgressMatch[], discipline: string, metric: ProgressMetric, now: Date, months = 6, locale?: string): SeriesPoint[] {
  const slots: SeriesPoint[] = [];
  for (let back = months - 1; back >= 0; back--) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    slots.push({ key: monthKey(date), label: date.toLocaleDateString(locale, { month: 'short' }), value: null, rounds: 0 });
  }
  const sums = new Map<string, number>();
  for (const match of matches) {
    if (match.discipline !== discipline || !match.result) continue;
    const key = monthKey(new Date(match.recorded_at));
    const slot = slots.find((s) => s.key === key);
    if (!slot) continue;
    slot.rounds += 1;
    const add =
      metric === 'points'
        ? (match.totals?.A.points ?? 0)
        : metric === 'control'
          ? athleteNumbers(match.discipline, match.stats).controlMs / 1000
          : match.result.winner === 'A'
            ? 1
            : 0;
    sums.set(key, (sums.get(key) ?? 0) + add);
  }
  for (const slot of slots) {
    if (slot.rounds === 0) continue;
    const average = (sums.get(slot.key) ?? 0) / slot.rounds;
    slot.value = metric === 'win_rate' ? Math.round(average * 100) : Math.round(average * 10) / 10;
  }
  return slots;
}

/** How a value reads: "12.5", "48s", "67%". */
export function formatProgress(metric: ProgressMetric, value: number): string {
  if (metric === 'win_rate') return `${value}%`;
  if (metric === 'control') return value >= 60 ? `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, '0')}` : `${Math.round(value)}s`;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** The sport you have most analysed rounds in (BJJ when there are none). */
export function mainDiscipline(matches: readonly ProgressMatch[]): 'bjj' | 'wrestling' | 'mma' {
  const counts = { bjj: 0, wrestling: 0, mma: 0 } as Record<string, number>;
  for (const match of matches) if (match.result && match.discipline in counts) counts[match.discipline]! += 1;
  return (['bjj', 'wrestling', 'mma'] as const).reduce((best, sport) => (counts[sport]! > counts[best]! ? sport : best), 'bjj');
}

/** One sentence comparing the last two months that have rounds, for the summary under the chart. */
export function trendSentence(series: readonly SeriesPoint[], metric: ProgressMetric): string | null {
  const filled = series.filter((point) => point.value !== null);
  if (filled.length < 2) return null;
  const last = filled[filled.length - 1]!;
  const before = filled[filled.length - 2]!;
  const diff = last.value! - before.value!;
  if (Math.abs(diff) < (metric === 'win_rate' ? 1 : 0.5)) return `About the same as ${before.label}.`;
  return `${diff > 0 ? 'Up' : 'Down'} from ${formatProgress(metric, before.value!)} in ${before.label}.`;
}
