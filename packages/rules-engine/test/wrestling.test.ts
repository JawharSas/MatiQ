import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeMatch, type Scorecard, type WrestlingStats } from '../src/index.ts';

const s = (seconds: number) => seconds * 1000;

function wrestle(events: unknown[], variant: 'folkstyle' | 'freestyle', durationMs = s(420)): Scorecard<WrestlingStats> {
  return analyzeMatch('wrestling', events, { durationMs, variant }) as Scorecard<WrestlingStats>;
}

describe('wrestling / folkstyle', () => {
  it('scores takedown, escape, reversal and near fall by duration', () => {
    const card = wrestle(
      [
        { type: 'takedown', athlete: 'A', t: s(30), confidence: 0.9 },
        { type: 'escape', athlete: 'B', t: s(60), confidence: 0.9 },
        { type: 'takedown', athlete: 'B', t: s(90), confidence: 0.9 },
        { type: 'reversal', athlete: 'A', t: s(120), confidence: 0.9 },
        { type: 'near_fall', athlete: 'A', t: s(130), endT: s(134.5), confidence: 0.9 },
        { type: 'near_fall', athlete: 'A', t: s(150), endT: s(151), confidence: 0.9 },
      ],
      'folkstyle',
    );
    // A: 3 (TD) + 2 (reversal) + 4 (near fall 4s+) ; B: 1 (escape) + 3 (TD)
    assert.equal(card.totals.A.points, 9);
    assert.equal(card.totals.B.points, 4);
    assert.equal(card.stats.nearFalls.A, 2);
    assert.equal(card.result.winner, 'A');
  });

  it('awards a riding-time point for a minute of net control', () => {
    const card = wrestle(
      [
        { type: 'takedown', athlete: 'A', t: s(10), confidence: 0.9 },
        { type: 'control', athlete: 'A', t: s(10), endT: s(100), confidence: 0.9 },
        { type: 'takedown', athlete: 'B', t: s(200), confidence: 0.9 },
        { type: 'control', athlete: 'B', t: s(200), endT: s(220), confidence: 0.9 },
      ],
      'folkstyle',
    );
    assert.equal(card.stats.ridingTimeAdvantageMs, s(70));
    assert.equal(card.totals.A.points, 4);
    assert.equal(card.result.winner, 'A');
  });

  it('ends on a technical fall at a 15-point lead', () => {
    const takedown = (t: number) => ({ type: 'takedown', athlete: 'B', t: s(t), confidence: 0.9 });
    const escape = (t: number) => ({ type: 'escape', athlete: 'B', t: s(t), confidence: 0.9 });
    const card = wrestle(
      [takedown(10), escape(20), takedown(30), escape(40), takedown(50), escape(60), takedown(70), escape(80), takedown(90)],
      'folkstyle',
    );
    assert.equal(card.result.method, 'technical_superiority');
    assert.equal(card.result.at, s(70));
    assert.equal(card.totals.B.points, 15);
  });

  it('ends on a fall', () => {
    const card = wrestle(
      [
        { type: 'fall', athlete: 'A', t: s(95), confidence: 0.95 },
        { type: 'takedown', athlete: 'B', t: s(100), confidence: 0.9 },
      ],
      'folkstyle',
    );
    assert.equal(card.result.method, 'fall');
    assert.equal(card.totals.B.points, 0);
  });

  it('gives the first stalling call as a warning only', () => {
    const stall = (t: number) => ({ type: 'penalty', athlete: 'A', kind: 'stalling', t: s(t), confidence: 0.9 });
    const card = wrestle([stall(10), stall(20)], 'folkstyle');
    assert.equal(card.totals.B.points, 1);
  });
});

describe('wrestling / freestyle', () => {
  it('scores freestyle values and step outs', () => {
    const card = wrestle(
      [
        { type: 'takedown', athlete: 'A', t: s(10), confidence: 0.9 },
        { type: 'exposure', athlete: 'A', t: s(20), confidence: 0.9 },
        { type: 'step_out', athlete: 'B', t: s(40), confidence: 0.9 },
        { type: 'takedown', athlete: 'B', t: s(50), toDangerPosition: true, confidence: 0.9 },
        { type: 'takedown', athlete: 'B', t: s(60), grandAmplitude: true, toDangerPosition: true, confidence: 0.9 },
      ],
      'freestyle',
    );
    assert.equal(card.totals.A.points, 4);
    assert.equal(card.totals.B.points, 10);
    assert.equal(card.result.method, 'points');
    assert.equal(card.result.winner, 'B');
  });

  it('ends on technical superiority at a 10-point lead', () => {
    const card = wrestle(
      [
        { type: 'takedown', athlete: 'A', t: s(10), grandAmplitude: true, toDangerPosition: true, confidence: 0.9 },
        { type: 'takedown', athlete: 'A', t: s(30), grandAmplitude: true, toDangerPosition: true, confidence: 0.9 },
        { type: 'exposure', athlete: 'A', t: s(60), confidence: 0.9 },
      ],
      'freestyle',
    );
    assert.equal(card.result.method, 'technical_superiority');
    assert.equal(card.result.at, s(30));
    assert.equal(card.totals.A.points, 10);
  });

  it('breaks ties on the highest-value move', () => {
    const card = wrestle(
      [
        { type: 'takedown', athlete: 'A', t: s(10), toDangerPosition: true, confidence: 0.9 },
        { type: 'takedown', athlete: 'B', t: s(20), confidence: 0.9 },
        { type: 'exposure', athlete: 'B', t: s(30), confidence: 0.9 },
      ],
      'freestyle',
    );
    assert.equal(card.totals.A.points, 4);
    assert.equal(card.totals.B.points, 4);
    assert.equal(card.result.winner, 'A');
    assert.equal(card.result.method, 'criteria');
  });

  it('computes takedown conversion', () => {
    const card = wrestle(
      [
        { type: 'shot_attempt', athlete: 'A', t: s(5), confidence: 0.9 },
        { type: 'shot_attempt', athlete: 'A', t: s(15), confidence: 0.9 },
        { type: 'takedown', athlete: 'A', t: s(25), confidence: 0.9 },
      ],
      'freestyle',
    );
    assert.equal(card.stats.takedownConversion.A, 1 / 3);
    assert.equal(card.stats.takedownConversion.B, null);
  });
});
