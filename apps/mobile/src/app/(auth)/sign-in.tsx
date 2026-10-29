import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { useCaptcha } from '@/features/auth/Captcha';
import { AuthDivider, GoogleButton } from '@/features/auth/GoogleButton';
import { afterFailure, noThrottle, parseThrottle, remainingMs, THROTTLE_KEY, waitMessage } from '@/features/auth/sign-in-throttle';
import { messageFor } from '@/lib/errors';
import { openSecureStorage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { emailSchema } from '@/lib/validation';
import { LogoMark, Wordmark } from '@/ui/brand';
import { ageCheckLocked } from '@/features/legal/age';
import { Body, Button, Caption, Card, ErrorText, inlineLink, Screen, TextField } from '@/ui/components';
import { colors } from '@/ui/theme';

const HIGHLIGHTS: { icon: ComponentProps<typeof Ionicons>['name']; label: string }[] = [
  { icon: 'pulse', label: 'Live scoring' },
  { icon: 'trophy', label: 'Ranked ladder' },
  { icon: 'lock-closed', label: 'Private by default' },
];

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notCreated, setNotCreated] = useState(false);
  const captcha = useCaptcha();

  // After an age check that did not pass, say so here once more (neutrally).
  useEffect(() => {
    void ageCheckLocked().then(setNotCreated);
  }, []);

  const signIn = async () => {
    setError(null);
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success || password.length === 0) {
      setError('Enter your email and password.');
      return;
    }
    const storage = await openSecureStorage();
    const throttle = parseThrottle(storage.getString(THROTTLE_KEY));
    const wait = remainingMs(throttle, Date.now());
    if (wait > 0) return setError(waitMessage(wait));
    if (captcha.enabled && !captcha.token) return setError('Complete the security check first.');

    setBusy(true);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: parsedEmail.data,
      password,
      ...(captcha.token ? { options: { captchaToken: captcha.token } } : {}),
    });
    setBusy(false);
    captcha.reset();
    if (!authError) {
      storage.set(THROTTLE_KEY, JSON.stringify(noThrottle));
      return;
    }
    if (authError.status === 429) return setError(messageFor('rate_limited'));
    if (authError.status === 400) {
      // A wrong password (or unknown email) counts towards the device lockout.
      const next = afterFailure(throttle, Date.now());
      storage.set(THROTTLE_KEY, JSON.stringify(next));
      const locked = remainingMs(next, Date.now());
      if (locked > 0) return setError(waitMessage(locked));
    }
    // One message for unknown email and wrong password: no account probing.
    setError('Incorrect email or password, or the email is not confirmed yet.');
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <LogoMark size={92} />
        <Wordmark size={40} />
        <Text style={styles.tagline}>Your AI corner for BJJ, wrestling and MMA.</Text>
        <View style={styles.highlights}>
          {HIGHLIGHTS.map((item) => (
            <View key={item.label} style={styles.highlight}>
              <Ionicons name={item.icon} size={14} color={colors.accent} />
              <Text style={styles.highlightText}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>
      {notCreated ? (
        <Card>
          <Body>Sorry, we couldn't create a MatIQ account for you. If you already have one, sign in below.</Body>
        </Card>
      ) : null}
      <GoogleButton onError={setGoogleError} />
      <ErrorText>{googleError}</ErrorText>
      <AuthDivider label="or sign in with email" />
      <Card>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="password"
          autoComplete="current-password"
        />
        {captcha.element}
        <ErrorText>{error}</ErrorText>
        <Button label="Sign in" onPress={() => void signIn()} loading={busy} />
      </Card>
      <Button label="Create an account" variant="secondary" onPress={() => router.push('/sign-up')} />
      <Caption>
        By using MatIQ you agree to the{' '}
        <Link href={{ pathname: '/legal/[doc]', params: { doc: 'terms' } }} style={inlineLink}>
          Terms
        </Link>{' '}
        and{' '}
        <Link href={{ pathname: '/legal/[doc]', params: { doc: 'privacy' } }} style={inlineLink}>
          Privacy Policy
        </Link>
        . We never sell your data.
      </Caption>
      <Button label="Accessibility options" variant="ghost" icon="accessibility-outline" onPress={() => router.push('/accessibility')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 10, paddingTop: 32, paddingBottom: 12 },
  tagline: { color: colors.textMuted, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  highlights: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 6 },
  highlight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  highlightText: { color: colors.text, fontSize: 12, fontWeight: '600' },
});
