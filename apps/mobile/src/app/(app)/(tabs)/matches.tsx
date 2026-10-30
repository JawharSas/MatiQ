'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { formatClock } from '@matiq/rules-engine';
import { Link, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { Text } from '@/ui/text';
import { byMonth, type Outcome, outcomeOf, recordText, summarize } from '@/features/analysis/match-record';
import type { MatchStatus } from '@/features/analysis/useMatch';
import { type MatchListItem, useMyMatches } from '@/features/analysis/useMyMatches';
import { DISCIPLINE_LABELS } from '@/features/ranked/components';
import { errorMessage } from '@/lib/errors';
import { Button, Caption, Card, EmptyState, ErrorText, StatTile } from '@/ui/components';
import { colors, font, radius, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

const statusLabels = (): Record<MatchStatus, { label: string; color: string }> => ({
  draft: { label: 'Draft', color: colors.textMuted },
  live: { label: 'Live', color: colors.accent },
  queued: { label: 'Queued', color: colors.warning },
  processing: { label: 'Analysing…', color: colors.warning },
  completed: { label: 'Analysed', color: colors.success },
  failed: { label: 'Failed', color: colors.danger },
});

const outcomes = (): Record<Outcome, { label: string; color: string; background: string }> => ({
  won: { label: 'Won', color: colors.success, background: colors.successSoft },
  lost: { label: 'Lost', color: colors.danger, background: colors.dangerSoft },
  draw: { label: 'Draw', color: colors.textMuted, background: colors.surfaceHigh },
});

const DISCIPLINE_ICONS: Record<MatchListItem['discipline'], ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  bjj: 'karate',
  wrestling: 'kabaddi',
  mma: 'boxing-glove',
};

type Row = { kind: 'month'; month: string } | { kind: 'match'; match: MatchListItem };

export default function MatchesScreen() {
  useTheme();
  const router = useRouter();
  const matches = useMyMatches();
  const list = matches.data ?? [];
  const summary = summarize(list);
  const rows: Row[] = byMonth(list, (match) => match.recorded_at).flatMap((group) => [
    { kind: 'month' as const, month: group.month },
    ...group.items.map((match) => ({ kind: 'match' as const, match })),
  ]);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      data={rows}
      keyExtractor={(row) => (row.kind === 'month' ? `month:${row.month}` : row.match.id)}
      ListHeaderComponent={
        <View style={styles.header}>
          {matches.error ? <ErrorText>{errorMessage(matches.error)}</ErrorText> : null}
          {list.length > 0 ? (
            <>
              <View style={styles.tiles}>
                <StatTile label="Matches" value={summary.total} />
                <StatTile label="Record" value={recordText(summary)} tone="accent" />
                <StatTile label="Analysed" value={summary.analysed} />
              </View>
              <Caption>Record is wins, losses and draws for Fighter 1: you.</Caption>
            </>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        matches.isPending ? undefined : (
          <EmptyState
            icon="videocam"
            title="No matches yet"
            body="Record a round or upload a video, and MatIQ scores it for you."
            action={<Button label="Analyze a round" icon="videocam" onPress={() => router.push('/record')} />}
          />
        )
      }
      refreshControl={<RefreshControl refreshing={matches.isRefetching} onRefresh={() => void matches.refetch()} tintColor={colors.accent} />}
      renderItem={({ item: row }) =>
        row.kind === 'month' ? (
          <Text style={[font.overline, styles.month]} accessibilityRole="header">
            {row.month.toUpperCase()}
          </Text>
        ) : (
          <MatchRow match={row.match} />
        )}
    />
  );
}

function MatchRow({ match }: { match: MatchListItem }) {
  useTheme();
  const title = match.title || `${match.athlete_a_label} vs ${match.athlete_b_label}`;
  const details = `${DISCIPLINE_LABELS[match.discipline]} · ${formatClock(match.duration_ms)} · ${new Date(match.recorded_at).toLocaleDateString()}`;
  const outcome = match.status === 'completed' ? outcomeOf(match.result) : null;
  const status = statusLabels()[match.status];

  return (
    <Link href={{ pathname: '/match/[id]', params: { id: match.id } }} asChild>
      <Pressable accessibilityRole="link" style={({ pressed }) => pressed && { opacity: 0.85 }}>
        <Card style={outcome ? { borderLeftWidth: 3, borderLeftColor: outcomes()[outcome].color } : undefined}>
          <View style={styles.row}>
            <View style={styles.icon} aria-hidden>
              <MaterialCommunityIcons name={DISCIPLINE_ICONS[match.discipline]} size={22} color={colors.accent} />
            </View>
            <View style={styles.text}>
              <Text style={font.heading} numberOfLines={1}>
                {title}
              </Text>
              <Caption>{details}</Caption>
            </View>
            {outcome && match.totals ? (
              <View style={styles.result}>
                <Text style={styles.score}>
                  {match.totals.A.points}–{match.totals.B.points}
                </Text>
                <View style={[styles.pill, { backgroundColor: outcomes()[outcome].background }]}>
                  <Text style={[styles.pillText, { color: outcomes()[outcome].color }]}>{outcomes()[outcome].label}</Text>
                </View>
              </View>
            ) : (
              <View style={[styles.pill, styles.outlined, { borderColor: status.color }]}>
                <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
              </View>
            )}
          </View>
        </Card>
      </Pressable>
    </Link>
  );
}

const styles = themedStyles(() => ({
  header: { gap: spacing.sm },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  month: { marginTop: spacing.sm, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  text: { flex: 1, gap: 2 },
  result: { alignItems: 'flex-end', gap: 4 },
  score: { fontSize: 18, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  pill: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  outlined: { borderWidth: 1 },
  pillText: { fontSize: 12, fontWeight: '700' },
}));
