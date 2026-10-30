import { test } from 'node:test';
import { analyzeMatch, settleRankedMatch } from '@matiq/rules-engine';
import { fighterState, outcomeFor, parseStoredScorecard, toPayload } from './settlement.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const card = analyzeMatch(
  'wrestling',
  [{ type: 'takedown', athlete: 'B', t: 5000, confidence: 0.9 }],
  { durationMs: 120_000, variant: 'folkstyle' },
);

test('parseStoredScorecard accepts real scorecards of the right discipline only', () => {
  const stored = JSON.parse(JSON.stringify(card));
  assert(parseStoredScorecard(stored, 'wrestling') !== null, 'expected a valid scorecard');
  assert(parseStoredScorecard(stored, 'bjj') === null, 'discipline mismatch must be rejected');
  assert(parseStoredScorecard({ ...stored, result: { winner: 'C', method: 'points' } }, 'wrestling') === null, 'bad winner');
  assert(parseStoredScorecard({ ...stored, stats: undefined }, 'wrestling') === null, 'missing stats');
  assert(parseStoredScorecard(null, 'wrestling') === null, 'null');
});

test('fighterState defaults new fighters and keeps row versions', () => {
  assert(fighterState(null).state.rating === 1000 && fighterState(null).version === 0, 'new fighter');
  const row = { rating: 1210, games: 12, peak_rating: 1250, totals: { wins: 7, bogus: 'x' }, version: 12 };
  const { state, version } = fighterState(row);
  assert(state.rating === 1210 && state.totals.wins === 7 && version === 12, 'stored fighter');
});

test('toPayload matches the svc_apply_ranked_result contract', () => {
  const settled = settleRankedMatch(card, { A: fighterState(null).state, B: fighterState(null).state });
  const payloadB = toPayload(settled.B, outcomeFor('B', settled.winner));
  assert(payloadB.outcome === 'win' && payloadB.wins === 1 && payloadB.games === 1, 'winner payload');
  assert(payloadB.rating === 1020 && payloadB.delta === 20 && payloadB.streak === 1, 'rating change');
  const payloadA = toPayload(settled.A, outcomeFor('A', settled.winner));
  assert(payloadA.outcome === 'loss' && payloadA.losses === 1 && payloadA.rating === 980, 'loser payload');
  assert(outcomeFor('A', null) === 'draw', 'draw');
});
