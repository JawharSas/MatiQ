import { parseTotals, TITLES, isUnlocked } from '@matiq/rules-engine';
import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { z } from 'zod';
import { useUserId } from '@/features/auth/AuthProvider';
import { rankedActions, useRankedAction, useRatings, useTitles } from '@/features/ranked/api';
import { DISCIPLINE_LABELS, ProgressBar } from '@/features/ranked/components';
import { errorMessage } from '@/lib/errors';
import { Button, Caption, Card, ErrorText, Loading, Screen } from '@/ui/components';
import { colors, font, spacing } from '@/ui/theme';

const paramsSchema = z.object({ discipline: z.enum(['bjj', 'wrestling', 'mma']).catch('bjj') });

/** Every title, with progress from this discipline's ranked career. */
export default function TitlesScreen() {
  const { discipline } = paramsSchema.parse(useLocalSearchParams());
  const userId = useUserId();
  const ratings = useRatings(userId);
  const titles = useTitles(userId);
  const feature = useRankedAction(rankedActions.featureTitle);

  if (ratings.isPending || titles.isPending) return <Loading />;
  const row = ratings.data?.find((rating) => rating.discipline === discipline);
  const totals = parseTotals(row?.totals);
  const rating = row?.rating ?? 1000;
  const owned = new Map((titles.data ?? []).map((title) => [title.title_id, title]));
  const available = TITLES.filter((title) => title.disciplines.includes(discipline) || owned.has(title.id));

  return (
    <Screen>
      <Stack.Screen options={{ title: `${DISCIPLINE_LABELS[discipline]} titles` }} />
      <Caption>Titles are earned from confirmed ranked matches and kept for good. Feature one to show it on your profile and the ladder.</Caption>
      <ErrorText>{feature.error ? errorMessage(feature.error) : null}</ErrorText>
      {available.map((title) => {
        const unlocked = owned.get(title.id);
        const { value, goal } = title.progress(totals, rating);
        const blocked = !unlocked && value >= goal && !isUnlocked(title, totals, rating);
        return (
          <Card key={title.id} style={unlocked ? styles.unlocked : undefined}>
            <View style={styles.header}>
              <Text style={font.heading}>{title.name}</Text>
              {unlocked ? <Text style={styles.badge}>{unlocked.is_featured ? '★ Featured' : 'Unlocked'}</Text> : null}
            </View>
            <Caption>
              {title.description}
              {unlocked && !title.disciplines.includes(discipline) ? ` Earned in ${DISCIPLINE_LABELS[unlocked.discipline]}.` : ''}
            </Caption>
            {unlocked ? (
              <Button
                label={unlocked.is_featured ? 'Stop featuring' : 'Feature on profile'}
                variant="secondary"
                disabled={feature.isPending}
                onPress={() => feature.mutate([unlocked.is_featured ? null : title.id])}
              />
            ) : (
              <>
                <ProgressBar label={`Progress towards ${title.name}`} value={goal > 0 ? value / goal : 0} />
                <Caption>{blocked ? 'Requirement no longer met' : `${Math.min(value, goal)} / ${goal}`}</Caption>
              </>
            )}
          </Card>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  unlocked: { borderWidth: 1, borderColor: colors.accent },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  badge: { color: colors.accent, fontWeight: '800', fontSize: 12 },
});
