'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { titleById } from '@matiq/rules-engine';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { z } from 'zod';
import { useUserId } from '@/features/auth/AuthProvider';
import { type LeaderboardRow, useLeaderboard } from '@/features/ranked/api';
import { DISCIPLINE_LABELS, TierBadge } from '@/features/ranked/components';
import { Avatar } from '@/features/social/Avatar';
import { errorMessage } from '@/lib/errors';
import { Caption, ErrorText, Segmented } from '@/ui/components';
import { colors, font, radius, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

const paramsSchema = z.object({ discipline: z.enum(['bjj', 'wrestling', 'mma']).catch('bjj') });
const SCOPES = [
  { value: 'global', label: 'Everyone' },
  { value: 'friends', label: 'Friends' },
] as const;

export default function LeaderboardScreen() {
  useTheme();
  const { discipline } = paramsSchema.parse(useLocalSearchParams());
  const userId = useUserId();
  const [scope, setScope] = useState<'global' | 'friends'>('global');
  const board = useLeaderboard(discipline, scope);

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      data={board.data ?? []}
      keyExtractor={(row) => row.user_id}
      ListHeaderComponent={
        <View style={styles.header}>
          <Stack.Screen options={{ title: `${DISCIPLINE_LABELS[discipline]} ladder` }} />
          <Segmented options={SCOPES} value={scope} onChange={setScope} />
          <Caption>
            Fighters appear after 5 placement matches. Private accounts are only shown to their friends.
          </Caption>
          {board.error ? <ErrorText>{errorMessage(board.error)}</ErrorText> : null}
        </View>
      }
      ListEmptyComponent={board.isPending ? undefined : <Caption>No ranked fighters here yet.</Caption>}
      refreshControl={<RefreshControl refreshing={board.isRefetching} onRefresh={() => void board.refetch()} tintColor={colors.accent} />}
      renderItem={({ item }) => <LadderRow row={item} isMe={item.user_id === userId} />}
    />
  );
}

function LadderRow({ row, isMe }: { row: LeaderboardRow; isMe: boolean }) {
  useTheme();
  const title = row.featured_title ? titleById(row.featured_title) : undefined;
  return (
    <Link href={{ pathname: '/user/[id]', params: { id: row.user_id } }} asChild>
      {/* Flattened: Link asChild hands the style to an <a> on web, which rejects arrays. */}
      <Pressable accessibilityRole="link" style={StyleSheet.flatten([styles.row, isMe && styles.me])}>
        <Text style={styles.position}>{row.ladder_position}</Text>
        <Avatar path={row.avatar_path} name={row.display_name} size={36} />
        <View style={styles.fill}>
          <Text style={font.body} numberOfLines={1}>
            {row.display_name}
          </Text>
          <Caption>
            {row.wins}-{row.losses}-{row.draws}
            {title ? ` · ${title.name}` : ''}
          </Caption>
        </View>
        <View style={styles.right}>
          <Text style={styles.rating}>{row.rating}</Text>
          <TierBadge rating={row.rating} games={row.games} compact />
        </View>
      </Pressable>
    </Link>
  );
}

const styles = themedStyles(() => ({
  list: { padding: spacing.lg, gap: spacing.sm },
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  me: { borderWidth: 1, borderColor: colors.accent },
  position: { width: 32, color: colors.textMuted, fontWeight: '800', fontVariant: ['tabular-nums'] },
  fill: { flex: 1 },
  right: { alignItems: 'flex-end', gap: 2 },
  rating: { color: colors.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
}));
