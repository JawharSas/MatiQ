'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { Link, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { activityTarget, activityText } from '@/features/notifications/activity';
import { type ActivityItem, useActivity, useMarkActivityRead } from '@/features/notifications/api';
import { Avatar } from '@/features/social/Avatar';
import { timeAgo } from '@/features/social/PostCard';
import { errorMessage } from '@/lib/errors';
import { Button, EmptyState, ErrorText, LinkPressable, Loading } from '@/ui/components';
import { Text } from '@/ui/text';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

/**
 * Activity: friend requests, ranked challenges and results, likes and
 * comments, newest first. What was new when you opened it keeps its dot for
 * this visit; it is marked read on the server straight away.
 */
export default function ActivityScreen() {
  useTheme();
  const router = useRouter();
  const activity = useActivity();
  const markRead = useMarkActivityRead();
  const [newIds, setNewIds] = useState<Set<string> | null>(null);
  const marked = useRef(false);

  useEffect(() => {
    if (!activity.data || newIds) return;
    const unread = new Set(activity.data.filter((item) => !item.read_at).map((item) => item.id));
    setNewIds(unread);
    if (unread.size > 0 && !marked.current) {
      marked.current = true;
      void markRead().catch(() => undefined);
    }
  }, [activity.data, newIds, markRead]);

  if (activity.isPending) return <Loading label="Loading activity" />;

  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={activity.data ?? []}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <ActivityRow item={item} isNew={newIds?.has(item.id) ?? false} />}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      ListHeaderComponent={activity.error ? <ErrorText>{errorMessage(activity.error)}</ErrorText> : undefined}
      ListEmptyComponent={
        <EmptyState
          icon="notifications-outline"
          title="Nothing new yet"
          body="Friend requests, ranked challenges, likes and comments show up here."
          action={<Button label="Find friends" icon="people-outline" variant="secondary" onPress={() => router.push('/friends')} />}
        />
      }
    />
  );
}

function ActivityRow({ item, isNew }: { item: ActivityItem; isNew: boolean }) {
  useTheme();
  const target = activityTarget(item.kind, item.subject_id, item.actor_id);
  const sentence = `${item.actor_display_name} ${activityText(item.kind)}`;
  const body = (
    <>
      <View style={[styles.dot, !isNew && styles.dotHidden]} aria-hidden />
      <Avatar path={item.actor_avatar_path} name={item.actor_display_name} size={44} />
      <View style={styles.fill}>
        <Text style={font.body}>
          <Text style={styles.name}>{item.actor_display_name}</Text> {activityText(item.kind)}
        </Text>
        <Text style={font.caption}>{timeAgo(item.created_at)}</Text>
      </View>
    </>
  );
  const label = `${isNew ? 'New: ' : ''}${sentence} ${timeAgo(item.created_at)}`;
  if (!target) {
    return (
      <View style={styles.row} accessible accessibilityLabel={label}>
        {body}
      </View>
    );
  }
  return (
    <Link href={target} asChild>
      <LinkPressable accessibilityRole="link" accessibilityLabel={label} style={styles.row}>
        {body}
      </LinkPressable>
    </Link>
  );
}

const styles = themedStyles(() => ({
  list: { backgroundColor: colors.background },
  content: { paddingVertical: spacing.sm, flexGrow: 1 },
  fill: { flex: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 12, minHeight: 64 },
  name: { fontWeight: '700' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  dotHidden: { backgroundColor: 'transparent' },
  separator: { height: 1, marginLeft: spacing.lg + 8 + spacing.md + 44 + spacing.md, backgroundColor: colors.border },
}));
