'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { formatClock } from '@matiq/rules-engine';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { useMatch } from '@/features/analysis/useMatch';
import { useUserId } from '@/features/auth/AuthProvider';
import { createPost, useProfile } from '@/features/social/api';
import { errorMessage, isBannedError } from '@/lib/errors';
import { firstIssue, postSchema } from '@/lib/validation';
import { Button, Caption, Card, ErrorText, Heading, Loading, Screen, TextField, ToggleRow } from '@/ui/components';
import { colors, font } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

export default function ShareScreen() {
  useTheme();
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const userId = useUserId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const match = useMatch(matchId);
  const profile = useProfile(userId);
  const [body, setBody] = useState('');
  const [friendsOnly, setFriendsOnly] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (match.isPending || profile.isPending) return <Loading />;
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
      if (isBannedError(caught)) await queryClient.invalidateQueries({ queryKey: ['age-check'] });
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
          <View accessibilityRole="radiogroup" accessibilityLabel="Feature a highlight">
            {[null, ...highlights.map((_, index) => index)].map((index) => {
              const selected = highlight === index;
              const text = index === null ? 'No highlight' : `${formatClock(highlights[index]!.t)} · ${highlights[index]!.label}`;
              return (
                <Pressable
                  key={index ?? 'none'}
                  onPress={() => setHighlight(index)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  aria-checked={selected}
                  style={styles.option}
                >
                  {/* The ring shows the choice without relying on colour (WCAG 1.4.1). */}
                  <Ionicons aria-hidden name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.accent : colors.textMuted} />
                  <Text style={[font.body, styles.fill, selected && { fontWeight: '700' }]}>{text}</Text>
                </Pressable>
              );
            })}
          </View>
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
      <Button label="Cancel" variant="secondary" disabled={busy} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  fill: { flex: 1 },
});
