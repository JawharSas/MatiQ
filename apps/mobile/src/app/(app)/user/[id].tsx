import { Stack, useLocalSearchParams } from 'expo-router';
import { Alert, View } from 'react-native';
import { z } from 'zod';
import { useUserId } from '@/features/auth/AuthProvider';
import { useFeed, useFriendAction, useProfile } from '@/features/social/api';
import { Avatar } from '@/features/social/Avatar';
import { PostCard } from '@/features/social/PostCard';
import { RankedSummary } from '@/features/ranked/components';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Caption, Card, ErrorText, Loading, Screen, Title } from '@/ui/components';
import { spacing } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

const paramsSchema = z.object({ id: z.string().uuid() });

export default function UserScreen() {
  useTheme();
  const params = paramsSchema.safeParse(useLocalSearchParams());
  if (!params.success) {
    return (
      <Screen>
        <ErrorText>Invalid profile link.</ErrorText>
      </Screen>
    );
  }
  return <UserProfile id={params.data.id} />;
}

function UserProfile({ id }: { id: string }) {
  useTheme();
  const me = useUserId();
  const profile = useProfile(id);
  const action = useFriendAction();
  const card = profile.data;
  // Posts are filtered by RLS: for a private non-friend this returns nothing.
  const posts = useFeed({ author: id });

  if (profile.isPending) return <Loading />;
  if (!card) {
    return (
      <Screen>
        <Body>This profile is not available.</Body>
      </Screen>
    );
  }

  const confirmBlock = () =>
    Alert.alert(`Block @${card.username}?`, 'They will no longer see your profile or posts, and any friendship is removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: () => action.mutate({ action: 'block', userId: id }) },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: `@${card.username}` }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
        <Avatar path={card.avatar_path} name={card.display_name} size={72} />
        <View style={{ flex: 1 }}>
          <Title>{card.display_name}</Title>
          <Caption>
            @{card.username} · {card.friend_count} {card.friend_count === 1 ? 'friend' : 'friends'} · {card.visibility === 'public' ? 'Public' : 'Private'}
          </Caption>
        </View>
      </View>
      {card.bio ? <Body>{card.bio}</Body> : null}
      <RankedSummary userId={id} />

      {id !== me ? (
        <Card>
          {card.relationship === 'none' ? (
            <Button label="Add friend" onPress={() => action.mutate({ action: 'request', userId: id })} loading={action.isPending} />
          ) : null}
          {card.relationship === 'outgoing' ? (
            <Button label="Cancel request" variant="secondary" onPress={() => action.mutate({ action: 'remove', userId: id })} />
          ) : null}
          {card.relationship === 'incoming' ? (
            <View style={{ gap: spacing.sm }}>
              <Button label="Accept friend request" onPress={() => action.mutate({ action: 'accept', userId: id })} />
              <Button label="Decline" variant="secondary" onPress={() => action.mutate({ action: 'decline', userId: id })} />
            </View>
          ) : null}
          {card.relationship === 'friend' ? (
            <Button label="Remove friend" variant="secondary" onPress={() => action.mutate({ action: 'remove', userId: id })} />
          ) : null}
          <Button label="Block" variant="danger" onPress={confirmBlock} />
          {action.error ? <ErrorText>{errorMessage(action.error)}</ErrorText> : null}
        </Card>
      ) : null}

      {card.can_view_content ? (
        (posts.data?.pages.flat() ?? []).map((post) => <PostCard key={post.post_id} post={post} />)
      ) : (
        <Card>
          <Body>This account is private.</Body>
          <Caption>Posts and sparring logs are only visible to approved friends.</Caption>
        </Card>
      )}
    </Screen>
  );
}
