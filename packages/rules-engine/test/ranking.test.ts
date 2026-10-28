import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addMatch,
  analyzeMatch,
  emptyCareerTotals,
  expectedScore,
  type FighterState,
  newFighterState,
  parseTotals,
  previewMatch,
  rateMatch,
  RATING,
  settleRankedMatch,
  statLine,
  tierFor,
  titleById,
  unlockedTitles,
} from '../src/index.ts';

const s = (seconds: number) => seconds * 1000;
const fighter = (rating: number, games: number) => ({ rating, games });

describe('elo', () => {
  it('computes expected scores', () => {
    assert.equal(expectedScore(1000, 1000), 0.5);
    assert.equal(Number(expectedScore(1200, 1000).toFixed(3)), 0.76);
    assert.equal(Number((expectedScore(1200, 1000) + expectedScore(1000, 1200)).toFixed(10)), 1);
  });

  it('uses the placement K-factor and the finish multiplier', () => {
    const equal = { A: fighter(1000, 0), B: fighter(1000, 0) };
    assert.deepEqual(
      [rateMatch(equal, 'A', 'points').A.delta, rateMatch(equal, 'A', 'points').B.delta],
      [20, -20],
    );
    assert.equal(rateMatch(equal, 'B', 'submission').B.delta, 25);
    assert.equal(rateMatch(equal, 'B', 'technical_superiority').B.delta, 23);
  });

  it('uses the standard and elite K-factors', () => {
    assert.equal(rateMatch({ A: fighter(1100, 10), B: fighter(1100, 30) }, 'A', 'points').A.delta, 12);
    assert.equal(rateMatch({ A: fighter(1600, 40), B: fighter(1600, 40) }, 'A', 'points').A.delta, 8);
  });

  it('scores draws by expectation', () => {
    const draw = rateMatch({ A: fighter(1200, 20), B: fighter(1000, 20) }, null, 'draw');
    assert.equal(draw.A.delta, -6);
    assert.equal(draw.B.delta, 6);
    assert.equal(rateMatch({ A: fighter(1000, 20), B: fighter(1000, 20) }, null, 'draw').A.delta, 0);
  });

  it('always moves decisive results by a point and respects the floor', () => {
    const lopsided = rateMatch({ A: fighter(2000, 50), B: fighter(1000, 50) }, 'A', 'points');
    assert.equal(lopsided.A.delta, 1);
    assert.equal(lopsided.B.delta, -1);
    const floored = rateMatch({ A: fighter(RATING.floor, 50), B: fighter(900, 50) }, 'B', 'submission');
    assert.equal(floored.A.after, RATING.floor);
    assert.equal(floored.A.delta, 0);
  });

  it('previews win, draw and loss changes', () => {
    assert.deepEqual(previewMatch(fighter(1000, 0), fighter(1000, 0)), { win: 20, draw: 0, loss: -20 });
  });
});

describe('tiers', () => {
  it('starts new fighters in Bronze I placement', () => {
    const standing = tierFor(RATING.initial, 0);
    assert.equal(standing.label, 'Bronze I');
    assert.equal(standing.belt, 'White Belt');
    assert.equal(standing.placement, true);
    assert.equal(standing.placementRemaining, 5);
    assert.equal(standing.nextAt, 1050);
  });

  it('maps ratings to tiers, belts and divisions', () => {
    const cases: [number, string, string][] = [
      [400, 'Bronze III', 'White Belt'],
      [950, 'Bronze II', 'White Belt'],
      [1050, 'Silver III', 'Blue Belt'],
      [1199, 'Silver I', 'Blue Belt'],
      [1250, 'Gold II', 'Purple Belt'],
      [1350, 'Platinum III', 'Brown Belt'],
      [1499, 'Platinum I', 'Brown Belt'],
      [1500, 'Grandmaster', 'Black Belt'],
      [2400, 'Grandmaster', 'Black Belt'],
    ];
    for (const [rating, label, belt] of cases) {
      const standing = tierFor(rating, 20);
      assert.equal(standing.label, label, `rating ${rating}`);
      assert.equal(standing.belt, belt, `rating ${rating}`);
    }
  });

  it('reports progress through the division', () => {
    assert.equal(tierFor(1125, 20).progress, 0.5);
    assert.equal(tierFor(400, 20).progress, 0);
    assert.equal(tierFor(1600, 20).nextAt, null);
    assert.equal(tierFor(1600, 20).progress, 1);
  });
});

function bjjCard() {
  return analyzeMatch(
    'bjj',
    [
      { type: 'position', position: 'standing', t: 0, endT: s(20), confidence: 0.9 },
      { type: 'takedown', athlete: 'A', t: s(20), confidence: 0.9 },
      { type: 'position', position: 'closed_guard', athlete: 'B', t: s(21), endT: s(60), confidence: 0.9 },
      { type: 'sweep', athlete: 'B', t: s(60), confidence: 0.9 },
      { type: 'position', position: 'mount', athlete: 'B', t: s(60), endT: s(90), confidence: 0.9 },
      { type: 'position', position: 'back_control', athlete: 'B', t: s(90), endT: s(120), confidence: 0.9 },
      { type: 'submission', athlete: 'B', t: s(120), technique: 'rear naked choke', confidence: 0.95 },
    ],
    { durationMs: s(300), variant: 'ibjjf' },
  );
}

describe('career stats', () => {
  it('builds a stat line per fighter from a scorecard', () => {
    const card = bjjCard();
    const a = statLine(card, 'A');
    const b = statLine(card, 'B');
    assert.equal(a.outcome, 'loss');
    assert.equal(a.takedowns, 1);
    assert.equal(b.outcome, 'win');
    assert.equal(b.method, 'submission');
    assert.equal(b.sweeps, 1);
    assert.equal(b.backTakes, 1);
    assert.ok(b.controlMs >= s(60));
  });

  it('tracks records, finishes, streaks and upsets', () => {
    const card = bjjCard();
    let totals = emptyCareerTotals();
    totals = addMatch(totals, statLine(card, 'B'), 250);
    totals = addMatch(totals, statLine(card, 'B'), -50);
    assert.equal(totals.wins, 2);
    assert.equal(totals.submissionWins, 2);
    assert.equal(totals.currentStreak, 2);
    assert.equal(totals.biggestUpset, 250);
    totals = addMatch(totals, statLine(card, 'A'), 0);
    assert.equal(totals.losses, 1);
    assert.equal(totals.finishLosses, 1);
    assert.equal(totals.currentStreak, 0);
    assert.equal(totals.bestStreak, 2);
    assert.equal(totals.matches, 3);
  });

  it('parses stored totals defensively', () => {
    const totals = parseTotals({ wins: 3, takedowns: -4, sweeps: 'x', unknown: 9, controlMs: 1234.6 });
    assert.equal(totals.wins, 3);
    assert.equal(totals.takedowns, 0);
    assert.equal(totals.sweeps, 0);
    assert.equal(totals.controlMs, 1235);
    assert.equal('unknown' in totals, false);
    assert.deepEqual(parseTotals(null), emptyCareerTotals());
  });
});

describe('titles', () => {
  it('unlocks titles from career totals for the right discipline', () => {
    const totals = { ...emptyCareerTotals(), submissionWins: 5, takedowns: 25, fallWins: 3 };
    const bjj = unlockedTitles('bjj', totals, 1000);
    assert.ok(bjj.includes('submission_wizard'));
    assert.ok(bjj.includes('takedown_machine'));
    assert.ok(!bjj.includes('pinning_machine'), 'falls only count in wrestling');
    assert.ok(unlockedTitles('wrestling', totals, 1000).includes('pinning_machine'));
  });

  it('requires never being stopped for Iron Chin', () => {
    const tough = { ...emptyCareerTotals(), significantAbsorbed: 120 };
    assert.ok(unlockedTitles('mma', tough, 1000).includes('iron_chin'));
    assert.ok(!unlockedTitles('mma', { ...tough, koLosses: 1 }, 1000).includes('iron_chin'));
  });

  it('unlocks Grandmaster by rating and exposes progress', () => {
    assert.ok(unlockedTitles('bjj', emptyCareerTotals(), 1500).includes('grandmaster'));
    assert.deepEqual(titleById('veteran')?.progress({ ...emptyCareerTotals(), matches: 7 }, 1000), { value: 7, goal: 25 });
  });
});

describe('settleRankedMatch', () => {
  it('rates both fighters, updates totals and lists titles', () => {
    const veteranA: FighterState = { rating: 1300, games: 24, peakRating: 1320, totals: { ...emptyCareerTotals(), matches: 24 } };
    const newcomerB = newFighterState();
    const settled = settleRankedMatch(bjjCard(), { A: veteranA, B: newcomerB });

    assert.equal(settled.winner, 'B');
    assert.equal(settled.method, 'submission');
    // B: placement K 40 * finish 1.25 * (1 - E) where E(1000 vs 1300) ~ 0.151.
    assert.equal(settled.B.change.delta, 42);
    assert.equal(settled.B.rating, 1042);
    assert.equal(settled.B.games, 1);
    assert.equal(settled.B.peakRating, 1042);
    assert.equal(settled.B.totals.biggestUpset, 300);
    assert.ok(settled.B.titles.includes('giant_slayer'));

    assert.equal(settled.A.change.delta, -25);
    assert.equal(settled.A.peakRating, 1320);
    assert.equal(settled.A.totals.matches, 25);
    assert.ok(settled.A.titles.includes('veteran'));
  });
});
