/**
 * What the match summary leads with: the few stats where one fighter clearly
 * had the edge, and the moments that decided the match.
 */

import type { Athlete, Highlight, Scorecard } from '@matiq/rules-engine';
import { statRows } from './stat-rows.ts';

export interface KeyStat {
  label: string;
  /** The leader's value, formatted ("58s", "3"). */
  value: string;
  leader: Athlete;
}

/**
 * Stats where having more is not an edge: penalties count against you, and
 * time playing guard is time on the bottom.
 */
const NOT_AN_EDGE = new Set(['Penalties', 'Guard time']);

/**
 * Up to `max` stats with the clearest edge, most one-sided first. Even stats,
 * stats neither fighter scored, and stats where more is not better are left out.
 */
export function keyStats(scorecard: Scorecard, max = 3): KeyStat[] {
  return statRows(scorecard)
    .map((row, index) => ({ row, index, edge: Math.abs(row.share - 0.5) }))
    .filter(({ row, edge }) => edge > 0 && !NOT_AN_EDGE.has(row.label))
    .sort((x, y) => y.edge - x.edge || x.index - y.index)
    .slice(0, max)
    .map(({ row }) => {
      const leader: Athlete = row.share > 0.5 ? 'A' : 'B';
      return { label: row.label, value: leader === 'A' ? row.a : row.b, leader };
    });
}

const FINISH_TAGS: Partial<Record<string, string>> = {
  submission: 'Sub',
  fall: 'Fall',
  ko_tko: 'KO',
  technical_superiority: 'Win',
  disqualification: 'DQ',
};

export interface KeyMoment {
  highlight: Highlight;
  /** "+2" for points scored, "Sub" / "KO" / "Fall" for the finish, or null. */
  tag: string | null;
  /** True for the moment that ended the match. */
  finish: boolean;
}

/** The `max` most important highlights, in the order they happened. */
export function keyMoments(scorecard: Scorecard, max = 4): KeyMoment[] {
  const { result, scoreLog } = scorecard;
  return [...scorecard.highlights]
    .sort((x, y) => y.weight - x.weight || x.t - y.t)
    .slice(0, max)
    .sort((x, y) => x.t - y.t)
    .map((highlight) => {
      const finish = result.at !== undefined && highlight.t === result.at && highlight.athlete === result.winner;
      if (finish) return { highlight, tag: FINISH_TAGS[result.method] ?? 'Win', finish };
      const points = scoreLog
        .filter((line) => line.t === highlight.t && line.athlete === highlight.athlete)
        .reduce((sum, line) => sum + line.points, 0);
      return { highlight, tag: points > 0 ? `+${points}` : null, finish };
    });
}
