import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { formatClock } from '@matiq/rules-engine';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import type { ComponentProps } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { MatchStatus } from '@/features/analysis/useMatch';
import { useUserId } from '@/features/auth/AuthProvider';
import { DISCIPLINE_LABELS } from '@/features/ranked/components';
import { errorMessage, fromPostgrest } from '@/lib/errors';
import { readCache, writeCache } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { Body, Caption, Card, ErrorText } from '@/ui/components';
import { colors, font, spacing } from '@/ui/theme';

interface MatchListItem {
  id: string;
  discipline: 'bjj' | 'wrestling' | 'mma';
  title: string;
  status: MatchStatus;
  duration_ms: number;
  recorded_at: string;
  athlete_a_label: string;
  athlete_b_label: string;
}

const STATUS: Record<MatchStatus, { label: string; color: string }> = {
  draft: { label: 'Draft', color: colors.textMuted },
  live: { label: 'Live', color: colors.accent },
  queued: { label: 'Queued', color: colors.warning },
  processing: { label: 'Analysing…', color: colors.warning },
  completed: { label: 'Analysed', color: colors.success },
  failed: { label: 'Failed', color: colors.danger },
};

const DISCIPLINE_ICONS: Record<MatchListItem['discipline'], ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  bjj: 'karate',
  wrestling: 'kabaddi',
  mma: 'boxing-glove',
};

export default function MatchesScreen() {
  const userId = useUserId();
  const cacheKey = `matches:${userId}`;
  const matches = useQuery({
    queryKey: ['my-matches'],
    placeholderData: readCache<MatchListItem[]>(cacheKey),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select('id, discipline, title, status, duration_ms, recorded_at, athlete_a_label, athlete_b_label')
        .eq('owner_id', userId)
        .order('recorded_at', { ascending: false })
        .limit(100);
      if (error) throw fromPostgrest(error);
      writeCache(cacheKey, data);
      return data as MatchListItem[];
    },
  });

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
      data={matches.data ?? []}
      keyExtractor={(match) => match.id}
      ListHeaderComponent={matches.error ? <ErrorText>{errorMessage(matches.error)}</ErrorText> : undefined}
      ListEmptyComponent={matches.isPending ? undefined : <Body muted>No matches yet. Record or upload a round from the Analyze tab.</Body>}
      refreshControl={<RefreshControl refreshing={matches.isRefetching} onRefresh={() => void matches.refetch()} tintColor={colors.accent} />}
      renderItem={({ item }) => {
        const title = item.title || `${item.athlete_a_label} vs ${item.athlete_b_label}`;
        const status = STATUS[item.status];
        const details = `${DISCIPLINE_LABELS[item.discipline]} · ${formatClock(item.duration_ms)} · ${new Date(item.recorded_at).toLocaleDateString()}`;
        return (
          <Link href={{ pathname: '/match/[id]', params: { id: item.id } }} asChild>
            <Pressable accessibilityRole="link" accessibilityLabel={`${title}, ${details}, ${status.label}`}>
              <Card>
                <View style={styles.row}>
                  <View style={styles.icon}>
                    <MaterialCommunityIcons name={DISCIPLINE_ICONS[item.discipline]} size={22} color={colors.accent} />
                  </View>
                  <View style={styles.text}>
                    <Text style={font.heading} numberOfLines={1}>
                      {title}
                    </Text>
                    <Caption>{details}</Caption>
                  </View>
                  <View style={[styles.status, { borderColor: status.color }]}>
                    <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                  </View>
                </View>
              </Card>
            </Pressable>
          </Link>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  text: { flex: 1, gap: 2 },
  status: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: '700' },
});
