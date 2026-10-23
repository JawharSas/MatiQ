import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeMatch, type MmaStats, type Scorecard } from '../src/index.ts';

const s = (seconds: number) => seconds * 1000;

function strike(athlete: 'A' | 'B', t: number, landed = true, target = 'head') {
  return { type: 'strike', athlete, t: s(t), landed, significant: true, target, kind: 'punch', position: 'distance', confidence: 0.9 };
}

function mma(events: unknown[], durationMs = s(900)): Scorecard<MmaStats> {
  return analyzeMatch('mma', events, { durationMs, roundDurationMs: s(300) }) as Scorecard<MmaStats>;
}

describe('mma / unified (projected)', () => {
  it('scores each round 10-9 for the athlete with more impact', () => {
    const events = [
      // Round 1: A lands 6, B lands 2.
      ...[10, 20, 30, 40, 50, 60].map((t) => strike('A', t)),
      ...[15, 25].map((t) => strike('B', t)),
      // Round 2: B lands 5, A lands 1.
      ...[310, 320, 330, 340, 350].map((t) => strike('B', t)),
      strike('A', 360),
      // Round 3: A lands 4, B lands 0.
      ...[610, 620, 630, 640].map((t) => strike('A', t)),
    ];
    const card = mma(events);
    assert.deepEqual(
      card.rounds?.map((round) => [round.scores.A, round.scores.B]),
      [
        [10, 9],
        [9, 10],
        [10, 9],
      ],
    );
    assert.equal(card.totals.A.points, 29);
    assert.equal(card.totals.B.points, 28);
    assert.equal(card.result.method, 'decision');
    assert.equal(card.result.winner, 'A');
  });

  it('scores a dominant knockdown round 10-8', () => {
    const card = mma(
      [
        { type: 'knockdown', athlete: 'B', t: s(30), confidence: 0.9 },
        { type: 'knockdown', athlete: 'B', t: s(90), confidence: 0.9 },
        strike('B', 100),
      ],
      s(300),
    );
    assert.deepEqual(card.rounds?.[0]?.scores, { A: 8, B: 10 });
  });

  it('ends on a finish and reports it', () => {
    const card = mma([
      strike('A', 10),
      { type: 'finish', athlete: 'A', method: 'submission', technique: 'guillotine', t: s(200), confidence: 0.95 },
      strike('B', 400),
    ]);
    assert.equal(card.result.method, 'submission');
    assert.equal(card.result.at, s(200));
    assert.equal(card.rounds?.length, 1);
    assert.equal(card.stats.B.strikesThrown, 0);
  });

  it('computes striking and grappling statistics', () => {
    const card = mma([
      strike('A', 10),
      strike('A', 20, false),
      strike('A', 30, true, 'body'),
      { type: 'takedown', athlete: 'B', t: s(40), landed: true, confidence: 0.9 },
      { type: 'takedown', athlete: 'B', t: s(80), landed: false, confidence: 0.9 },
      { type: 'control', athlete: 'B', t: s(40), endT: s(70), position: 'ground_top', confidence: 0.9 },
    ]);
    assert.equal(card.stats.A.significantLanded, 2);
    assert.equal(card.stats.A.significantThrown, 3);
    assert.equal(card.stats.A.landedByTarget.body, 1);
    assert.equal(card.stats.B.takedownAccuracy, 0.5);
    assert.equal(card.stats.B.controlMs, s(30));
    assert.ok(card.phases.some((phase) => phase.kind === 'ground' && phase.dominant === 'B'));
  });

  it('applies point deductions to the round', () => {
    const card = mma(
      [strike('A', 10), strike('A', 20), { type: 'point_deduction', athlete: 'A', points: 1, t: s(50), confidence: 1 }],
      s(300),
    );
    assert.deepEqual(card.rounds?.[0]?.scores, { A: 9, B: 9 });
  });

  it('marks the output as an estimate', () => {
    const card = mma([]);
    assert.ok(card.warnings.some((warning) => warning.includes('not an official decision')));
  });
});

describe('analyzeMatch guards', () => {
  it('rejects unknown variants and invalid durations', () => {
    assert.throws(() => analyzeMatch('mma', [], { durationMs: s(60), variant: 'bare_knuckle' }));
    assert.throws(() => analyzeMatch('bjj', [], { durationMs: 0 }));
    assert.throws(() => analyzeMatch('bjj', 'nope', { durationMs: s(60) }));
  });
});
