import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useDeferredValue, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { type FriendEntry, searchProfiles, useFriendAction, useFriends } from '@/features/social/api';
import { errorMessage } from '@/lib/errors';
import { Button, Caption, Card, ErrorText, Heading, Screen, TextField } from '@/ui/components';
import { font, spacing } from '@/ui/theme';

export default function FriendsScreen() {
  const friends = useFriends();
  const action = useFriendAction();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query.trim());
  const results = useQuery({
    queryKey: ['profile-search', deferred],
    queryFn: () => searchProfiles(deferred),
    enabled: deferred.length >= 2,
  });

  const groups: { title: string; entries: FriendEntry[] }[] = [
    { title: 'Requests', entries: friends.data?.filter((f) => f.direction === 'incoming') ?? [] },
    { title: 'Friends', entries: friends.data?.filter((f) => f.direction === 'friend') ?? [] },
    { title: 'Sent', entries: friends.data?.filter((f) => f.direction === 'outgoing') ?? [] },
  ];

  return (
    <Screen>
      <TextField label="Find athletes" value={query} onChangeText={setQuery} autoCapitalize="none" maxLength={40} placeholder="username or name" />
      {results.data?.map((profile) => (
        <ProfileLink key={profile.user_id} id={profile.user_id} name={profile.display_name} username={profile.username} />
      ))}
      {friends.error ? <ErrorText>{errorMessage(friends.error)}</ErrorText> : null}
      {action.error ? <ErrorText>{errorMessage(action.error)}</ErrorText> : null}

      {groups.map((group) =>
        group.entries.length > 0 ? (
          <Card key={group.title}>
            <Heading>{group.title}</Heading>
            {group.entries.map((entry) => (
              <View key={entry.user_id} style={{ gap: spacing.sm }}>
                <ProfileLink id={entry.user_id} name={entry.display_name} username={entry.username} />
                {entry.direction === 'incoming' ? (
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Button label="Accept" onPress={() => action.mutate({ action: 'accept', userId: entry.user_id })} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button label="Decline" variant="secondary" onPress={() => action.mutate({ action: 'decline', userId: entry.user_id })} />
                    </View>
                  </View>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null,
      )}
      {friends.data?.length === 0 ? <Caption>No friends yet. Search for training partners above.</Caption> : null}
    </Screen>
  );
}

function ProfileLink({ id, name, username }: { id: string; name: string; username: string }) {
  return (
    <Link href={{ pathname: '/user/[id]', params: { id } }} asChild>
      <Pressable accessibilityRole="link" style={{ paddingVertical: spacing.xs }}>
        <Text style={font.body}>{name}</Text>
        <Caption>@{username}</Caption>
      </Pressable>
    </Link>
  );
}
