import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { athleteNumbers } from '../analysis/athlete-stats.ts';
import { countsBetween, daysLeft, type GoalMatch, goalLabel, goalStreak, weekProgress, weekStart } from './progress.ts';

// Wednesday 12 November 2025, 15:00 phone time.
const NOW = new Date(2025, 10, 12, 15, 0);
const at = (day: number, hour = 18) => new Date(2025, 10, day, hour).toISOString();

const bjj = (day: number, winner: 'A' | 'B' | null, takedowns = 0, sweeps = 0): GoalMatch => ({
  discipline: 'bjj',
  status: 'completed',
  recorded_at: at(day),
  result: { winner },
  stats: { takedowns: { A: takedowns, B: 0 }, sweeps: { A: sweeps, B: 1 }, submissionAttempts: { A: 1, B: 0 }, guardPasses: { A: 2, B: 0 }, topControlMs: { A: 60_000, B: 0 } },
});

describe('weekStart', () => {
  it('is Monday at midnight', () => {
    const start = weekStart(NOW);
    assert.equal(start.getDay(), 1);
    assert.equal(start.getDate(), 10);
    assert.equal(start.getHours(), 0);
  });

  it('keeps Sunday in the week that began the Monday before', () => {
    assert.equal(weekStart(new Date(2025, 10, 16, 23, 30)).getDate(), 10);
  });
});

describe('athleteNumbers', () => {
  it('reads Fighter 1 in each sport, and zero for what a sport lacks', () => {
    assert.deepEqual(athleteNumbers('wrestling', { takedowns: { A: 3, B: 1 }, controlMs: { A: 30_000, B: 0 } }), {
      takedowns: 3,
      submissionAttempts: 0,
      guardPasses: 0,
      sweeps: 0,
      controlMs: 30_000,
    });
    assert.equal(athleteNumbers('mma', { A: { takedownsLanded: 2, submissionAttempts: 1, controlMs: 90_000 } }).takedowns, 2);
  });

  it('treats missing or malformed stats as zero', () => {
    assert.equal(athleteNumbers('bjj', null).takedowns, 0);
    assert.equal(athleteNumbers('bjj', { takedowns: { A: 'lots' } }).takedowns, 0);
    assert.equal(athleteNumbers('karate', { takedowns: { A: 5 } }).takedowns, 0);
  });
});

describe('countsBetween', () => {
  it('counts this week only, and skips drafts', () => {
    const matches = [bjj(10, 'A', 2), bjj(12, 'B', 1), bjj(9, 'A', 5), { ...bjj(11, 'A', 4), status: 'draft' }];
    const counts = countsBetween(matches, weekStart(NOW), new Date(2025, 10, 17));
    assert.equal(counts.rounds, 2);
    assert.equal(counts.wins, 1);
    assert.equal(counts.takedowns, 3);
    assert.equal(counts.guard_passes, 4);
  });
});

describe('weekProgress', () => {
  it('shows done and target per goal, in a fixed order, capped at full', () => {
    const progress = weekProgress(
      [
        { kind: 'takedowns', target: 2 },
        { kind: 'rounds', target: 4 },
      ],
      [bjj(10, 'A', 2), bjj(11, 'A', 1)],
      NOW,
    );
    assert.deepEqual(
      progress.map(({ kind, done, met, share }) => ({ kind, done, met, share })),
      [
        { kind: 'rounds', done: 2, met: false, share: 0.5 },
        { kind: 'takedowns', done: 3, met: true, share: 1 },
      ],
    );
  });
});

describe('goalStreak', () => {
  const goals = [{ kind: 'rounds' as const, target: 2 }];

  it('counts the weeks in a row in which every goal was met', () => {
    // Two last week (3-4 Nov), none this week yet: streak 1 (this week is still open).
    assert.equal(goalStreak(goals, [bjj(3, 'A'), bjj(4, 'B')], NOW), 1);
  });

  it('includes this week once its goals are met', () => {
    assert.equal(goalStreak(goals, [bjj(3, 'A'), bjj(4, 'B'), bjj(10, 'A'), bjj(11, 'A')], NOW), 2);
  });

  it('stops at the first week that missed', () => {
    // 27 Oct week missed (one round), 3 Nov week met, this week met.
    const matches = [new Date(2025, 9, 28, 18).toISOString()].map((recorded_at) => ({ ...bjj(1, 'A'), recorded_at }));
    assert.equal(goalStreak(goals, [...matches, bjj(3, 'A'), bjj(4, 'A'), bjj(10, 'A'), bjj(12, 'A')], NOW), 2);
  });

  it('is zero without goals', () => {
    assert.equal(goalStreak([], [bjj(10, 'A')], NOW), 0);
  });
});

describe('labels and days', () => {
  it('says one or many', () => {
    assert.equal(goalLabel('rounds', 1), '1 round');
    assert.equal(goalLabel('submission_attempts', 3), '3 submission attempts');
  });

  it('counts the days left in the week, today included', () => {
    assert.equal(daysLeft(NOW), 5);
    assert.equal(daysLeft(new Date(2025, 10, 16, 9)), 1);
  });
});
