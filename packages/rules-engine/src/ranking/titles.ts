/**
 * Dynamic titles unlocked by ranked career stats. Only ranked matches count:
 * their results are confirmed by the opponent, so titles can't be farmed by
 * analysing videos of other people.
 *
 * A title is earned once and kept. Criteria are evaluated after every ranked
 * match against the totals of that match's discipline (plus the new rating).
 */

import type { Discipline } from '../core/types.ts';
import type { CareerTotals } from './career.ts';
import { TIERS } from './tiers.ts';

export interface TitleDefinition {
  id: string;
  name: string;
  description: string;
  disciplines: readonly Discipline[];
  /** Current value and goal, for progress bars. */
  progress(totals: CareerTotals, rating: number): { value: number; goal: number };
  /** Extra condition beyond reaching the goal (e.g. never stopped). */
  requires?: (totals: CareerTotals) => boolean;
}

const ALL: readonly Discipline[] = ['bjj', 'wrestling', 'mma'];
const MINUTE = 60_000;
const GRANDMASTER_RATING = TIERS.find((tier) => tier.id === 'grandmaster')!.min;

export const TITLES: readonly TitleDefinition[] = [
  {
    id: 'submission_wizard',
    name: 'Submission Wizard',
    description: 'Win 5 ranked matches by submission.',
    disciplines: ['bjj', 'mma'],
    progress: (t) => ({ value: t.submissionWins, goal: 5 }),
  },
  {
    id: 'takedown_machine',
    name: 'Takedown Machine',
    description: 'Land 25 takedowns in ranked matches.',
    disciplines: ALL,
    progress: (t) => ({ value: t.takedowns, goal: 25 }),
  },
  {
    id: 'iron_chin',
    name: 'Iron Chin',
    description: 'Absorb 100 significant strikes in ranked MMA without ever being stopped by KO/TKO.',
    disciplines: ['mma'],
    progress: (t) => ({ value: t.significantAbsorbed, goal: 100 }),
    requires: (t) => t.koLosses === 0,
  },
  {
    id: 'knockout_artist',
    name: 'Knockout Artist',
    description: 'Win 3 ranked MMA matches by KO/TKO.',
    disciplines: ['mma'],
    progress: (t) => ({ value: t.koWins, goal: 3 }),
  },
  {
    id: 'volume_striker',
    name: 'Volume Striker',
    description: 'Land 250 significant strikes in ranked MMA.',
    disciplines: ['mma'],
    progress: (t) => ({ value: t.significantLanded, goal: 250 }),
  },
  {
    id: 'sweep_specialist',
    name: 'Sweep Specialist',
    description: 'Hit 10 sweeps in ranked BJJ.',
    disciplines: ['bjj'],
    progress: (t) => ({ value: t.sweeps, goal: 10 }),
  },
  {
    id: 'pressure_passer',
    name: 'Pressure Passer',
    description: 'Pass the guard 15 times in ranked BJJ.',
    disciplines: ['bjj'],
    progress: (t) => ({ value: t.guardPasses, goal: 15 }),
  },
  {
    id: 'backpack',
    name: 'Backpack',
    description: 'Score back control 10 times in ranked BJJ.',
    disciplines: ['bjj'],
    progress: (t) => ({ value: t.backTakes, goal: 10 }),
  },
  {
    id: 'escape_artist',
    name: 'Escape Artist',
    description: 'Escape 20 times in ranked BJJ or wrestling.',
    disciplines: ['bjj', 'wrestling'],
    progress: (t) => ({ value: t.escapes, goal: 20 }),
  },
  {
    id: 'pinning_machine',
    name: 'Pinning Machine',
    description: 'Win 3 ranked wrestling matches by fall.',
    disciplines: ['wrestling'],
    progress: (t) => ({ value: t.fallWins, goal: 3 }),
  },
  {
    id: 'technician',
    name: 'Technician',
    description: 'Win 3 ranked wrestling matches by technical superiority.',
    disciplines: ['wrestling'],
    progress: (t) => ({ value: t.techFallWins, goal: 3 }),
  },
  {
    id: 'control_freak',
    name: 'Control Freak',
    description: 'Hold 30 minutes of top control or riding time in ranked matches.',
    disciplines: ALL,
    progress: (t) => ({ value: Math.floor(t.controlMs / MINUTE), goal: 30 }),
  },
  {
    id: 'unstoppable',
    name: 'Unstoppable',
    description: 'Win 5 ranked matches in a row.',
    disciplines: ALL,
    progress: (t) => ({ value: t.bestStreak, goal: 5 }),
  },
  {
    id: 'giant_slayer',
    name: 'Giant Slayer',
    description: 'Beat an opponent rated at least 200 points above you.',
    disciplines: ALL,
    progress: (t) => ({ value: Math.min(t.biggestUpset, 200), goal: 200 }),
  },
  {
    id: 'veteran',
    name: 'Veteran',
    description: 'Complete 25 ranked matches.',
    disciplines: ALL,
    progress: (t) => ({ value: t.matches, goal: 25 }),
  },
  {
    id: 'grandmaster',
    name: 'Grandmaster',
    description: 'Reach the Grandmaster tier.',
    disciplines: ALL,
    progress: (_t, rating) => ({ value: Math.min(rating, GRANDMASTER_RATING), goal: GRANDMASTER_RATING }),
  },
];

const BY_ID = new Map(TITLES.map((title) => [title.id, title]));

export function titleById(id: string): TitleDefinition | undefined {
  return BY_ID.get(id);
}

export function isUnlocked(title: TitleDefinition, totals: CareerTotals, rating: number): boolean {
  const { value, goal } = title.progress(totals, rating);
  return value >= goal && (title.requires?.(totals) ?? true);
}

/** Ids of every title these totals qualify for in `discipline`. */
export function unlockedTitles(discipline: Discipline, totals: CareerTotals, rating: number): string[] {
  return TITLES.filter((title) => title.disciplines.includes(discipline) && isUnlocked(title, totals, rating)).map((title) => title.id);
}
