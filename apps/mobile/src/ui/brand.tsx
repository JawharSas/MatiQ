import { Image, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

// Rendered from the vector mark by scripts/brand-assets.cjs.
const MARK = require('../../assets/brand/logo-mark.png');

/** The MatIQ mark: a fighter with both arms raised, inside the cage. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return <Image source={MARK} style={{ width: size, height: size }} accessibilityIgnoresInvertColors accessible={false} />;
}

/** "MatIQ" with the IQ in the accent colour. */
export function Wordmark({ size = 28 }: { size?: number }) {
  return (
    <Text style={[styles.wordmark, { fontSize: size, lineHeight: Math.round(size * 1.15) }]} accessibilityRole="header">
      Mat<Text style={styles.iq}>IQ</Text>
    </Text>
  );
}

/** Mark and wordmark side by side, e.g. in the Feed header. */
export function BrandLockup({ size = 22 }: { size?: number }) {
  return (
    <View style={styles.lockup} accessibilityLabel="MatIQ">
      <LogoMark size={Math.round(size * 1.35)} />
      <Wordmark size={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: { color: colors.text, fontWeight: '800', letterSpacing: -0.5 },
  iq: { color: colors.accent },
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
