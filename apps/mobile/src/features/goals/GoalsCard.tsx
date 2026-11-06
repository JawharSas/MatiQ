'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { useMyMatches } from '@/features/analysis/useMyMatches';
import { Body, Button, Card, Heading, ProgressBar } from '@/ui/components';
import { Text } from '@/ui/text';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';
import { CONDENSED } from '@/ui/typography';
import { useGoals } from './api';
import { daysLeft, GOAL_NAMES, goalStreak, weekProgress } from './progress';

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * This week's goals on your profile: each goal's progress, the days left and
 * your streak of weeks with every goal met. Without goals it offers to set
 * some.
 */
export function GoalsCard() {
  useTheme();
  const router = useRouter();
  const goals = useGoals();
  const matches = useMyMatches();
  const now = new Date();

  if (goals.isPending) return null;
  const list = goals.data ?? [];
  if (list.length === 0) {
    return (
      <Card>
        <Heading>Weekly goals</Heading>
        <Body muted>Set a target for each week: rounds, wins, takedowns and more. Your matches fill them in.</Body>
        <Button label="Set goals" icon="flag-outline" variant="secondary" onPress={() => router.push('/goals')} />
      </Card>
    );
  }

  const progress = weekProgress(list, matches.data ?? [], now);
  const streak = goalStreak(list, matches.data ?? [], now);
  const left = daysLeft(now);
  const allMet = progress.every((goal) => goal.met);

  return (
    <Card>
      <View style={styles.header}>
        <View style={styles.fill}>
          <Heading>This week</Heading>
          <Text style={font.caption}>{allMet ? 'Every goal met. Nice work.' : `${left} ${left === 1 ? 'day' : 'days'} left`}</Text>
        </View>
        {streak > 0 ? (
          <View style={styles.streak} accessible accessibilityLabel={`${streak}-week streak of meeting every goal`}>
            <Ionicons name="flame" size={16} color={colors.accent} aria-hidden />
            <Text style={styles.streakText}>{streak}-week streak</Text>
          </View>
        ) : null}
      </View>
      {progress.map((goal) => (
        <View key={goal.kind} style={styles.goal}>
          <View style={styles.goalRow}>
            <Text style={[font.body, styles.fill]}>{capitalised(GOAL_NAMES[goal.kind].many)}</Text>
            {goal.met ? <Ionicons name="checkmark-circle" size={18} color={colors.accent} aria-hidden /> : null}
            <Text style={styles.count}>
              {goal.done} / {goal.target}
            </Text>
          </View>
          <ProgressBar
            label={`${capitalised(GOAL_NAMES[goal.kind].many)}: ${goal.done} of ${goal.target}${goal.met ? ', met' : ''}`}
            value={goal.share}
            color={colors.accentFill}
          />
        </View>
      ))}
      <Button label="Edit goals" variant="secondary" size="sm" onPress={() => router.push('/goals')} />
    </Card>
  );
}

const styles = themedStyles(() => ({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.surfaceHigh,
  },
  streakText: { fontFamily: CONDENSED, fontWeight: '700', fontSize: 15, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.text },
  goal: { gap: 6 },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  count: { fontFamily: CONDENSED, fontWeight: '700', fontSize: 18, color: colors.text, fontVariant: ['tabular-nums'] },
}));
