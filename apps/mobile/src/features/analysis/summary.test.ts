import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeMatch } from '@matiq/rules-engine';
import { methodLabel } from './labels.ts';
import { keyMoments, keyStats } from './summary.ts';

const s = (seconds: number) => seconds * 1000;

// A takes B down, passes, holds side control, and finishes with a choke.
const card = analyzeMatch(
  'bjj',
  [
    { type: 'position', position: 'standing', t: 0, endT: s(12), confidence: 0.9 },
    { type: 'takedown', athlete: 'A', t: s(12), confidence: 0.9 },
    { type: 'position', position: 'closed_guard', athlete: 'B', t: s(13), endT: s(40), confidence: 0.9 },
    { type: 'submission_attempt', athlete: 'B', t: s(30), technique: 'triangle_choke', depth: 'shallow', confidence: 0.9 },
    { type: 'guard_pass', athlete: 'A', t: s(40), confidence: 0.9 },
    { type: 'position', position: 'side_control', athlete: 'A', t: s(40), endT: s(140), confidence: 0.9 },
    { type: 'submission', athlete: 'A', t: s(145), technique: 'rear_naked_choke', confidence: 0.9 },
  ],
  { durationMs: s(300), variant: 'ibjjf' },
);

describe('keyStats', () => {
  it('leads with the most one-sided stats and names who had the edge', () => {
    const stats = keyStats(card);
    assert.ok(stats.length > 0 && stats.length <= 3);
    // Only A took anyone down or passed: those are fully one-sided.
    assert.ok(stats.some((stat) => stat.label === 'Takedowns' && stat.leader === 'A' && stat.value === '1'));
    assert.ok(stats.every((stat) => stat.value !== '0' && stat.value !== '0s'));
  });

  it('leaves out stats that are even or that nobody scored', () => {
    const labels = keyStats(card, 20).map((stat) => stat.label);
    assert.ok(!labels.includes('Reversals'));
    assert.ok(!labels.includes('Escapes'));
  });
});

describe('keyMoments', () => {
  it('lists the biggest moments in time order, with the points or the finish', () => {
    const moments = keyMoments(card);
    const times = moments.map((moment) => moment.highlight.t);
    assert.deepEqual(times, [...times].sort((x, y) => x - y));
    const finish = moments.find((moment) => moment.finish);
    assert.equal(finish?.highlight.t, s(145));
    assert.equal(finish?.tag, 'Sub');
    assert.ok(moments.some((moment) => moment.highlight.t === s(12) && moment.tag === '+2'));
    assert.ok(moments.some((moment) => moment.highlight.t === s(40) && moment.tag === '+3'));
  });

  it('keeps no more than asked for', () => {
    assert.equal(keyMoments(card, 2).length, 2);
  });
});

describe('methodLabel', () => {
  it('has short labels for result pills', () => {
    assert.equal(methodLabel('ko_tko'), 'KO / TKO');
    assert.equal(methodLabel('decision'), 'Decision');
    assert.equal(methodLabel('something_new'), 'Something new');
  });
});
