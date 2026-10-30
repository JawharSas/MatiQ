import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { colors } from '@/ui/theme';
import { SignInError, useGoogleSignIn } from './oauth';

// Google's "G", rendered by scripts/brand-assets.cjs. Colours follow the dark
// theme of Google's sign-in branding guidelines.
const G = require('../../../assets/brand/google-g.png');
const GOOGLE_DARK = { background: '#131314', border: '#8E918F', text: '#E3E3E3' };

/**
 * "Continue with Google": signs in, or creates the account on first use.
 * `onSecondFactor` runs when the account has two-factor on.
 */
export function GoogleButton({ onError, onSecondFactor }: { onError: (message: string | null) => void; onSecondFactor?: () => void }) {
  const [busy, setBusy] = useState(false);
  const signInWithGoogle = useGoogleSignIn();

  const press = async () => {
    onError(null);
    setBusy(true);
    try {
      if ((await signInWithGoogle()) === 'second-factor') onSecondFactor?.();
    } catch (caught) {
      onError(caught instanceof SignInError ? caught.message : 'Google sign-in did not complete. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={() => void press()}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      {busy ? <ActivityIndicator color={GOOGLE_DARK.text} /> : <Image source={G} style={styles.logo} accessible={false} />}
      <Text style={styles.label}>Continue with Google</Text>
    </Pressable>
  );
}

/** "or continue with email" rule between the Google button and the form. */
export function AuthDivider({ label }: { label: string }) {
  return (
    <View style={styles.divider} accessibilityRole="text">
      <View style={styles.rule} />
      <Text style={styles.dividerLabel}>{label}</Text>
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 4 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  dividerLabel: { color: colors.textFaint, fontSize: 13, fontWeight: '600' },
  button: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: GOOGLE_DARK.border,
    backgroundColor: GOOGLE_DARK.background,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
  logo: { width: 20, height: 20 },
  label: { color: GOOGLE_DARK.text, fontSize: 16, fontWeight: '600', letterSpacing: 0.1 },
});
