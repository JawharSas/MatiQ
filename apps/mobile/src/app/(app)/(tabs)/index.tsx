import { useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { useFeed } from '@/features/social/api';
import { PostCard } from '@/features/social/PostCard';
import { errorMessage } from '@/lib/errors';
import { Body, Caption, ErrorText, Segmented } from '@/ui/components';
import { colors, spacing } from '@/ui/theme';

export default function FeedScreen() {
  const [scope, setScope] = useState<'community' | 'friends'>('community');
  const feed = useFeed({ friendsOnly: scope === 'friends' });
  const posts = feed.data?.pages.flat() ?? [];

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
      data={posts}
      keyExtractor={(post) => post.post_id}
      renderItem={({ item }) => <PostCard post={item} />}
      ListHeaderComponent={
        <View style={{ gap: spacing.md }}>
          <Segmented
            options={[
              { value: 'community', label: 'Community' },
              { value: 'friends', label: 'Friends' },
            ]}
            value={scope}
            onChange={setScope}
          />
          {feed.error ? <ErrorText>{errorMessage(feed.error)}</ErrorText> : null}
        </View>
      }
      ListEmptyComponent={
        feed.isPending ? undefined : (
          <View style={{ gap: spacing.sm }}>
            <Body>No posts yet.</Body>
            <Caption>Analyse a round and share your scorecard, or add friends to see theirs.</Caption>
          </View>
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
