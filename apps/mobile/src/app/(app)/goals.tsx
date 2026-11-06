'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useGoals, useSaveGoals } from '@/features/goals/api';
import { GOAL_KINDS, GOAL_NAMES, type GoalKind } from '@/features/goals/progress';
import { errorMessage } from '@/lib/errors';
import { Button, Caption, ErrorText, ListGroup, Loading, Screen, withPressFeedback } from '@/ui/components';
import { tapFeedback } from '@/ui/haptics';
import { Text } from '@/ui/text';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';
import { CONDENSED } from '@/ui/typography';

const MAX_TARGET = 100;
const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Weekly targets: a stepper per kind of goal, 0 turns it off. */
export default function GoalsScreen() {
  useTheme();
  const goals = useGoals();
  if (goals.isPending) return <Loading />;
  const initial = Object.fromEntries((goals.data ?? []).map((goal) => [goal.kind, goal.target])) as Partial<Record<GoalKind, number>>;
  return <GoalsEditor initial={initial} />;
}

function GoalsEditor({ initial }: { initial: Partial<Record<GoalKind, number>> }) {
  useTheme();
  const router = useRouter();
  const save = useSaveGoals();
  const [targets, setTargets] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const change = (kind: GoalKind, by: number) => {
    tapFeedback();
    setTargets((current) => ({ ...current, [kind]: Math.min(MAX_TARGET, Math.max(0, (current[kind] ?? 0) + by)) }));
  };

  const submit = async () => {
    setError(null);
    try {
      await save(targets);
      router.back();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <Screen>
      <Caption>Targets for each week, Monday to Sunday. The rounds you record fill them in. Set a goal to 0 to turn it off.</Caption>
      <ListGroup>
        {GOAL_KINDS.map((kind) => (
          <Stepper key={kind} kind={kind} value={targets[kind] ?? 0} onChange={(by) => change(kind, by)} />
        ))}
      </ListGroup>
      <ErrorText>{error}</ErrorText>
      <Button label="Save goals" icon="checkmark" onPress={submit} />
    </Screen>
  );
}

function Stepper({ kind, value, onChange }: { kind: GoalKind; value: number; onChange: (by: number) => void }) {
  useTheme();
  const name = GOAL_NAMES[kind];
  const title = capitalised(name.many);
  return (
    <View style={styles.row}>
      <View style={styles.fill}>
        <Text style={styles.title}>{title}</Text>
        <Text style={font.caption}>{name.hint}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Fewer ${name.many}`}
        disabled={value === 0}
        onPress={() => onChange(-1)}
        style={withPressFeedback([styles.step, value === 0 && styles.stepDisabled])}
      >
        <Ionicons name="remove" size={22} color={colors.text} aria-hidden />
      </Pressable>
      <Text style={[styles.value, value === 0 && styles.off]} accessibilityLiveRegion="polite" accessibilityLabel={`${title} goal: ${value === 0 ? 'off' : `${value} a week`}`}>
        {value === 0 ? 'Off' : value}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`More ${name.many}`}
        disabled={value >= MAX_TARGET}
        onPress={() => onChange(1)}
        style={withPressFeedback([styles.step, value >= MAX_TARGET && styles.stepDisabled])}
      >
        <Ionicons name="add" size={22} color={colors.text} aria-hidden />
      </Pressable>
    </View>
  );
}

const styles = themedStyles(() => ({
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 14, paddingVertical: 10, minHeight: 64 },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  step: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  stepDisabled: { opacity: 0.4 },
  value: { minWidth: 40, textAlign: 'center', fontFamily: CONDENSED, fontWeight: '800', fontSize: 22, color: colors.text, fontVariant: ['tabular-nums'] },
  off: { fontSize: 16, color: colors.textMuted },
}));
