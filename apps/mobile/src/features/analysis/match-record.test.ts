import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { byMonth, outcomeOf, recordText, summarize } from './match-record.ts';

describe('match record', () => {
  it('counts wins for Fighter 1 (you), losses and draws', () => {
    const summary = summarize([
      { result: { winner: 'A', method: 'points' } },
      { result: { winner: 'A', method: 'submission' } },
      { result: { winner: 'B', method: 'points' } },
      { result: { winner: null, method: 'draw' } },
      { result: null },
    ]);
    assert.deepEqual(summary, { total: 5, analysed: 4, wins: 2, losses: 1, draws: 1 });
    assert.equal(recordText(summary), '2-1-1');
  });

  it('has no outcome before analysis', () => {
    assert.equal(outcomeOf(null), null);
    assert.equal(outcomeOf({ winner: 'B', method: 'points' }), 'lost');
  });

  it('groups by month, newest first as given', () => {
    const groups = byMonth(['2026-10-29T10:00:00Z', '2026-10-02T10:00:00Z', '2026-09-30T10:00:00Z'], (iso) => iso, 'en-US');
    assert.deepEqual(groups.map((group) => [group.month, group.items.length]), [['October 2026', 2], ['September 2026', 1]]);
  });
});
