/**
 * Technique breakdown for the post-match dashboard: where each athlete's
 * points came from, plus discipline-specific splits (BJJ position time and
 * submission attempts by technique, wrestling shots, MMA strikes by target
 * and position). Pure functions over a saved scorecard, so they work for
 * old analyses too and never need another AI call.
 */

import type { Athlete, BjjStats, MmaStats, Scorecard, ScoreLine, WrestlingStats } from '@matiq/rules-engine';

export interface BreakdownItem {
  label: string;
  a: number;
  b: number;
}

export interface BreakdownSection {
  title: string;
  /** How values are displayed: plain counts, points, or durations in ms. */
  unit: 'count' | 'points' | 'ms';
  items: BreakdownItem[];
}

export type AthleteFilter = Athlete | 'both';

const POSITION_LABELS: Record<string, string> = {
  closed_guard: 'Closed guard (bottom)',
  open_guard: 'Open guard (bottom)',
  half_guard: 'Half guard (bottom)',
  turtle: 'Turtle (bottom)',
  side_control: 'Side control',
  north_south: 'North-south',
  knee_on_belly: 'Knee on belly',
  mount: 'Mount',
  back_control: 'Back control',
};

/** "rear_naked_choke" -> "Rear naked choke". */
export function humanize(value: string): string {
  const spaced = value.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Score-log labels carry the value ("Mount (+4)"); the technique is the rest. */
export function techniqueName(label: string): string {
  return label.replace(/\s*\(\+\d+\)$/, '').trim();
}

function sortItems(items: BreakdownItem[]): BreakdownItem[] {
  return items.sort((x, y) => y.a + y.b - (x.a + x.b) || x.label.localeCompare(y.label));
}

export function pointsByTechnique(lines: readonly ScoreLine[]): BreakdownItem[] {
  const byLabel = new Map<string, BreakdownItem>();
  for (const line of lines) {
    if (line.points <= 0) continue;
    const label = techniqueName(line.label);
    const item = byLabel.get(label) ?? { label, a: 0, b: 0 };
    if (line.athlete === 'A') item.a += line.points;
    else item.b += line.points;
    byLabel.set(label, item);
  }
  return sortItems([...byLabel.values()]);
}

/** Merges two per-athlete records into items, skipping all-zero rows. */
function recordItems(a: Partial<Record<string, number>>, b: Partial<Record<string, number>>, label: (key: string) => string): BreakdownItem[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const items: BreakdownItem[] = [];
  for (const key of keys) {
    const item = { label: label(key), a: a[key] ?? 0, b: b[key] ?? 0 };
    if (item.a > 0 || item.b > 0) items.push(item);
  }
  return sortItems(items);
}

function bjjSections(stats: BjjStats): BreakdownSection[] {
  const positions = recordItems(stats.positionMs.A, stats.positionMs.B, (key) => POSITION_LABELS[key] ?? humanize(key));
  return [
    { title: 'Position time', unit: 'ms', items: positions.filter((item) => item.label !== 'Standing' && item.label !== 'Scramble') },
    {
      title: 'Submission attempts',
      unit: 'count',
      items: recordItems(stats.submissionAttemptsByTechnique.A, stats.submissionAttemptsByTechnique.B, humanize),
    },
  ];
}

function wrestlingSections(stats: WrestlingStats): BreakdownSection[] {
  const pick = (label: string, values: Record<Athlete, number>): BreakdownItem => ({ label, a: values.A, b: values.B });
  return [
    {
      title: 'Shots and mat work',
      unit: 'count',
      items: [
        pick('Takedowns finished', stats.takedowns),
        pick('Missed shots', stats.missedShots),
        pick('Escapes', stats.escapes),
        pick('Reversals', stats.reversals),
        pick('Near falls', stats.nearFalls),
        pick('Exposures', stats.exposures),
        pick('Step-outs', stats.stepOuts),
      ].filter((item) => item.a > 0 || item.b > 0),
    },
  ];
}

function mmaSections(stats: MmaStats): BreakdownSection[] {
  return [
    { title: 'Strikes landed by target', unit: 'count', items: recordItems(stats.A.landedByTarget, stats.B.landedByTarget, humanize) },
    { title: 'Strikes landed by position', unit: 'count', items: recordItems(stats.A.landedByPosition, stats.B.landedByPosition, humanize) },
    {
      title: 'Grappling',
      unit: 'count',
      items: [
        { label: 'Takedowns landed', a: stats.A.takedownsLanded, b: stats.B.takedownsLanded },
        { label: 'Takedowns attempted', a: stats.A.takedownsAttempted, b: stats.B.takedownsAttempted },
        { label: 'Submission attempts', a: stats.A.submissionAttempts, b: stats.B.submissionAttempts },
        { label: 'Reversals', a: stats.A.reversals, b: stats.B.reversals },
      ].filter((item) => item.a > 0 || item.b > 0),
    },
  ];
}

export function techniqueBreakdown(scorecard: Scorecard): BreakdownSection[] {
  const sections: BreakdownSection[] = [];
  // MMA "points" are projected round scores, not techniques.
  if (scorecard.discipline !== 'mma') {
    sections.push({ title: 'Points by technique', unit: 'points', items: pointsByTechnique(scorecard.scoreLog) });
  }
  switch (scorecard.discipline) {
    case 'bjj':
      sections.push(...bjjSections(scorecard.stats as BjjStats));
      break;
    case 'wrestling':
      sections.push(...wrestlingSections(scorecard.stats as WrestlingStats));
      break;
    case 'mma':
      sections.push(...mmaSections(scorecard.stats as MmaStats));
      break;
  }
  return sections.filter((section) => section.items.length > 0);
}

/** Keeps entries by the selected athlete; neutral entries only show for "both". */
export function filterByAthlete<T extends { athlete: Athlete | null }>(items: readonly T[], filter: AthleteFilter): T[] {
  return filter === 'both' ? [...items] : items.filter((item) => item.athlete === filter);
}

export interface Clip {
  start: number;
  end: number;
}

const DEFAULT_CLIP_MS = 8000;
const MAX_CLIP_MS = 60_000;

/**
 * Validates a highlight range from a link (feed post, deep link): clamps it
 * to the recording, defaults the length, and caps it so a crafted link can't
 * turn "play highlight" into "play everything".
 */
export function resolveClip(start: number | undefined, end: number | undefined, durationMs: number): Clip | null {
  if (start === undefined || !Number.isFinite(start) || durationMs <= 0) return null;
  const from = Math.min(Math.max(0, Math.round(start)), Math.max(0, durationMs - 1000));
  const requestedEnd = end !== undefined && Number.isFinite(end) && end > from ? Math.round(end) : from + DEFAULT_CLIP_MS;
  return { start: from, end: Math.min(requestedEnd, from + MAX_CLIP_MS, durationMs) };
}
