import * as Linking from 'expo-linking';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { AuthDivider, GoogleButton } from '@/features/auth/GoogleButton';
import { ageCheckLocked, lockAgeCheck, rememberBirthMonthForSignup } from '@/features/legal/age';
import { type BirthInput, meetsMinimumAge, parseBirthMonth } from '@/features/legal/age-rule';
import { BirthMonthField } from '@/features/legal/BirthMonthField';
import { rememberConsentForSignup } from '@/features/legal/consent';
import { messageFor } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { firstIssue, signUpSchema } from '@/lib/validation';
import { LogoMark } from '@/ui/brand';
import { Body, Button, Caption, Card, Checkbox, ErrorText, inlineLink, Loading, Screen, TextField, Title } from '@/ui/components';

export default function SignUpScreen() {
  const router = useRouter();
  const [form, setForm] = useState({ email: '', password: '', username: '', displayName: '' });
  const [birth, setBirth] = useState<BirthInput>({ month: null, year: '' });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [blocked, setBlocked] = useState<boolean | null>(null);

  useEffect(() => {
    void ageCheckLocked().then(setBlocked);
  }, []);

  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    setError(null);
    const parsed = signUpSchema.safeParse({ ...form, agreed });
    if (!parsed.success) return setError(firstIssue(parsed.error));
    const birthMonth = parseBirthMonth(birth);
    if (!birthMonth.ok) return setError(birthMonth.error);
    if (!meetsMinimumAge(birthMonth.value)) {
      // COPPA: nothing is sent, and this device cannot simply retry with another date.
      await lockAgeCheck();
      setBlocked(true);
      return;
    }

    setBusy(true);
    try {
      await rememberConsentForSignup(parsed.data.email);
      await rememberBirthMonthForSignup(parsed.data.email, birthMonth.value);
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

  if (blocked === null) return <Loading />;

  if (blocked) {
    return (
      <Screen>
        <View style={styles.header}>
          <LogoMark size={44} />
          <Title>Account not created</Title>
        </View>
        <Body>Sorry, we can't create a MatIQ account for you.</Body>
        <Button label="Back to sign in" variant="secondary" onPress={() => router.replace('/sign-in')} />
      </Screen>
    );
  }

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
      <Caption>All fields are required.</Caption>
      <Card>
        <TextField label="Email" value={form.email} onChangeText={(v) => update('email', v)} autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
        <TextField
          label="Password (12+ characters, upper, lower, number, symbol)"
          value={form.password}
          onChangeText={(v) => update('password', v)}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
        />
        <TextField label="Username" value={form.username} onChangeText={(v) => update('username', v)} autoCapitalize="none" autoComplete={Platform.OS === 'web' ? 'username' : 'username-new'} maxLength={24} />
        <TextField label="Display name" value={form.displayName} onChangeText={(v) => update('displayName', v)} autoComplete="name" textContentType="name" maxLength={50} />
      </Card>
      <Card>
        <BirthMonthField value={birth} onChange={setBirth} />
      </Card>
      <Card>
        <Checkbox label="I agree to the Terms of Service and Privacy Policy" checked={agreed} onChange={setAgreed} />
        <Caption>
          Read the{' '}
          <Link href={{ pathname: '/legal/[doc]', params: { doc: 'terms' } }} style={inlineLink}>
            Terms of Service
          </Link>
          , the{' '}
          <Link href={{ pathname: '/legal/[doc]', params: { doc: 'privacy' } }} style={inlineLink}>
            Privacy Policy
          </Link>{' '}
          and the{' '}
          <Link href={{ pathname: '/legal/[doc]', params: { doc: 'copyright' } }} style={inlineLink}>
            Copyright Policy
          </Link>
          . Your data, profile and
          videos are never sold or shared with data brokers. New accounts are private.
        </Caption>
      </Card>
      <ErrorText>{error}</ErrorText>
      <Button label="Create account" onPress={() => void submit()} loading={busy} />
      <Button label="Cancel" variant="secondary" hint="Goes back to sign in" disabled={busy} onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 16 },
});
