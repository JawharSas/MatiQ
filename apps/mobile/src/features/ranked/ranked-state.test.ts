import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeRanked, type RankedMatchRow } from './ranked-state.ts';

const ME = 'me-0000';
const THEM = 'them-0000';
const NOW = Date.parse('2026-10-28T12:00:00Z');
const later = '2026-10-30T12:00:00Z';
const earlier = '2026-10-27T12:00:00Z';

function row(overrides: Partial<RankedMatchRow>): RankedMatchRow {
  return {
    id: 'r1',
    discipline: 'bjj',
    variant: 'ibjjf',
    challenger_id: ME,
    opponent_id: THEM,
    message: null,
    status: 'pending',
    match_id: null,
    fighter_a_id: null,
    fighter_b_id: null,
    winner_id: null,
    result_method: null,
    confirmed_a_at: null,
    confirmed_b_at: null,
    confirm_by: null,
    recorded_at: null,
    dispute_reason: null,
    rating_a_before: null,
    rating_a_after: null,
    rating_b_before: null,
    rating_b_after: null,
    expires_at: later,
    created_at: earlier,
    settled_at: null,
    ...overrides,
  };
}

describe('describeRanked', () => {
  it('distinguishes incoming and outgoing challenges', () => {
    const outgoing = describeRanked(row({}), ME, NOW);
    assert.equal(outgoing.stage, 'outgoing');
    assert.equal(outgoing.canCancel, true);
    assert.equal(outgoing.opponentId, THEM);
    const incoming = describeRanked(row({}), THEM, NOW);
    assert.equal(incoming.stage, 'incoming');
    assert.equal(incoming.actionNeeded, true);
    assert.equal(incoming.opponentId, ME);
  });

  it('treats unrecorded challenges past their deadline as expired', () => {
    const view = describeRanked(row({ status: 'accepted', expires_at: earlier }), ME, NOW);
    assert.equal(view.stage, 'closed');
    assert.equal(view.label, 'Expired');
    assert.equal(view.canRecord, false);
  });

  it('lets either fighter record an accepted challenge', () => {
    assert.equal(describeRanked(row({ status: 'accepted' }), THEM, NOW).canRecord, true);
    assert.equal(describeRanked(row({ status: 'accepted', match_id: 'm1' }), ME, NOW).stage, 'analysing');
  });

  it('asks each fighter to confirm, then waits for the other', () => {
    const proposed = row({ status: 'awaiting_confirmation', match_id: 'm1', fighter_a_id: ME, fighter_b_id: THEM, winner_id: THEM, confirm_by: later });
    const mine = describeRanked(proposed, ME, NOW);
    assert.equal(mine.stage, 'confirm');
    assert.equal(mine.myResult, 'loss');
    assert.equal(mine.canDispute, true);
    const afterMine = describeRanked({ ...proposed, confirmed_a_at: earlier }, ME, NOW);
    assert.equal(afterMine.stage, 'waiting');
    assert.equal(afterMine.canConfirm, false);
    assert.equal(describeRanked({ ...proposed, confirmed_a_at: earlier }, THEM, NOW).stage, 'confirm');
  });

  it('is ready to settle when both confirmed or the window passed', () => {
    const both = row({ status: 'awaiting_confirmation', match_id: 'm1', fighter_a_id: ME, fighter_b_id: THEM, confirmed_a_at: earlier, confirmed_b_at: earlier, confirm_by: later });
    assert.equal(describeRanked(both, ME, NOW).canSettle, true);
    const lapsed = row({ status: 'awaiting_confirmation', match_id: 'm1', fighter_a_id: ME, fighter_b_id: THEM, winner_id: THEM, confirm_by: earlier });
    assert.equal(describeRanked(lapsed, THEM, NOW).stage, 'ready');
  });

  it("never auto-confirms the recorder's own win and drops it after 7 days", () => {
    const recorderWin = row({
      status: 'awaiting_confirmation',
      match_id: 'm1',
      fighter_a_id: ME,
      fighter_b_id: THEM,
      winner_id: ME,
      confirmed_a_at: earlier,
      confirm_by: earlier,
      recorded_at: '2026-10-25T12:00:00Z',
    });
    assert.equal(describeRanked(recorderWin, ME, NOW).stage, 'waiting');
    assert.equal(describeRanked(recorderWin, THEM, NOW).stage, 'confirm');
    assert.equal(describeRanked({ ...recorderWin, confirmed_b_at: earlier }, ME, NOW).stage, 'ready');
    const stale = { ...recorderWin, recorded_at: '2026-10-20T12:00:00Z' };
    assert.equal(describeRanked(stale, ME, NOW).label, 'Not confirmed in time, no rating change');
  });

  it('reports the settled result and rating change per fighter', () => {
    const settled = row({
      status: 'confirmed',
      fighter_a_id: ME,
      fighter_b_id: THEM,
      winner_id: ME,
      rating_a_before: 1000,
      rating_a_after: 1020,
      rating_b_before: 1000,
      rating_b_after: 980,
    });
    assert.equal(describeRanked(settled, ME, NOW).label, 'Won · +20');
    assert.equal(describeRanked(settled, THEM, NOW).label, 'Lost · -20');
    assert.equal(describeRanked({ ...settled, winner_id: null }, THEM, NOW).myResult, 'draw');
  });
});
