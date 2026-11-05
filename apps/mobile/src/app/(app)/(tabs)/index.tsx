'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useFeed } from '@/features/social/api';
import { PostCard } from '@/features/social/PostCard';
import { errorMessage } from '@/lib/errors';
import { Button, EmptyState, ErrorText, Loading, TabBar } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

export default function FeedScreen() {
  useTheme();
  const router = useRouter();
  const [scope, setScope] = useState<'community' | 'friends'>('community');
  const feed = useFeed({ friendsOnly: scope === 'friends' });
  const posts = feed.data?.pages.flat() ?? [];

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xl, gap: spacing.md }}
      data={posts}
      keyExtractor={(post) => post.post_id}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={
        <View style={{ gap: spacing.md }}>
          <TabBar
            options={[
              { value: 'community', label: 'Community' },
              { value: 'friends', label: 'Friends' },
            ]}
            value={scope}
            onChange={setScope}
            label="Which posts to show"
          />
          {feed.error ? <ErrorText>{errorMessage(feed.error)}</ErrorText> : null}
        </View>
      }
      ListEmptyComponent={
        feed.isPending ? (
          <Loading label="Loading posts" inline />
        ) : (
          <EmptyState
            icon="newspaper-outline"
            title="No posts yet"
            body="Analyse a round and share your scorecard, or add friends to see theirs."
            action={
              <View style={{ gap: spacing.sm, alignSelf: 'stretch' }}>
                <Button label="Analyse a round" icon="videocam-outline" onPress={() => router.push('/record')} />
                <Button label="Find training partners" variant="secondary" icon="people-outline" onPress={() => router.push('/friends')} />
              </View>
            }
          />
        )
      }
      onEndReached={() => {
        if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
      }}
      onEndReachedThreshold={0.5}
      refreshControl={<RefreshControl refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()} tintColor={colors.accent} />}
      removeClippedSubviews
      windowSize={7}
    />
  );
}
