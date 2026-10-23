import { formatClock } from '@matiq/rules-engine';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { useMatch } from '@/features/analysis/useMatch';
import { useAuth, useUserId } from '@/features/auth/AuthProvider';
import { createPost, useProfile } from '@/features/social/api';
import { errorMessage } from '@/lib/errors';
import { firstIssue, postSchema } from '@/lib/validation';
import { Button, Caption, Card, ErrorText, Heading, Loading, Screen, TextField, ToggleRow } from '@/ui/components';
import { colors, font } from '@/ui/theme';

export default function ShareScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const userId = useUserId();
  const { session } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const match = useMatch(matchId);
  const profile = useProfile(userId);
  const [body, setBody] = useState('');
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!session || match.isPending || profile.isPending) return <Loading />;
  const highlights = match.data?.analysis?.scorecard.highlights ?? [];
  const isPublic = profile.data?.visibility === 'public';

  const share = async () => {
    const parsed = postSchema.safeParse({ body, friendsOnly: friendsOnly || !isPublic });
    if (!parsed.success) return setError(firstIssue(parsed.error));
    const chosen = highlight === null ? undefined : highlights[highlight];
    setBusy(true);
    try {
      await createPost({
        matchId,
        body: parsed.data.body,
        friendsOnly: parsed.data.friendsOnly,
        ...(chosen ? { highlight: { start: chosen.start, end: Math.min(chosen.end, chosen.start + 60_000) } } : {}),
      });
      await queryClient.invalidateQueries({ queryKey: ['feed'] });
      router.back();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Heading>Share your scorecard</Heading>
      <TextField label="Caption" value={body} onChangeText={setBody} multiline maxLength={500} />
      {highlights.length > 0 ? (
        <Card>
          <Heading>Feature a highlight</Heading>
          {highlights.map((item, index) => (
            <Pressable key={item.t} onPress={() => setHighlight(highlight === index ? null : index)} accessibilityRole="radio" accessibilityState={{ checked: highlight === index }}>
              <Text style={[font.body, highlight === index && { color: colors.accent, fontWeight: '700' }]}>
                {formatClock(item.t)} · {item.label}
              </Text>
            </Pressable>
          ))}
        </Card>
      ) : null}
      <Card>
        <ToggleRow
          label="Friends only"
          value={friendsOnly || !isPublic}
          onValueChange={setFriendsOnly}
          disabled={!isPublic}
          description={
            isPublic
              ? 'Off: anyone signed in can see this post. On: only your friends.'
              : 'Your account is private, so only your friends can see this post.'
          }
        />
        <Caption>Viewers can open the scorecard{match.data?.has_video ? ' and video' : ''} of this match.</Caption>
      </Card>
      <ErrorText>{error}</ErrorText>
      <Button label="Post" onPress={() => void share()} loading={busy} />
    </Screen>
  );
}
