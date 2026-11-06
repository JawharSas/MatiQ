/**
 * Weekly training goals: what counts towards each kind, this week's progress
 * and the streak of weeks in which every goal was met. Weeks start on Monday
 * at midnight, phone time. Pure functions, so they are tested on their own.
 */

import { athleteNumbers } from '../analysis/athlete-stats.ts';

export const GOAL_KINDS = ['rounds', 'wins', 'takedowns', 'submission_attempts', 'guard_passes', 'sweeps'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export interface Goal {
  kind: GoalKind;
  target: number;
}

/** What a goal is called, singular and plural ("1 round", "4 rounds"). */
export const GOAL_NAMES: Record<GoalKind, { one: string; many: string; hint: string }> = {
  rounds: { one: 'round', many: 'rounds', hint: 'Rounds you record, in any sport' },
  wins: { one: 'win', many: 'wins', hint: 'Rounds Fighter 1 (you) wins' },
  takedowns: { one: 'takedown', many: 'takedowns', hint: 'BJJ, wrestling and MMA' },
  submission_attempts: { one: 'submission attempt', many: 'submission attempts', hint: 'BJJ and MMA' },
  guard_passes: { one: 'guard pass', many: 'guard passes', hint: 'BJJ' },
  sweeps: { one: 'sweep', many: 'sweeps', hint: 'BJJ' },
};

export function goalLabel(kind: GoalKind, count: number): string {
  return `${count} ${count === 1 ? GOAL_NAMES[kind].one : GOAL_NAMES[kind].many}`;
}

/** The fields of a match the goals need (a subset of the match list item). */
export interface GoalMatch {
  discipline: string;
  status: string;
  recorded_at: string;
  result: { winner: 'A' | 'B' | null } | null;
  stats: unknown;
}

const DAY = 86_400_000;

/** Monday 00:00 (phone time) of the week `date` is in. */
export function weekStart(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const sinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - sinceMonday);
  return start;
}

function addWeeks(date: Date, weeks: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + weeks * 7);
  return next;
}

/** Counts for every kind, from matches recorded in [from, to). Drafts don't count. */
export function countsBetween(matches: readonly GoalMatch[], from: Date, to: Date): Record<GoalKind, number> {
  const counts: Record<GoalKind, number> = { rounds: 0, wins: 0, takedowns: 0, submission_attempts: 0, guard_passes: 0, sweeps: 0 };
  for (const match of matches) {
    const at = Date.parse(match.recorded_at);
    if (!(at >= from.getTime() && at < to.getTime()) || match.status === 'draft') continue;
    counts.rounds += 1;
    if (match.result?.winner === 'A') counts.wins += 1;
    const numbers = athleteNumbers(match.discipline, match.stats);
    counts.takedowns += numbers.takedowns;
    counts.submission_attempts += numbers.submissionAttempts;
    counts.guard_passes += numbers.guardPasses;
    counts.sweeps += numbers.sweeps;
  }
  return counts;
}

export interface GoalProgress extends Goal {
  done: number;
  met: boolean;
  /** done / target, at most 1. */
  share: number;
}

/** This week's progress on each goal, in the order of GOAL_KINDS. */
export function weekProgress(goals: readonly Goal[], matches: readonly GoalMatch[], now: Date): GoalProgress[] {
  const start = weekStart(now);
  const counts = countsBetween(matches, start, addWeeks(start, 1));
  return [...goals]
    .sort((a, b) => GOAL_KINDS.indexOf(a.kind) - GOAL_KINDS.indexOf(b.kind))
    .map((goal) => {
      const done = counts[goal.kind];
      return { ...goal, done, met: done >= goal.target, share: Math.min(1, done / goal.target) };
    });
}

/**
 * Weeks in a row in which every goal was met, with today's targets. This week
 * counts once its goals are met; until then the streak runs to last week, so
 * it isn't lost on a Monday morning.
 */
export function goalStreak(goals: readonly Goal[], matches: readonly GoalMatch[], now: Date, maxWeeks = 52): number {
  if (goals.length === 0) return 0;
  const allMet = (start: Date) => {
    const counts = countsBetween(matches, start, addWeeks(start, 1));
    return goals.every((goal) => counts[goal.kind] >= goal.target);
  };
  let start = weekStart(now);
  let streak = 0;
  if (allMet(start)) streak += 1;
  for (let week = 1; week <= maxWeeks; week++) {
    start = addWeeks(start, -1);
    if (!allMet(start)) break;
    streak += 1;
  }
  return streak;
}

/** How many days are left in this week, today included (1 on Sunday). */
export function daysLeft(now: Date): number {
  const end = addWeeks(weekStart(now), 1);
  return Math.max(1, Math.round((end.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / DAY));
}
