import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeMatch, type BjjStats, type Scorecard } from '../src/index.ts';

const s = (seconds: number) => seconds * 1000;

function bjj(events: unknown[], variant = 'ibjjf', durationMs = s(300)): Scorecard<BjjStats> {
  return analyzeMatch('bjj', events, { durationMs, variant }) as Scorecard<BjjStats>;
}

describe('bjj / ibjjf', () => {
  it('awards a stabilised takedown, then guard pass and mount (2 + 3 + 4)', () => {
    const card = bjj([
      { type: 'position', position: 'standing', t: 0, endT: s(20), confidence: 0.9 },
      { type: 'takedown', athlete: 'A', t: s(20), confidence: 0.9 },
      { type: 'position', position: 'closed_guard', athlete: 'B', t: s(21), endT: s(60), confidence: 0.9 },
      { type: 'guard_pass', athlete: 'A', t: s(60), confidence: 0.9 },
      { type: 'position', position: 'side_control', athlete: 'A', t: s(60), endT: s(80), confidence: 0.9 },
      { type: 'position', position: 'mount', athlete: 'A', t: s(80), endT: s(100), confidence: 0.9 },
    ]);
    assert.equal(card.totals.A.points, 9);
    assert.equal(card.totals.B.points, 0);
    assert.equal(card.result.winner, 'A');
    assert.equal(card.result.method, 'points');
    assert.deepEqual(
      card.scoreLog.map((line) => line.label),
      ['Takedown (+2)', 'Guard pass (+3)', 'Mount (+4)'],
    );
  });

  it('turns an unstabilised sweep into an advantage', () => {
    const card = bjj([
      { type: 'position', position: 'closed_guard', athlete: 'A', t: 0, endT: s(30), confidence: 0.9 },
      { type: 'sweep', athlete: 'A', t: s(30), confidence: 0.9 },
      // B immediately recovers top position: A never stabilises.
      { type: 'position', position: 'scramble', t: s(30), endT: s(31), confidence: 0.9 },
      { type: 'position', position: 'half_guard', athlete: 'A', t: s(31), endT: s(60), confidence: 0.9 },
    ]);
    assert.equal(card.totals.A.points, 0);
    assert.equal(card.totals.A.advantages, 1);
    assert.equal(card.result.method, 'advantages');
  });

  it('merges split detections so a long mount scores once', () => {
    const card = bjj([
      { type: 'position', position: 'mount', athlete: 'B', t: s(10), endT: s(14), confidence: 0.9 },
      { type: 'position', position: 'mount', athlete: 'B', t: s(14.5), endT: s(30), confidence: 0.9 },
    ]);
    assert.equal(card.totals.B.points, 4);
  });

  it('gives a short mount an advantage instead of points', () => {
    const card = bjj([{ type: 'position', position: 'mount', athlete: 'A', t: s(10), endT: s(12), confidence: 0.9 }]);
    assert.equal(card.totals.A.points, 0);
    assert.equal(card.totals.A.advantages, 1);
  });

  it('ends the match at the first submission and ignores later scoring', () => {
    const card = bjj([
      { type: 'position', position: 'back_control', athlete: 'B', t: s(10), endT: s(40), confidence: 0.9 },
      { type: 'submission', athlete: 'B', t: s(40), technique: 'rear naked choke', confidence: 0.95 },
      { type: 'takedown', athlete: 'A', t: s(60), confidence: 0.9 },
    ]);
    assert.equal(card.result.winner, 'B');
    assert.equal(card.result.method, 'submission');
    assert.equal(card.result.at, s(40));
    assert.equal(card.totals.A.points, 0);
    assert.ok(card.highlights.some((highlight) => highlight.label.includes('rear naked choke')));
  });

  it('applies the penalty progression up to disqualification', () => {
    const penalty = (t: number) => ({ type: 'penalty', athlete: 'A', t: s(t), confidence: 1, reason: 'stalling' });
    const card = bjj([penalty(10), penalty(20), penalty(30), penalty(40)]);
    assert.equal(card.totals.B.advantages, 1);
    assert.equal(card.totals.B.points, 2);
    assert.equal(card.result.method, 'disqualification');
    assert.equal(card.result.winner, 'B');
  });

  it('awards points without position data but warns', () => {
    const card = bjj([{ type: 'takedown', athlete: 'A', t: s(5), confidence: 0.9 }]);
    assert.equal(card.totals.A.points, 2);
    assert.ok(card.warnings.some((warning) => warning.includes('stabilisation')));
  });

  it('drops low-confidence and malformed events', () => {
    const card = bjj([
      { type: 'takedown', athlete: 'A', t: s(5), confidence: 0.2 },
      { type: 'takedown', athlete: 'Z', t: s(5), confidence: 0.9 },
      { type: 'takedown', athlete: 'A', t: -5, confidence: 0.9 },
      { type: 'teleport', athlete: 'A', t: s(5), confidence: 0.9 },
      'not an event',
    ]);
    assert.equal(card.totals.A.points, 0);
    assert.equal(card.droppedEvents, 5);
  });

  it('computes position statistics and phases', () => {
    const card = bjj([
      { type: 'position', position: 'standing', t: 0, endT: s(30), confidence: 0.9 },
      { type: 'position', position: 'half_guard', athlete: 'B', t: s(30), endT: s(90), confidence: 0.9 },
      { type: 'position', position: 'side_control', athlete: 'A', t: s(90), endT: s(120), confidence: 0.9 },
    ]);
    assert.equal(card.stats.analysedMs, s(120));
    assert.equal(card.stats.neutralMs, s(30));
    assert.equal(card.stats.guardMs.B, s(60));
    assert.equal(card.stats.topControlMs.A, s(30));
    assert.equal(card.stats.controlShare.A, 0.25);
    assert.deepEqual(
      card.phases.map((phase) => phase.kind),
      ['standing', 'guard', 'top_control'],
    );
  });

  it('respects point overrides', () => {
    const card = analyzeMatch('bjj', [{ type: 'takedown', athlete: 'A', t: s(5), confidence: 0.9 }], {
      durationMs: s(60),
      pointOverrides: { takedown: 3 },
    });
    assert.equal(card.totals.A.points, 3);
  });
});

describe('bjj / submission_only', () => {
  it('is a draw without a submission regardless of positions', () => {
    const card = bjj(
      [{ type: 'position', position: 'mount', athlete: 'A', t: 0, endT: s(60), confidence: 0.9 }],
      'submission_only',
    );
    assert.equal(card.totals.A.points, 0);
    assert.equal(card.result.method, 'draw');
  });
});
