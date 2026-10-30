'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/ui/text';
import { z } from 'zod';
import { useUserId } from '@/features/auth/AuthProvider';
import { VARIANT_LABELS } from '@/features/capture/MatchSetupForm';
import { rankedActions, useRankedAction, useRankedMatch, usePeople } from '@/features/ranked/api';
import { DISCIPLINE_LABELS } from '@/features/ranked/components';
import { describeRanked } from '@/features/ranked/ranked-state';
import { Avatar } from '@/features/social/Avatar';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Caption, Card, ErrorText, Heading, Loading, Screen, TextField } from '@/ui/components';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

const paramsSchema = z.object({ id: z.string().uuid() });

const METHOD_LABELS: Record<string, string> = {
  submission: 'submission',
  fall: 'fall',
  ko_tko: 'KO / TKO',
  technical_superiority: 'technical superiority',
  points: 'points',
  advantages: 'advantages',
  penalties: 'penalties',
  criteria: 'criteria',
  decision: 'projected decision',
  disqualification: 'disqualification',
  draw: 'draw',
};

export default function RankedMatchScreen() {
  useTheme();
  const params = paramsSchema.safeParse(useLocalSearchParams());
  if (!params.success) {
    return (
      <Screen>
        <ErrorText>Invalid ranked match link.</ErrorText>
      </Screen>
    );
  }
  return <RankedMatchView id={params.data.id} />;
}

function RankedMatchView({ id }: { id: string }) {
  useTheme();
  const userId = useUserId();
  const router = useRouter();
  const ranked = useRankedMatch(id);
  const row = ranked.data;
  const people = usePeople(row ? [row.challenger_id, row.opponent_id] : []);
  const confirm = useRankedAction(rankedActions.confirm);
  const dispute = useRankedAction(rankedActions.dispute);
  const respond = useRankedAction(rankedActions.respond);
  const [reason, setReason] = useState('');
  const [disputing, setDisputing] = useState(false);

  if (ranked.isPending) return <Loading />;
  if (!row) {
    return (
      <Screen>
        <Body>This ranked match is not available.</Body>
      </Screen>
    );
  }

  const view = describeRanked(row, userId);
  const nameOf = (uid: string | null) => (uid ? (people.data?.get(uid)?.display_name ?? 'Fighter') : 'Fighter');
  const fighterA = row.fighter_a_id ?? row.challenger_id;
  const fighterB = row.fighter_b_id ?? row.opponent_id;
  const error = confirm.error ?? dispute.error ?? respond.error;
  const result =
    view.myResult === null
      ? null
      : row.winner_id === null
        ? `Draw${row.result_method && row.result_method !== 'draw' ? ` (${METHOD_LABELS[row.result_method] ?? row.result_method})` : ''}`
        : `${nameOf(row.winner_id)} wins by ${METHOD_LABELS[row.result_method ?? ''] ?? row.result_method ?? 'decision'}`;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Ranked match' }} />
      <Card>
        <Caption>
          {DISCIPLINE_LABELS[row.discipline]} · {VARIANT_LABELS[row.variant] ?? row.variant}
        </Caption>
        {[fighterA, fighterB].map((uid, index) => (
          <View key={uid} style={styles.fighter}>
            <Avatar path={people.data?.get(uid)?.avatar_path} name={nameOf(uid)} size={40} />
            <View style={styles.fill}>
              <Text style={font.heading} numberOfLines={1}>
                {nameOf(uid)}
                {uid === userId ? ' (you)' : ''}
              </Text>
              <Caption>
                Fighter {index + 1}
                {row.fighter_a_id ? (index === 0 ? ' · recorded the match' : '') : ''}
              </Caption>
            </View>
            {row.status === 'confirmed' ? (
              <RatingChange
                before={index === 0 ? row.rating_a_before : row.rating_b_before}
                after={index === 0 ? row.rating_a_after : row.rating_b_after}
              />
            ) : null}
          </View>
        ))}
      </Card>

      <Card>
        <Heading>{view.label}</Heading>
        {result ? <Body>{result}</Body> : null}
        {row.message ? <Caption>“{row.message}”</Caption> : null}
        {row.status === 'disputed' && row.dispute_reason ? <Caption>Dispute: {row.dispute_reason}</Caption> : null}
        {row.match_id ? (
          <Button label="Watch recording & scorecard" variant="secondary" onPress={() => router.push({ pathname: '/match/[id]', params: { id: row.match_id! } })} />
        ) : null}
        {view.canAccept ? (
          <View style={styles.row}>
            <View style={styles.fill}>
              <Button label="Accept" disabled={respond.isPending} onPress={() => respond.mutate([row.id, true])} />
            </View>
            <View style={styles.fill}>
              <Button label="Decline" variant="secondary" disabled={respond.isPending} onPress={() => respond.mutate([row.id, false])} />
            </View>
          </View>
        ) : null}
        {view.canRecord ? <Button label="Record it" onPress={() => router.push({ pathname: '/record', params: { ranked: row.id } })} /> : null}
        {view.canConfirm ? (
          <>
            <Caption>
              Confirm only if the video is of this match and the result is right. Ratings change once both of you confirm; a loss or
              draw for the recorder also confirms itself after 72 hours without a dispute.
            </Caption>
            <Button label="Confirm result" loading={confirm.isPending} onPress={() => confirm.mutate([row.id])} />
          </>
        ) : null}
        {view.canDispute && !disputing ? <Button label="Dispute" variant="danger" onPress={() => setDisputing(true)} /> : null}
        {disputing ? (
          <>
            <TextField label="What's wrong?" value={reason} onChangeText={setReason} maxLength={280} multiline placeholder="e.g. wrong video, the sweep was mine" />
            <Button
              label="Send dispute"
              variant="danger"
              loading={dispute.isPending}
              disabled={reason.trim().length === 0}
              onPress={() => dispute.mutate([row.id, reason], { onSuccess: () => setDisputing(false) })}
            />
            <Button
              label="Cancel"
              variant="secondary"
              disabled={dispute.isPending}
              onPress={() => {
                setDisputing(false);
                setReason('');
              }}
            />
            <Caption>Disputed results are reviewed by the MatIQ team, who may watch the recording to decide.</Caption>
          </>
        ) : null}
        <ErrorText>{error ? errorMessage(error) : null}</ErrorText>
      </Card>
    </Screen>
  );
}

function RatingChange({ before, after }: { before: number | null; after: number | null }) {
  useTheme();
  if (before === null || after === null) return null;
  const delta = after - before;
  return (
    <View style={styles.change}>
      <Text style={styles.after}>{after}</Text>
      <Text style={{ color: delta >= 0 ? colors.success : colors.danger, fontWeight: '700' }}>
        {delta >= 0 ? '+' : ''}
        {delta}
      </Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  fighter: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fill: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  change: { alignItems: 'flex-end' },
  after: { color: colors.text, fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
}));
