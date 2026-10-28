import type { Discipline } from '@matiq/rules-engine';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '@/ui/theme';
import { useLiveScore } from './useLiveScore';

export interface LiveMatchInfo {
  id: string;
  discipline: Discipline;
  variant: string;
  athleteALabel: string;
  athleteBLabel: string;
}

/** Provisional score overlay shown while a live analysis is running. */
export function LiveScoreboard({ match }: { match: LiveMatchInfo }) {
  const live = useLiveScore(match);
  const card = live.scorecard;
  const lastLine = card?.scoreLog.at(-1);

  return (
    <View style={styles.board} pointerEvents="none" accessibilityLabel="Provisional live score">
      <Text style={styles.caption}>
        LIVE SCORE (provisional){live.pendingBatches > 0 ? ' · analysing…' : ''}
      </Text>
      {card ? (
        <>
          <View style={styles.row}>
            <Text style={[styles.score, { color: colors.athleteA }]} numberOfLines={1}>
              {match.athleteALabel} {card.totals.A.points}
            </Text>
            <Text style={styles.caption}>–</Text>
            <Text style={[styles.score, { color: colors.athleteB }]} numberOfLines={1}>
              {card.totals.B.points} {match.athleteBLabel}
            </Text>
          </View>
          {lastLine && match.discipline !== 'mma' ? (
            <Text style={styles.caption} numberOfLines={1}>
              Last: {lastLine.athlete === 'A' ? match.athleteALabel : match.athleteBLabel} · {lastLine.label}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.caption}>First results in under a minute…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    position: 'absolute',
    bottom: 120,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: 2,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  score: { fontSize: 20, fontWeight: '800', fontVariant: ['tabular-nums'], flexShrink: 1 },
  caption: { color: colors.text, fontSize: 12 },
});
