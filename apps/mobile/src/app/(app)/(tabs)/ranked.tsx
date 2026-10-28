import { type Discipline, newFighterState, tierFor } from '@matiq/rules-engine';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useUserId } from '@/features/auth/AuthProvider';
import { type PersonRow, rankedActions, type RatingRow, useRankedAction, useRankedMatches, usePeople, useRatings } from '@/features/ranked/api';
import { DISCIPLINE_LABELS, DISCIPLINE_OPTIONS, ProgressBar, TierBadge } from '@/features/ranked/components';
import { describeRanked, type RankedMatchRow, type RankedView } from '@/features/ranked/ranked-state';
import { Avatar } from '@/features/social/Avatar';
import { errorMessage } from '@/lib/errors';
import { readPreference, writePreference } from '@/lib/storage';
import { Body, Button, Caption, Card, ErrorText, Heading, Loading, Screen, Segmented } from '@/ui/components';
import { colors, font, spacing } from '@/ui/theme';

const DISCIPLINE_VALUES = DISCIPLINE_OPTIONS.map((option) => option.value);

export default function RankedScreen() {
  const userId = useUserId();
  const router = useRouter();
  const [discipline, setDiscipline] = useState<Discipline>(() => readPreference('ranked-discipline', DISCIPLINE_VALUES, 'bjj'));
  const ratings = useRatings(userId);
  const matches = useRankedMatches();
  const settle = useRankedAction(rankedActions.settle);
  const startSettle = settle.mutate;

  const items = useMemo(
    () => (matches.data ?? []).map((row) => ({ row, view: describeRanked(row, userId) })),
    [matches.data, userId],
  );
  const people = usePeople(items.map((item) => item.view.opponentId));

  // Results that are confirmed (or whose window passed) are settled once.
  const settling = useRef(new Set<string>());
  useEffect(() => {
    for (const { row, view } of items) {
      if (!view.canSettle || settling.current.has(row.id)) continue;
      settling.current.add(row.id);
      startSettle([row.id]);
    }
  }, [items, startSettle]);

  const choose = (next: Discipline) => {
    setDiscipline(next);
    writePreference('ranked-discipline', next);
  };

  if (matches.isPending || ratings.isPending) return <Loading />;

  const rating = ratings.data?.find((row) => row.discipline === discipline);
  const needsMe = items.filter((item) => item.view.actionNeeded);
  const rest = items.filter((item) => !item.view.actionNeeded);

  return (
    <Screen>
      <Segmented options={DISCIPLINE_OPTIONS} value={discipline} onChange={choose} />
      <Standing discipline={discipline} rating={rating} />
      <Card>
        <Button label="Find an opponent" onPress={() => router.push({ pathname: '/ranked/opponents', params: { discipline } })} />
        <View style={styles.row}>
          <View style={styles.fill}>
            <Button label="Leaderboard" variant="secondary" onPress={() => router.push({ pathname: '/ranked/leaderboard', params: { discipline } })} />
          </View>
          <View style={styles.fill}>
            <Button label="Titles" variant="secondary" onPress={() => router.push({ pathname: '/ranked/titles', params: { discipline } })} />
          </View>
        </View>
        <Caption>
          Ranked results count once both fighters confirm. A loss or draw confirms itself after 72 hours without a dispute; a win
          you recorded only counts when your opponent confirms it.
        </Caption>
      </Card>
      <ErrorText>{matches.error ? errorMessage(matches.error) : settle.error ? errorMessage(settle.error) : null}</ErrorText>
      {needsMe.length > 0 ? (
        <Card>
          <Heading>Needs you</Heading>
          {needsMe.map(({ row, view }) => (
            <RankedItem key={row.id} row={row} view={view} person={people.data?.get(view.opponentId)} />
          ))}
        </Card>
      ) : null}
      <Card>
        <Heading>Ranked matches</Heading>
        {rest.length === 0 ? <Caption>No other ranked matches yet. Challenge a training partner to get started.</Caption> : null}
        {rest.map(({ row, view }) => (
          <RankedItem key={row.id} row={row} view={view} person={people.data?.get(view.opponentId)} />
        ))}
      </Card>
    </Screen>
  );
}

function Standing({ discipline, rating }: { discipline: Discipline; rating: RatingRow | undefined }) {
  const fallback = newFighterState();
  const current = rating?.rating ?? fallback.rating;
  const games = rating?.games ?? 0;
  const standing = tierFor(current, games);
  return (
    <Card>
      <Caption>{DISCIPLINE_LABELS[discipline]} rating</Caption>
      <View style={styles.standingRow}>
        <Text style={styles.rating}>{current}</Text>
        <TierBadge rating={current} games={games} />
      </View>
      {standing.nextAt !== null ? (
        <>
          <ProgressBar value={standing.progress} />
          <Caption>Next division at {standing.nextAt}</Caption>
        </>
      ) : (
        <Caption>Top tier reached</Caption>
      )}
      {standing.placement ? <Body muted>{standing.placementRemaining} placement match(es) left: ratings move faster until then.</Body> : null}
      <Caption>
        {rating ? `${rating.wins}-${rating.losses}-${rating.draws} · streak ${rating.current_streak} · peak ${rating.peak_rating}` : 'No ranked matches yet'}
      </Caption>
    </Card>
  );
}

function RankedItem({ row, view, person }: { row: RankedMatchRow; view: RankedView; person: PersonRow | undefined }) {
  const router = useRouter();
  const respond = useRankedAction(rankedActions.respond);
  const cancel = useRankedAction(rankedActions.cancel);
  const name = person?.display_name ?? 'Fighter';
  const busy = respond.isPending || cancel.isPending;
  const error = respond.error ?? cancel.error;
  const open = () => router.push({ pathname: '/ranked/match/[id]', params: { id: row.id } });

  return (
    <View style={styles.item}>
      <View style={styles.itemHeader}>
        <Avatar path={person?.avatar_path} name={name} size={36} />
        <View style={styles.fill}>
          <Text style={font.body} numberOfLines={1}>
            {name} · {DISCIPLINE_LABELS[row.discipline]}
          </Text>
          <Text style={[font.caption, view.stage === 'confirmed' && view.myDelta !== null && { color: view.myDelta >= 0 ? colors.success : colors.danger }]}>
            {view.label}
          </Text>
        </View>
      </View>
      {row.message && view.stage === 'incoming' ? <Caption>“{row.message}”</Caption> : null}
      <View style={styles.row}>
        {view.canAccept ? (
          <>
            <View style={styles.fill}>
              <Button label="Accept" disabled={busy} onPress={() => respond.mutate([row.id, true])} />
            </View>
            <View style={styles.fill}>
              <Button label="Decline" variant="secondary" disabled={busy} onPress={() => respond.mutate([row.id, false])} />
            </View>
          </>
        ) : null}
        {view.canRecord ? (
          <View style={styles.fill}>
            <Button label="Record it" onPress={() => router.push({ pathname: '/record', params: { ranked: row.id } })} />
          </View>
        ) : null}
        {view.canConfirm || view.stage === 'waiting' || view.stage === 'disputed' || view.stage === 'confirmed' || view.stage === 'analysing' ? (
          <View style={styles.fill}>
            <Button label={view.canConfirm ? 'Review result' : 'Details'} variant={view.canConfirm ? 'primary' : 'secondary'} onPress={open} />
          </View>
        ) : null}
        {view.canCancel ? (
          <View style={styles.fill}>
            <Button label="Cancel" variant="secondary" disabled={busy} onPress={() => cancel.mutate([row.id])} />
          </View>
        ) : null}
      </View>
      <ErrorText>{error ? errorMessage(error) : null}</ErrorText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  fill: { flex: 1 },
  standingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rating: { fontSize: 44, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  item: { gap: spacing.sm, paddingVertical: spacing.xs },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
