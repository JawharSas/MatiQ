'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { Stack, useLocalSearchParams } from 'expo-router';
import { Alert, View } from 'react-native';
import { z } from 'zod';
import { useUserId } from '@/features/auth/AuthProvider';
import { useFeed, useFriendAction, useProfile } from '@/features/social/api';
import { AthleteHeader } from '@/features/social/AthleteHeader';
import { PostCard } from '@/features/social/PostCard';
import { RankedSummary } from '@/features/ranked/components';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Caption, Card, ErrorText, Loading, Screen } from '@/ui/components';
import { themedStyles } from '@/ui/theme';
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
      <AthleteHeader
        avatarPath={card.avatar_path}
        displayName={card.display_name}
        username={card.username}
        tags={[
          { label: `${card.friend_count} ${card.friend_count === 1 ? 'friend' : 'friends'}`, icon: 'people-outline' },
          card.visibility === 'public' ? { label: 'Public', icon: 'globe-outline' } : { label: 'Private', icon: 'lock-closed' },
        ]}
        bio={card.bio}
      >
        {id !== me ? (
          <>
            {card.relationship === 'none' ? (
              <View style={styles.action}>
                <Button label="Add friend" size="sm" icon="person-add-outline" onPress={() => action.mutate({ action: 'request', userId: id })} loading={action.isPending} />
              </View>
            ) : null}
            {card.relationship === 'outgoing' ? (
              <View style={styles.action}>
                <Button label="Cancel request" variant="secondary" size="sm" onPress={() => action.mutate({ action: 'remove', userId: id })} />
              </View>
            ) : null}
            {card.relationship === 'incoming' ? (
              <>
                <View style={styles.action}>
                  <Button label="Accept friend request" size="sm" onPress={() => action.mutate({ action: 'accept', userId: id })} />
                </View>
                <View style={styles.action}>
                  <Button label="Decline" variant="secondary" size="sm" onPress={() => action.mutate({ action: 'decline', userId: id })} />
                </View>
              </>
            ) : null}
            {card.relationship === 'friend' ? (
              <View style={styles.action}>
                <Button label="Remove friend" variant="secondary" size="sm" onPress={() => action.mutate({ action: 'remove', userId: id })} />
              </View>
            ) : null}
            <View style={styles.action}>
              <Button label="Block" variant="danger" size="sm" onPress={confirmBlock} />
            </View>
          </>
        ) : null}
      </AthleteHeader>
      {action.error ? <ErrorText>{errorMessage(action.error)}</ErrorText> : null}
      <RankedSummary userId={id} />

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

const styles = themedStyles(() => ({
  action: { flexGrow: 1, flexBasis: 120 },
}));
