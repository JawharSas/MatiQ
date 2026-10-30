'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { Image, View } from 'react-native';
import { Text } from './text';
import { colors, isDarkTheme, themedStyles } from './theme';
import { useTheme } from './ThemeProvider';

// Rendered from the vector mark by scripts/brand-assets.cjs (a dark "M" for the Light theme).
const MARK = require('../../assets/brand/logo-mark.png');
const MARK_LIGHT = require('../../assets/brand/logo-mark-light.png');

/** The MatIQ mark: a fighter with both arms raised, inside the cage. */
export function LogoMark({ size = 40 }: { size?: number }) {
  useTheme();
  return (
    <Image
      source={isDarkTheme() ? MARK : MARK_LIGHT}
      style={{ width: size, height: size }}
      accessibilityIgnoresInvertColors
      accessible={false}
    />
  );
}

/** "MatIQ" with the IQ in the accent colour. */
export function Wordmark({ size = 28 }: { size?: number }) {
  useTheme();
  return (
    <Text style={[styles.wordmark, { fontSize: size, lineHeight: Math.round(size * 1.15) }]} accessibilityRole="header">
      Mat<Text style={styles.iq}>IQ</Text>
    </Text>
  );
}

/** Mark and wordmark side by side, e.g. in the Feed header. */
export function BrandLockup({ size = 22 }: { size?: number }) {
  useTheme();
  return (
    <View style={styles.lockup} accessibilityLabel="MatIQ">
      <LogoMark size={Math.round(size * 1.35)} />
      <Wordmark size={size} />
    </View>
  );
}

const styles = themedStyles(() => ({
  wordmark: { color: colors.text, fontWeight: '800', letterSpacing: -0.5 },
  iq: { color: colors.accent },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
}));
