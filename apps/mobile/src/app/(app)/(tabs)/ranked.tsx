import { type Discipline, newFighterState, tierFor } from '@matiq/rules-engine';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { useUserId } from '@/features/auth/AuthProvider';
import { type PersonRow, rankedActions, type RatingRow, useRankedAction, useRankedMatches, usePeople, useRatings } from '@/features/ranked/api';
import { DISCIPLINE_LABELS, DISCIPLINE_OPTIONS, ProgressBar, TierBadge } from '@/features/ranked/components';
import { describeRanked, type RankedMatchRow, type RankedView } from '@/features/ranked/ranked-state';
import { Avatar } from '@/features/social/Avatar';
import { errorMessage } from '@/lib/errors';
import { readPreference, writePreference } from '@/lib/storage';
import {
  Badge,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  ErrorText,
  ListGroup,
  ListRow,
  Loading,
  Screen,
  SectionHeader,
  Segmented,
  StatTile,
} from '@/ui/components';
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
      <Button
        label="Find an opponent"
        icon="search"
        onPress={() => router.push({ pathname: '/ranked/opponents', params: { discipline } })}
      />
      <ListGroup>
        <ListRow
          icon="podium"
          title="Leaderboard"
          subtitle="Global and friends ladders"
          onPress={() => router.push({ pathname: '/ranked/leaderboard', params: { discipline } })}
        />
        <ListRow
          icon="ribbon"
          tone="warning"
          title="Titles"
          subtitle="Earned from your fight stats"
          onPress={() => router.push({ pathname: '/ranked/titles', params: { discipline } })}
        />
      </ListGroup>
      <ErrorText>{matches.error ? errorMessage(matches.error) : settle.error ? errorMessage(settle.error) : null}</ErrorText>

      {needsMe.length > 0 ? (
        <>
          <SectionHeader title="Needs you" action={<Badge label={String(needsMe.length)} tone="accent" />} />
          <ListGroup>
            {needsMe.map(({ row, view }) => (
              <RankedItem key={row.id} row={row} view={view} person={people.data?.get(view.opponentId)} />
            ))}
          </ListGroup>
        </>
      ) : null}

      <SectionHeader title="Ranked matches" />
      {rest.length === 0 ? (
        <EmptyState icon="trophy-outline" title="No ranked matches yet" body="Challenge a training partner to get your first rating." />
      ) : (
        <ListGroup>
          {rest.map(({ row, view }) => (
            <RankedItem key={row.id} row={row} view={view} person={people.data?.get(view.opponentId)} />
          ))}
        </ListGroup>
      )}
      <Caption>
        Results count once both fighters confirm. A loss or draw confirms itself after 72 hours without a dispute; a win you
        recorded only counts when your opponent confirms it.
      </Caption>
    </Screen>
  );
}

function Standing({ discipline, rating }: { discipline: Discipline; rating: RatingRow | undefined }) {
  const fallback = newFighterState();
  const current = rating?.rating ?? fallback.rating;
  const games = rating?.games ?? 0;
  const standing = tierFor(current, games);
  return (
    <Card style={styles.standing}>
      <View style={styles.standingRow}>
        <View style={{ gap: 2 }}>
          <Text style={[font.overline, { color: colors.textMuted, textTransform: 'uppercase' }]}>{DISCIPLINE_LABELS[discipline]} rating</Text>
          <Text style={styles.rating}>{current}</Text>
        </View>
        <TierBadge rating={current} games={games} />
      </View>
      {standing.nextAt !== null ? (
        <View style={{ gap: 6 }}>
          <ProgressBar label={`Progress to the next division at ${standing.nextAt}`} value={standing.progress} />
          <Caption>Next division at {standing.nextAt}</Caption>
        </View>
      ) : (
        <Caption>Top tier reached</Caption>
      )}
      {standing.placement ? <Body muted>{standing.placementRemaining} placement match(es) left: ratings move faster until then.</Body> : null}
      <View style={styles.stats}>
        <StatTile label="Record" value={rating ? `${rating.wins}-${rating.losses}-${rating.draws}` : '0-0-0'} />
        <StatTile label="Streak" value={rating?.current_streak ?? 0} tone={rating && rating.current_streak > 0 ? 'success' : undefined} />
        <StatTile label="Peak" value={rating?.peak_rating ?? current} />
      </View>
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
  const opensDetails = !view.canConfirm && ['waiting', 'disputed', 'confirmed', 'analysing'].includes(view.stage);
  const resultColor =
    view.stage === 'confirmed' && view.myDelta !== null ? (view.myDelta >= 0 ? colors.success : colors.danger) : colors.textMuted;
  const hasActions = view.canAccept || view.canRecord || view.canConfirm || view.canCancel;

  const content = (
    <>
      <View style={styles.itemHeader}>
        <Avatar path={person?.avatar_path} name={name} size={40} />
        <View style={styles.fill}>
          <Text style={styles.itemName} numberOfLines={1}>
            {name} <Text style={styles.itemDiscipline}>· {DISCIPLINE_LABELS[row.discipline]}</Text>
          </Text>
          <Text style={[font.caption, { color: resultColor, fontWeight: view.stage === 'confirmed' ? '700' : '400' }]}>{view.label}</Text>
        </View>
        {opensDetails ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} /> : null}
      </View>
      {row.message && view.stage === 'incoming' ? (
        <View style={styles.quote}>
          <Text style={[font.caption, { color: colors.text }]}>“{row.message}”</Text>
        </View>
      ) : null}
      {hasActions ? (
        <View style={styles.row}>
          {view.canAccept ? (
            <>
              <View style={styles.fill}>
                <Button label="Accept" size="sm" icon="checkmark" disabled={busy} onPress={() => respond.mutate([row.id, true])} />
              </View>
              <View style={styles.fill}>
                <Button label="Decline" size="sm" variant="secondary" disabled={busy} onPress={() => respond.mutate([row.id, false])} />
              </View>
            </>
          ) : null}
          {view.canRecord ? (
            <View style={styles.fill}>
              <Button label="Record it" size="sm" icon="videocam" onPress={() => router.push({ pathname: '/record', params: { ranked: row.id } })} />
            </View>
          ) : null}
          {view.canConfirm ? (
            <View style={styles.fill}>
              <Button label="Review result" size="sm" icon="checkmark-done" onPress={open} />
            </View>
          ) : null}
          {view.canCancel ? (
            <View style={styles.fill}>
              <Button label="Cancel" size="sm" variant="secondary" disabled={busy} onPress={() => cancel.mutate([row.id])} />
            </View>
          ) : null}
        </View>
      ) : null}
      <ErrorText>{error ? errorMessage(error) : null}</ErrorText>
    </>
  );

  // Only rows that open the match are pressable: a disabled wrapper would
  // also disable the Accept / Record buttons inside it for assistive tech.
  if (!opensDetails) return <View style={styles.item}>{content}</View>;
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surfaceRaised }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  fill: { flex: 1 },
  standing: { gap: 14 },
  standingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rating: { fontSize: 52, lineHeight: 58, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'], letterSpacing: -1.5 },
  stats: { flexDirection: 'row', gap: spacing.sm },
  item: { gap: spacing.md, paddingHorizontal: 14, paddingVertical: 14 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemName: { fontSize: 15, fontWeight: '700', color: colors.text },
  itemDiscipline: { fontWeight: '500', color: colors.textMuted },
  quote: { backgroundColor: colors.surfaceRaised, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
});
