import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatProgress, mainDiscipline, type ProgressMatch, progressSeries, trendSentence } from './progress-series.ts';

const NOW = new Date(2025, 10, 12);
const round = (month: number, day: number, points: number, winner: 'A' | 'B' | null, controlMs = 0, discipline = 'bjj'): ProgressMatch => ({
  discipline,
  recorded_at: new Date(2025, month, day, 18).toISOString(),
  result: { winner },
  totals: { A: { points } },
  stats: { topControlMs: { A: controlMs, B: 0 } },
});

const matches = [round(10, 3, 13, 'A', 90_000), round(10, 8, 6, 'B', 30_000), round(9, 20, 4, 'B', 15_000), round(7, 2, 9, 'A'), round(10, 9, 30, 'A', 0, 'mma')];

describe('progressSeries', () => {
  it('has the last six months, oldest first, empty months as null', () => {
    const series = progressSeries(matches, 'bjj', 'points', NOW, 6, 'en-US');
    assert.deepEqual(
      series.map((p) => p.key),
      ['2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11'],
    );
    assert.equal(series[0]!.value, null);
    assert.equal(series[0]!.label, 'Jun');
  });

  it('averages points per analysed round of that sport', () => {
    const series = progressSeries(matches, 'bjj', 'points', NOW, 6, 'en-US');
    assert.equal(series[5]!.value, 9.5);
    assert.equal(series[5]!.rounds, 2);
    assert.equal(series[4]!.value, 4);
    assert.equal(series[2]!.value, 9);
  });

  it('averages control time in seconds and gives win rate in percent', () => {
    assert.equal(progressSeries(matches, 'bjj', 'control', NOW)[5]!.value, 60);
    assert.equal(progressSeries(matches, 'bjj', 'win_rate', NOW)[5]!.value, 50);
    assert.equal(progressSeries(matches, 'bjj', 'win_rate', NOW)[4]!.value, 0);
  });

  it('skips rounds without a result', () => {
    const series = progressSeries([{ ...round(10, 1, 20, 'A'), result: null }], 'bjj', 'points', NOW);
    assert.equal(series[5]!.value, null);
  });
});

describe('formatting and summaries', () => {
  it('formats each metric', () => {
    assert.equal(formatProgress('points', 9.5), '9.5');
    assert.equal(formatProgress('points', 4), '4');
    assert.equal(formatProgress('control', 48), '48s');
    assert.equal(formatProgress('control', 95), '1:35');
    assert.equal(formatProgress('win_rate', 67), '67%');
  });

  it('compares the last two months with rounds', () => {
    const series = progressSeries(matches, 'bjj', 'points', NOW, 6, 'en-US');
    assert.equal(trendSentence(series, 'points'), 'Up from 4 in Oct.');
    assert.equal(trendSentence(progressSeries(matches, 'bjj', 'win_rate', NOW, 6, 'en-US'), 'win_rate'), 'Up from 0% in Oct.');
    assert.equal(trendSentence(progressSeries([], 'bjj', 'points', NOW), 'points'), null);
  });

  it('picks the sport with the most analysed rounds', () => {
    assert.equal(mainDiscipline(matches), 'bjj');
    assert.equal(mainDiscipline([round(10, 1, 1, 'A', 0, 'mma')]), 'mma');
    assert.equal(mainDiscipline([]), 'bjj');
  });
});
