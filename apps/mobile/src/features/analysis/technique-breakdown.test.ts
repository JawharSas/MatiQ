import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeMatch, type ScoreLine } from '@matiq/rules-engine';
import { filterByAthlete, pointsByTechnique, resolveClip, techniqueBreakdown, techniqueName } from './technique-breakdown.ts';

const s = (seconds: number) => seconds * 1000;
const line = (athlete: 'A' | 'B', points: number, label: string): ScoreLine => ({ t: 0, athlete, points, advantages: 0, penalties: 0, label });

describe('techniqueName', () => {
  it('strips the awarded value from score-log labels', () => {
    assert.equal(techniqueName('Mount (+4)'), 'Mount');
    assert.equal(techniqueName('Riding time 1:05 (+1)'), 'Riding time 1:05');
    assert.equal(techniqueName('Penalty 2'), 'Penalty 2');
  });
});

describe('pointsByTechnique', () => {
  it('sums points per technique and athlete, largest first, ignoring non-point lines', () => {
    const items = pointsByTechnique([
      line('A', 2, 'Takedown (+2)'),
      line('B', 2, 'Takedown (+2)'),
      line('A', 2, 'Takedown (+2)'),
      line('A', 4, 'Mount (+4)'),
      line('B', 0, 'Advantage'),
    ]);
    assert.deepEqual(items, [
      { label: 'Takedown', a: 4, b: 2 },
      { label: 'Mount', a: 4, b: 0 },
    ]);
  });
});

describe('techniqueBreakdown', () => {
  it('builds BJJ points, position time and submission sections from a real scorecard', () => {
    const card = analyzeMatch(
      'bjj',
      [
        { type: 'position', position: 'standing', t: 0, endT: s(20), confidence: 0.9 },
        { type: 'takedown', athlete: 'A', t: s(20), confidence: 0.9 },
        { type: 'position', position: 'closed_guard', athlete: 'B', t: s(21), endT: s(60), confidence: 0.9 },
        { type: 'submission_attempt', athlete: 'B', t: s(40), technique: 'triangle_choke', depth: 'deep', confidence: 0.9 },
        { type: 'guard_pass', athlete: 'A', t: s(60), confidence: 0.9 },
        { type: 'position', position: 'side_control', athlete: 'A', t: s(60), endT: s(100), confidence: 0.9 },
      ],
      { durationMs: s(300), variant: 'ibjjf' },
    );
    const sections = techniqueBreakdown(card);
    assert.deepEqual(
      sections.map((section) => section.title),
      ['Points by technique', 'Position time', 'Submission attempts'],
    );
    assert.deepEqual(sections[0]?.items.map((item) => [item.label, item.a, item.b]), [
      ['Guard pass', 3, 0],
      ['Takedown', 2, 0],
    ]);
    const positions = sections[1]?.items ?? [];
    assert.ok(positions.every((item) => item.label !== 'Standing'));
    assert.ok(positions.some((item) => item.label === 'Side control' && item.a > 0));
    assert.ok(positions.some((item) => item.label === 'Closed guard (bottom)' && item.b > 0));
    assert.deepEqual(sections[2]?.items, [{ label: 'Triangle choke', a: 0, b: 1 }]);
  });

  it('builds MMA strike splits and skips the round "points"', () => {
    const strike = (athlete: 'A' | 'B', t: number, target: string, position: string) => ({
      type: 'strike',
      athlete,
      t: s(t),
      landed: true,
      significant: true,
      target,
      kind: 'punch',
      position,
      confidence: 0.9,
    });
    const card = analyzeMatch(
      'mma',
      [strike('A', 10, 'head', 'distance'), strike('A', 20, 'body', 'clinch'), strike('B', 30, 'head', 'distance')],
      { durationMs: s(300), roundDurationMs: s(300) },
    );
    const sections = techniqueBreakdown(card);
    assert.deepEqual(
      sections.map((section) => section.title),
      ['Strikes landed by target', 'Strikes landed by position'],
    );
    assert.deepEqual(sections[0]?.items, [
      { label: 'Head', a: 1, b: 1 },
      { label: 'Body', a: 1, b: 0 },
    ]);
  });
});

describe('filterByAthlete', () => {
  const items = [{ athlete: 'A' as const }, { athlete: 'B' as const }, { athlete: null }];
  it('keeps everything for "both" and only that athlete otherwise', () => {
    assert.equal(filterByAthlete(items, 'both').length, 3);
    assert.deepEqual(filterByAthlete(items, 'B'), [{ athlete: 'B' }]);
  });
});

describe('resolveClip', () => {
  it('defaults the length and clamps to the recording', () => {
    assert.deepEqual(resolveClip(s(10), undefined, s(300)), { start: s(10), end: s(18) });
    assert.deepEqual(resolveClip(s(295), s(400), s(300)), { start: s(295), end: s(300) });
    assert.deepEqual(resolveClip(-50, s(5), s(300)), { start: 0, end: s(5) });
  });

  it('caps crafted ranges and rejects missing starts', () => {
    assert.deepEqual(resolveClip(0, s(900), s(1000)), { start: 0, end: s(60) });
    assert.deepEqual(resolveClip(s(20), s(10), s(300)), { start: s(20), end: s(28) });
    assert.equal(resolveClip(undefined, s(10), s(300)), null);
    assert.equal(resolveClip(Number.NaN, undefined, s(300)), null);
  });
});
