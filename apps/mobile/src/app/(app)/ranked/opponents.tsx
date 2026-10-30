'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { type Discipline, previewMatch, variantsFor } from '@matiq/rules-engine';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/ui/text';
import { z } from 'zod';
import { useUserId } from '@/features/auth/AuthProvider';
import { type OpponentRow, rankedActions, useOpponents, useRankedAction, useRatings } from '@/features/ranked/api';
import { DISCIPLINE_LABELS, TierBadge } from '@/features/ranked/components';
import { VARIANT_LABELS } from '@/features/capture/MatchSetupForm';
import { Avatar } from '@/features/social/Avatar';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Caption, Card, ErrorText, Loading, Screen, Segmented, TextField } from '@/ui/components';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

const paramsSchema = z.object({ discipline: z.enum(['bjj', 'wrestling', 'mma']).catch('bjj') });

/**
 * Matchmaking: training partners closest to your rating (friends of any
 * privacy, plus public ranked fighters), with the projected rating change.
 */
export default function OpponentsScreen() {
  useTheme();
  const { discipline } = paramsSchema.parse(useLocalSearchParams());
  const userId = useUserId();
  const opponents = useOpponents(discipline);
  const ratings = useRatings(userId);
  const [variant, setVariant] = useState(variantsFor(discipline)[0] ?? 'ibjjf');
  const [message, setMessage] = useState('');

  if (opponents.isPending || ratings.isPending) return <Loading />;
  const mine = ratings.data?.find((row) => row.discipline === discipline);
  const me = { rating: mine?.rating ?? 1000, games: mine?.games ?? 0 };

  return (
    <Screen>
      <Stack.Screen options={{ title: `${DISCIPLINE_LABELS[discipline]} opponents` }} />
      <Card>
        <Caption>Ruleset for the challenge</Caption>
        <Segmented
          options={variantsFor(discipline).map((value) => ({ value, label: VARIANT_LABELS[value] ?? value }))}
          value={variant}
          onChange={setVariant}
        />
        <TextField label="Message (optional)" value={message} onChangeText={setMessage} maxLength={140} placeholder="Open mat Thursday?" />
      </Card>
      <ErrorText>{opponents.error ? errorMessage(opponents.error) : null}</ErrorText>
      {opponents.data?.length === 0 ? (
        <Body muted>No opponents found yet. Add training partners as friends, or check back as more fighters join ranked play.</Body>
      ) : null}
      {opponents.data?.map((opponent) => (
        <OpponentCard key={opponent.user_id} opponent={opponent} me={me} discipline={discipline} variant={variant} message={message} />
      ))}
    </Screen>
  );
}

function OpponentCard(props: {
  opponent: OpponentRow;
  me: { rating: number; games: number };
  discipline: Discipline;
  variant: string;
  message: string;
}) {
  useTheme();
  const router = useRouter();
  const challenge = useRankedAction(rankedActions.challenge);
  const { opponent } = props;
  const preview = previewMatch(props.me, { rating: opponent.rating, games: opponent.games });
  const sign = (value: number) => (value > 0 ? `+${value}` : String(value));

  return (
    <Card>
      <View style={styles.header}>
        <Avatar path={opponent.avatar_path} name={opponent.display_name} />
        <View style={styles.fill}>
          <Text style={font.heading} numberOfLines={1}>
            {opponent.display_name}
          </Text>
          <Caption>
            @{opponent.username}
            {opponent.is_friend ? ' · Friend' : ''}
          </Caption>
        </View>
        <Text style={styles.rating}>{opponent.rating}</Text>
      </View>
      <TierBadge rating={opponent.rating} games={opponent.games} />
      <Caption>
        Win {sign(preview.win)} · Draw {sign(preview.draw)} · Loss {sign(preview.loss)}
      </Caption>
      <ErrorText>{challenge.error ? errorMessage(challenge.error) : null}</ErrorText>
      <Button
        label={challenge.isSuccess ? 'Challenge sent' : 'Challenge'}
        loading={challenge.isPending}
        disabled={challenge.isSuccess}
        onPress={() =>
          challenge.mutate([
            { opponentId: opponent.user_id, discipline: props.discipline, variant: props.variant, message: props.message || undefined },
          ], { onSuccess: () => router.back() })
        }
      />
    </Card>
  );
}

const styles = themedStyles(() => ({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fill: { flex: 1 },
  rating: { fontSize: 22, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
}));
