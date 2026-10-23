import { formatClock } from '@matiq/rules-engine';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useUserId } from '@/features/auth/AuthProvider';
import { errorMessage, fromPostgrest } from '@/lib/errors';
import { readCache, writeCache } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { Body, Caption, Card, ErrorText } from '@/ui/components';
import { colors, font, spacing } from '@/ui/theme';

interface MatchListItem {
  id: string;
  discipline: 'bjj' | 'wrestling' | 'mma';
  title: string;
  status: 'draft' | 'queued' | 'processing' | 'completed' | 'failed';
  duration_ms: number;
  recorded_at: string;
  athlete_a_label: string;
  athlete_b_label: string;
}

const STATUS_LABELS: Record<MatchListItem['status'], string> = {
  draft: 'Draft',
  queued: 'Queued',
  processing: 'Analysing…',
  completed: 'Analysed',
  failed: 'Failed',
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
      renderItem={({ item }) => (
        <Link href={{ pathname: '/match/[id]', params: { id: item.id } }} asChild>
          <Pressable accessibilityRole="link">
            <Card>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={font.heading}>{item.title || `${item.athlete_a_label} vs ${item.athlete_b_label}`}</Text>
                <Caption>{STATUS_LABELS[item.status]}</Caption>
              </View>
              <Caption>
                {item.discipline.toUpperCase()} · {formatClock(item.duration_ms)} · {new Date(item.recorded_at).toLocaleDateString()}
              </Caption>
            </Card>
          </Pressable>
        </Link>
      )}
    />
  );
}
