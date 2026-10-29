import * as Linking from 'expo-linking';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AuthDivider, GoogleButton } from '@/features/auth/GoogleButton';
import { rememberConsentForSignup } from '@/features/legal/consent';
import { messageFor } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { firstIssue, signUpSchema } from '@/lib/validation';
import { LogoMark } from '@/ui/brand';
import { Body, Button, Caption, Card, ErrorText, Screen, TextField, Title, ToggleRow } from '@/ui/components';

export default function SignUpScreen() {
  const router = useRouter();
  const [form, setForm] = useState({
    email: '',
    password: '',
    username: '',
    displayName: '',
    acceptedTerms: false,
    acceptedPrivacy: false,
    confirmedAge: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setError(null);
    const parsed = signUpSchema.safeParse(form);
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return;
    }
    setBusy(true);
    try {
      await rememberConsentForSignup(parsed.data.email);
      const { error: authError } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: {
          // Only these two fields are read server side, and both are re-validated.
          data: { username: parsed.data.username, display_name: parsed.data.displayName },
          emailRedirectTo: Linking.createURL('/auth/callback'),
        },
      });
      if (authError) {
        setError(authError.status === 429 ? messageFor('rate_limited') : authError.message);
        return;
      }
      setSent(true);
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen>
        <View style={styles.header}>
          <LogoMark size={44} />
          <Title>Check your email</Title>
        </View>
        <Body>We sent a confirmation link to {form.email}. Open it on this device to finish creating your account.</Body>
        <Button label="Back to sign in" variant="secondary" onPress={() => router.replace('/sign-in')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <LogoMark size={44} />
        <Title>Create your account</Title>
      </View>
      <GoogleButton onError={setGoogleError} />
      <ErrorText>{googleError}</ErrorText>
      <AuthDivider label="or sign up with email" />
      <Card>
        <TextField label="Email" value={form.email} onChangeText={(v) => update('email', v)} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        <TextField
          label="Password (12+ characters, upper, lower, number, symbol)"
          value={form.password}
          onChangeText={(v) => update('password', v)}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
        />
        <TextField label="Username" value={form.username} onChangeText={(v) => update('username', v)} autoCapitalize="none" maxLength={24} />
        <TextField label="Display name" value={form.displayName} onChangeText={(v) => update('displayName', v)} maxLength={50} />
      </Card>
      <Card>
        <ToggleRow label="I accept the Terms of Service" value={form.acceptedTerms} onValueChange={(v) => update('acceptedTerms', v)} />
        <ToggleRow label="I accept the Privacy Policy" value={form.acceptedPrivacy} onValueChange={(v) => update('acceptedPrivacy', v)} />
        <ToggleRow
          label="I am at least 13 (or the minimum age in my country)"
          value={form.confirmedAge}
          onValueChange={(v) => update('confirmedAge', v)}
        />
        <Caption>
          Read the <Link href={{ pathname: '/legal/[doc]', params: { doc: 'terms' } }}>Terms</Link> and{' '}
          <Link href={{ pathname: '/legal/[doc]', params: { doc: 'privacy' } }}>Privacy Policy</Link>. Your data, profile and
          videos are never sold or shared with data brokers. New accounts are private.
        </Caption>
      </Card>
      <ErrorText>{error}</ErrorText>
      <Button label="Create account" onPress={() => void submit()} loading={busy} />
      <Button label="I already have an account" variant="secondary" onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 16 },
});
