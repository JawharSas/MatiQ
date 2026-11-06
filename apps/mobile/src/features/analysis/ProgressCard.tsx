'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { useState } from 'react';
import { View } from 'react-native';
import { DISCIPLINE_OPTIONS } from '@/features/ranked/components';
import { Body, Caption, Card, Heading, Segmented } from '@/ui/components';
import { Text } from '@/ui/text';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';
import { CONDENSED } from '@/ui/typography';
import { formatProgress, mainDiscipline, type ProgressMatch, type ProgressMetric, progressSeries, trendSentence } from './progress-series';

const METRICS = [
  { value: 'points', label: 'Points' },
  { value: 'control', label: 'Control' },
  { value: 'win_rate', label: 'Win rate' },
] as const;

const TITLES: Record<ProgressMetric, string> = {
  points: 'Average points per round',
  control: 'Average time in control',
  win_rate: 'Win rate',
};

const SPORT_NAMES = { bjj: 'BJJ', wrestling: 'wrestling', mma: 'MMA' } as const;
const CHART_HEIGHT = 120;

/**
 * Your progress by month (last six) in one sport: average points, average
 * time in control or win rate, as bars, with a sentence comparing the last
 * two months. Screen readers hear every month's value.
 */
export function ProgressCard({ matches }: { matches: readonly ProgressMatch[] }) {
  useTheme();
  const [discipline, setDiscipline] = useState(() => mainDiscipline(matches));
  const [metric, setMetric] = useState<ProgressMetric>('points');
  const series = progressSeries(matches, discipline, metric, new Date());
  const values = series.flatMap((point) => (point.value === null ? [] : [point.value]));
  const max = Math.max(1, ...values, metric === 'win_rate' ? 100 : 0);
  const trend = trendSentence(series, metric);
  const spoken = `${TITLES[metric]}, ${SPORT_NAMES[discipline]}, by month: ${series
    .map((point) => `${point.label} ${point.value === null ? 'no rounds' : formatProgress(metric, point.value)}`)
    .join(', ')}.`;

  return (
    <Card>
      <Heading>Progress</Heading>
      <Segmented options={DISCIPLINE_OPTIONS} value={discipline} onChange={setDiscipline} />
      <Segmented options={METRICS} value={metric} onChange={setMetric} />
      <Text style={styles.title}>{TITLES[metric]}</Text>
      {values.length === 0 ? (
        <Body muted>No analysed {SPORT_NAMES[discipline]} rounds in the last six months.</Body>
      ) : (
        <View style={styles.chart} accessible accessibilityRole="image" accessibilityLabel={spoken}>
          {series.map((point, index) => {
            const latest = index === series.length - 1;
            return (
              <View key={point.key} style={styles.column} importantForAccessibility="no-hide-descendants">
                <View style={styles.barArea}>
                  {point.value === null ? (
                    <Text style={styles.none}>–</Text>
                  ) : (
                    <>
                      <Text style={styles.value}>{formatProgress(metric, point.value)}</Text>
                      <View style={[styles.bar, !latest && styles.barEarlier, { height: Math.max(4, (point.value / max) * CHART_HEIGHT) }]} />
                    </>
                  )}
                </View>
                <Text style={[font.caption, latest && styles.latestLabel]}>{point.label}</Text>
              </View>
            );
          })}
        </View>
      )}
      <Caption>{trend ?? 'Analyse rounds in two different months to see a trend.'}</Caption>
    </Card>
  );
}

const styles = themedStyles(() => ({
  title: { fontFamily: CONDENSED, fontWeight: '700', fontSize: 16, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.textMuted },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, paddingTop: spacing.sm },
  column: { flex: 1, alignItems: 'center', gap: 6 },
  barArea: { height: CHART_HEIGHT + 22, justifyContent: 'flex-end', alignItems: 'center', alignSelf: 'stretch', gap: 4 },
  bar: { alignSelf: 'stretch', borderRadius: 6, backgroundColor: colors.accentFill },
  // Earlier months in the text colour at lower strength, the latest in red.
  barEarlier: { backgroundColor: colors.textMuted },
  value: { fontFamily: CONDENSED, fontWeight: '700', fontSize: 14, color: colors.text, fontVariant: ['tabular-nums'] },
  none: { fontSize: 14, color: colors.textMuted },
  latestLabel: { color: colors.text, fontWeight: '700' },
}));
