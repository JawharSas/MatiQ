import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AuthDivider, GoogleButton } from '@/features/auth/GoogleButton';
import { messageFor } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { emailSchema } from '@/lib/validation';
import { LogoMark, Wordmark } from '@/ui/brand';
import { Button, Caption, Card, ErrorText, Screen, TextField } from '@/ui/components';
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

  const signIn = async () => {
    setError(null);
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success || password.length === 0) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: parsedEmail.data, password });
    setBusy(false);
    if (authError) {
      // One message for unknown email and wrong password: no account probing.
      setError(
        authError.status === 429
          ? messageFor('rate_limited')
          : 'Incorrect email or password, or the email is not confirmed yet.',
      );
    }
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
        <ErrorText>{error}</ErrorText>
        <Button label="Sign in" onPress={() => void signIn()} loading={busy} />
      </Card>
      <Button label="Create an account" variant="secondary" onPress={() => router.push('/sign-up')} />
      <Caption>
        By using MatIQ you agree to the <Link href={{ pathname: '/legal/[doc]', params: { doc: 'terms' } }}>Terms</Link> and{' '}
        <Link href={{ pathname: '/legal/[doc]', params: { doc: 'privacy' } }}>Privacy Policy</Link>. We never sell your data.
      </Caption>
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
