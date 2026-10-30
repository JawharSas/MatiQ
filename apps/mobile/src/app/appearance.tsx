'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { Text } from '@/ui/text';
import { Caption, Card, Screen, usePressStyle } from '@/ui/components';
import { colors, font, PALETTES, radius, spacing, themedStyles, type ThemeName } from '@/ui/theme';
import { type ThemePreference, useTheme } from '@/ui/ThemeProvider';

const OPTIONS: { value: ThemePreference; title: string; description: string }[] = [
  { value: 'system', title: 'System', description: "Light or Dark, following your phone's setting" },
  { value: 'light', title: 'Light', description: 'Dark text on light surfaces, easy to read in daylight' },
  { value: 'dark', title: 'Dark', description: "MatIQ's classic look" },
  { value: 'midnight', title: 'Midnight', description: 'True black, gentle at night and on OLED screens' },
];

/** Theme: Light, Dark, Midnight or the phone's setting. Stored on this device. */
export default function AppearanceScreen() {
  const { preference, theme, setPreference } = useTheme();
  const pressStyle = usePressStyle();

  return (
    <Screen>
      <Card style={styles.list}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Theme">
          {OPTIONS.map((option, index) => {
            const selected = option.value === preference;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                aria-checked={selected}
                accessibilityLabel={`${option.title}. ${option.description}`}
                onPress={() => setPreference(option.value)}
                style={(state) => [styles.row, index > 0 && styles.divider, ...pressStyle(state)]}
              >
                <Swatch theme={option.value === 'system' ? null : option.value} />
                <View style={styles.text}>
                  <Text style={font.heading}>{option.title}</Text>
                  <Text style={font.caption}>{option.description}</Text>
                </View>
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={selected ? colors.accent : colors.control}
                  aria-hidden
                />
              </Pressable>
            );
          })}
        </View>
      </Card>
      <Caption>
        {preference === 'system' ? `Your phone is set to ${theme === 'light' ? 'light' : 'dark'} mode. ` : ''}
        Text size, contrast and motion are in Accessibility.
      </Caption>
    </Screen>
  );
}

/** A tiny screen in the theme's colours: background, a card, the accent. Half light, half dark for System. */
function Swatch({ theme }: { theme: ThemeName | null }) {
  useTheme();
  if (!theme) {
    return (
      <View style={[styles.swatch, styles.split]} aria-hidden>
        <View style={[styles.half, { backgroundColor: PALETTES.light.background }]}>
          <View style={[styles.miniCard, { backgroundColor: PALETTES.light.surface, borderColor: PALETTES.light.border }]} />
        </View>
        <View style={[styles.half, { backgroundColor: PALETTES.dark.background }]}>
          <View style={[styles.miniCard, { backgroundColor: PALETTES.dark.surface, borderColor: PALETTES.dark.border }]} />
        </View>
      </View>
    );
  }
  const palette = PALETTES[theme];
  return (
    <View style={[styles.swatch, { backgroundColor: palette.background }]} aria-hidden>
      <View style={[styles.miniCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={[styles.miniLine, { backgroundColor: palette.text }]} />
        <View style={[styles.miniButton, { backgroundColor: palette.accent }]} />
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  list: { padding: 0, gap: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, minHeight: 72 },
  divider: { borderTopWidth: 1, borderTopColor: colors.hairline },
  text: { flex: 1, gap: 2 },
  swatch: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  split: { flexDirection: 'row', padding: 0 },
  half: { flex: 1, padding: 4, justifyContent: 'center' },
  miniCard: { borderRadius: 6, borderWidth: 1, padding: 4, gap: 4, minHeight: 26, justifyContent: 'center' },
  miniLine: { height: 3, borderRadius: 2, width: '70%', opacity: 0.85 },
  miniButton: { height: 6, borderRadius: 3, width: '55%' },
}));
