/**
 * Your record from your own matches. Fighter 1 is "you" in the match setup,
 * so a win for athlete A counts as yours.
 */

export type Outcome = 'won' | 'lost' | 'draw';

export interface MatchResultSummary {
  winner: 'A' | 'B' | null;
  method: string;
}

export interface RecordSummary {
  total: number;
  analysed: number;
  wins: number;
  losses: number;
  draws: number;
}

export function outcomeOf(result: MatchResultSummary | null | undefined): Outcome | null {
  if (!result) return null;
  return result.winner === 'A' ? 'won' : result.winner === 'B' ? 'lost' : 'draw';
}

export function summarize(matches: readonly { result: MatchResultSummary | null }[]): RecordSummary {
  const summary: RecordSummary = { total: matches.length, analysed: 0, wins: 0, losses: 0, draws: 0 };
  for (const match of matches) {
    const outcome = outcomeOf(match.result);
    if (!outcome) continue;
    summary.analysed++;
    if (outcome === 'won') summary.wins++;
    else if (outcome === 'lost') summary.losses++;
    else summary.draws++;
  }
  return summary;
}

/** "4-1-0": wins, losses, draws. */
export function recordText(summary: RecordSummary): string {
  return `${summary.wins}-${summary.losses}-${summary.draws}`;
}

/** Groups items by month of `date`, newest month first, keeping their order. */
export function byMonth<T>(items: readonly T[], date: (item: T) => string, locale?: string): { month: string; items: T[] }[] {
  const groups: { month: string; items: T[] }[] = [];
  for (const item of items) {
    const month = new Date(date(item)).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
    const last = groups[groups.length - 1];
    if (last?.month === month) last.items.push(item);
    else groups.push({ month, items: [item] });
  }
  return groups;
}
