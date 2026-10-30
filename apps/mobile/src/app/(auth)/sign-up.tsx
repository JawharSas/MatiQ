import { useSignUp } from '@clerk/expo';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { clerkErrorMessage } from '@/features/auth/clerk-errors';
import { AuthDivider, GoogleButton } from '@/features/auth/GoogleButton';
import { ageCheckLocked, lockAgeCheck, rememberBirthMonthForSignup } from '@/features/legal/age';
import { type BirthInput, meetsMinimumAge, parseBirthMonth } from '@/features/legal/age-rule';
import { BirthMonthField } from '@/features/legal/BirthMonthField';
import { rememberConsentForSignup } from '@/features/legal/consent';
import { firstIssue, signUpSchema } from '@/lib/validation';
import { LogoMark } from '@/ui/brand';
import { Body, Button, Caption, Card, Checkbox, ErrorText, inlineLink, Loading, Screen, TextField, Title } from '@/ui/components';

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp } = useSignUp();
  const [form, setForm] = useState({ email: '', password: '', username: '', displayName: '' });
  const [birth, setBirth] = useState<BirthInput>({ month: null, year: '' });
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState('');
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
      const { error: signUpError } = await signUp.password({
        emailAddress: parsed.data.email,
        password: parsed.data.password,
        legalAccepted: true,
        // Only these two fields are read server side (register_user), and both are re-validated.
        unsafeMetadata: { username: parsed.data.username, displayName: parsed.data.displayName },
      });
      if (signUpError) return setError(clerkErrorMessage(signUpError));
      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (sendError) return setError(clerkErrorMessage(sendError));
      setVerifying(true);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setError(null);
    const trimmed = code.replace(/\s/g, '');
    if (!trimmed) return setError('Enter the code from the email.');
    setBusy(true);
    try {
      const { error: codeError } = await signUp.verifications.verifyEmailCode({ code: trimmed });
      if (codeError) return setError(clerkErrorMessage(codeError));
      if (signUp.status !== 'complete') return setError('Sign-up did not complete. Please try again.');
      // Starts the session; the app then opens the new MatIQ account.
      const { error: finishError } = await signUp.finalize();
      if (finishError) setError(clerkErrorMessage(finishError));
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

  if (verifying) {
    return (
      <Screen>
        <View style={styles.header}>
          <LogoMark size={44} />
          <Title>Check your email</Title>
        </View>
        <Card>
          <Body>We sent a code to {form.email}. Enter it to finish creating your account.</Body>
          <TextField
            label="Code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={8}
          />
          <ErrorText>{error}</ErrorText>
          <Button label="Create account" onPress={() => void verify()} loading={busy} />
          <Button label="Send a new code" variant="ghost" disabled={busy} onPress={() => void signUp.verifications.sendEmailCode()} />
        </Card>
        <Button
          label="Back"
          variant="secondary"
          disabled={busy}
          onPress={() => {
            setVerifying(false);
            setCode('');
            setError(null);
          }}
        />
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
