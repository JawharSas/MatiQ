import { useSignIn } from '@clerk/expo';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { useAuth } from '@/features/auth/AuthProvider';
import { clerkErrorCode, clerkErrorMessage } from '@/features/auth/clerk-errors';
import { AuthDivider, GoogleButton } from '@/features/auth/GoogleButton';
import { afterFailure, noThrottle, parseThrottle, remainingMs, THROTTLE_KEY, waitMessage } from '@/features/auth/sign-in-throttle';
import { errorMessage } from '@/lib/errors';
import { openSecureStorage } from '@/lib/storage';
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

/** What the sign-in still needs after the password (Clerk decides). */
type Step = 'password' | 'second-factor' | 'new-device';

const WRONG_CREDENTIALS = new Set(['form_identifier_not_found', 'form_password_incorrect', 'form_password_or_identifier_incorrect']);

export default function SignInScreen() {
  const router = useRouter();
  const { signIn } = useSignIn();
  const { accountError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<Step>('password');
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notCreated, setNotCreated] = useState(false);

  // After an age check that did not pass, say so here once more (neutrally).
  useEffect(() => {
    void ageCheckLocked().then(setNotCreated);
  }, []);

  /** Moves on to whatever Clerk asks for next; the session starts once it is complete. */
  const continueWith = async (): Promise<void> => {
    if (signIn.status === 'complete') {
      const { error: finishError } = await signIn.finalize();
      if (finishError) setError(clerkErrorMessage(finishError));
      return;
    }
    if (signIn.status === 'needs_second_factor') {
      setStep('second-factor');
      return;
    }
    if (signIn.status === 'needs_client_trust') {
      // A device Clerk hasn't seen: a code goes to the account's email.
      const { error: sendError } = await signIn.mfa.sendEmailCode();
      if (sendError) return setError(clerkErrorMessage(sendError));
      setStep('new-device');
      return;
    }
    setError('Sign-in did not complete. Please try again.');
  };

  const submitPassword = async () => {
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

    setBusy(true);
    try {
      const { error: authError } = await signIn.password({ emailAddress: parsedEmail.data, password });
      if (!authError) {
        storage.set(THROTTLE_KEY, JSON.stringify(noThrottle));
        await continueWith();
        return;
      }
      if (WRONG_CREDENTIALS.has(clerkErrorCode(authError))) {
        // A wrong password (or unknown email) counts towards the device lockout.
        const next = afterFailure(throttle, Date.now());
        storage.set(THROTTLE_KEY, JSON.stringify(next));
        const locked = remainingMs(next, Date.now());
        if (locked > 0) return setError(waitMessage(locked));
      }
      setError(clerkErrorMessage(authError));
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setError(null);
    const trimmed = code.replace(/\s/g, '');
    if (!trimmed) return setError('Enter the code.');
    setBusy(true);
    try {
      const { error: codeError } =
        step === 'new-device'
          ? await signIn.mfa.verifyEmailCode({ code: trimmed })
          : backupCode
            ? await signIn.mfa.verifyBackupCode({ code: trimmed })
            : await signIn.mfa.verifyTOTP({ code: trimmed });
      if (codeError) return setError(clerkErrorMessage(codeError));
      await continueWith();
    } finally {
      setBusy(false);
    }
  };

  const startOver = async () => {
    await signIn.reset();
    setStep('password');
    setCode('');
    setBackupCode(false);
    setError(null);
  };

  if (step !== 'password') {
    const title = step === 'new-device' ? 'Check your email' : 'Two-factor authentication';
    const body =
      step === 'new-device'
        ? `We sent a code to ${email || 'your email'} because this is a new device. Enter it to finish signing in.`
        : backupCode
          ? 'Enter one of the backup codes you saved when you turned on two-factor.'
          : 'Enter the 6-digit code from your authenticator app.';
    return (
      <Screen>
        <View style={styles.hero}>
          <LogoMark size={64} />
          <Text style={styles.stepTitle} accessibilityRole="header">
            {title}
          </Text>
        </View>
        <Card>
          <Body>{body}</Body>
          <TextField
            label={backupCode ? 'Backup code' : 'Code'}
            value={code}
            onChangeText={setCode}
            autoCapitalize="none"
            keyboardType={backupCode ? 'default' : 'number-pad'}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={backupCode ? 20 : 8}
          />
          <ErrorText>{error}</ErrorText>
          <Button label="Continue" onPress={() => void submitCode()} loading={busy} />
          {step === 'second-factor' ? (
            <Button
              label={backupCode ? 'Use the authenticator app' : 'Use a backup code'}
              variant="ghost"
              onPress={() => {
                setBackupCode((current) => !current);
                setCode('');
                setError(null);
              }}
            />
          ) : (
            <Button label="Send a new code" variant="ghost" onPress={() => void signIn.mfa.sendEmailCode()} />
          )}
        </Card>
        <Button label="Back" variant="secondary" disabled={busy} onPress={() => void startOver()} />
      </Screen>
    );
  }

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
      {accountError ? (
        <Card>
          <Body>{errorMessage(accountError)}</Body>
        </Card>
      ) : null}
      <GoogleButton onError={setGoogleError} onSecondFactor={() => setStep('second-factor')} />
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
        <Button label="Sign in" onPress={() => void submitPassword()} loading={busy} />
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
  stepTitle: { color: colors.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
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
