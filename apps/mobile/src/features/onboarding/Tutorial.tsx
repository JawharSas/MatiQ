'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import Ionicons from '@expo/vector-icons/Ionicons';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import { useA11y } from '@/features/accessibility/A11yProvider';
import { FightScore } from '@/features/analysis/FightScore';
import { TierBadge } from '@/features/ranked/components';
import { readPreference, writePreference } from '@/lib/storage';
import { LogoMark } from '@/ui/brand';
import { Button, Screen } from '@/ui/components';
import { tapFeedback } from '@/ui/haptics';
import { Text } from '@/ui/text';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';
import { CONDENSED } from '@/ui/typography';

type IconName = ComponentProps<typeof Ionicons>['name'];

const PREFERENCE = 'tutorial';

/** True once this device has finished or skipped the tutorial. */
export function tutorialSeen(): boolean {
  return readPreference(PREFERENCE, ['done', 'new'] as const, 'new') === 'done';
}

export function markTutorialSeen(): void {
  writePreference(PREFERENCE, 'done');
}

interface Step {
  title: string;
  body: string;
  art: 'logo' | 'record' | 'score' | 'ranked' | IconName;
}

export const TUTORIAL_STEPS: readonly Step[] = [
  {
    title: 'Welcome to MatIQ',
    body: 'Film your rounds and MatIQ scores them for you: points, positions, submissions and the moments that decided the match.',
    art: 'logo',
  },
  {
    title: 'Record a round',
    body: 'Tap + in the middle of the bar. Film live with your phone on a stand, or pick a video you already have. Choose BJJ, wrestling or MMA and the rules you train under.',
    art: 'record',
  },
  {
    title: 'See what decided it',
    body: 'Every round becomes a fight card: the score, how it ended, the key moments and the stats. Tap a moment to watch it again.',
    art: 'score',
  },
  {
    title: 'Climb the ranks',
    body: 'Challenge a training partner. When you both confirm the result, you earn a rating, move up the belts and unlock titles.',
    art: 'ranked',
  },
  {
    title: 'Share it, or keep it',
    body: 'Your matches stay private until you share one. Post to everyone or to friends only, and follow your training partners on the feed.',
    art: 'people',
  },
];

/**
 * The first-run tutorial: five short steps with Back, Next and Skip. Shown
 * once on each device after the age check and consent, and again from
 * Settings. Steps fade in unless reduced motion is on.
 */
export function Tutorial({ onDone }: { onDone: () => void }) {
  useTheme();
  const { reduceMotion } = useA11y();
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const step = TUTORIAL_STEPS[index] ?? TUTORIAL_STEPS[0]!;
  const last = index === TUTORIAL_STEPS.length - 1;

  useEffect(() => {
    // Screen readers hear the new step's title when it changes.
    if (index > 0) AccessibilityInfo.announceForAccessibility(`Step ${index + 1} of ${TUTORIAL_STEPS.length}: ${step.title}`);
    if (reduceMotion) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [index, reduceMotion, fade, step.title]);

  const go = (next: number) => {
    tapFeedback();
    setIndex(next);
  };
  const finish = () => {
    tapFeedback();
    markTutorialSeen();
    onDone();
  };

  return (
    <Screen>
      <View style={styles.top}>
        <Text style={styles.counter}>
          {index + 1} / {TUTORIAL_STEPS.length}
        </Text>
        {!last ? (
          <View style={styles.skip}>
            <Button label="Skip" variant="ghost" size="sm" onPress={finish} hint="Closes the tutorial" />
          </View>
        ) : null}
      </View>

      <Animated.View style={[styles.body, { opacity: fade }]}>
        <View style={styles.art}>
          <Art art={step.art} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {step.title}
        </Text>
        <Text style={styles.text}>{step.body}</Text>
      </Animated.View>

      <View style={styles.dots} aria-hidden>
        {TUTORIAL_STEPS.map((item, dot) => (
          <View key={item.title} style={[styles.dot, dot === index && styles.dotActive]} />
        ))}
      </View>
      <View style={styles.actions}>
        {index > 0 ? (
          <View style={styles.action}>
            <Button label="Back" variant="secondary" onPress={() => go(index - 1)} />
          </View>
        ) : null}
        <View style={styles.action}>
          <Button label={last ? 'Get started' : 'Next'} icon={last ? 'checkmark' : 'arrow-forward'} onPress={() => (last ? finish() : go(index + 1))} />
        </View>
      </View>
    </Screen>
  );
}

function Art({ art }: { art: Step['art'] }) {
  useTheme();
  if (art === 'logo') return <LogoMark size={112} />;
  if (art === 'record') {
    return (
      <View style={styles.recordButton} aria-hidden>
        <Ionicons name="add" size={48} color={colors.accentText} />
      </View>
    );
  }
  if (art === 'score') {
    return (
      <View style={styles.example}>
        <Text style={styles.exampleLabel}>Example</Text>
        <FightScore names={{ A: 'Alex', B: 'Jordan' }} points={{ A: 13, B: 2 }} winner="A" method="submission" at={290_000} />
      </View>
    );
  }
  if (art === 'ranked') {
    return (
      <View style={styles.rankedArt}>
        <View style={styles.circle} aria-hidden>
          <Ionicons name="trophy" size={52} color={colors.accent} />
        </View>
        <TierBadge rating={1250} games={12} />
      </View>
    );
  }
  return (
    <View style={styles.circle} aria-hidden>
      <Ionicons name={art} size={52} color={colors.accent} />
    </View>
  );
}

const styles = themedStyles(() => ({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  counter: { fontFamily: CONDENSED, fontWeight: '700', fontSize: 16, letterSpacing: 1, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  skip: { minWidth: 88 },
  body: { gap: spacing.lg, paddingTop: spacing.xl },
  art: { minHeight: 160, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: CONDENSED, fontWeight: '800', fontSize: 36, lineHeight: 40, letterSpacing: 0.3, textTransform: 'uppercase', color: colors.text },
  text: { ...font.body, fontSize: 17, lineHeight: 25, color: colors.textMuted },
  circle: { width: 120, height: 120, borderRadius: 60, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  recordButton: { width: 96, height: 84, borderRadius: 24, backgroundColor: colors.accentFill, alignItems: 'center', justifyContent: 'center' },
  example: { alignSelf: 'stretch', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14 },
  exampleLabel: { ...font.overline, textTransform: 'uppercase' },
  rankedArt: { alignItems: 'center', gap: spacing.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingTop: spacing.xl },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.control },
  dotActive: { width: 24, backgroundColor: colors.accentFill },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md },
  action: { flex: 1 },
}));
