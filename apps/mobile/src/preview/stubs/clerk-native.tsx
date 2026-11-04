'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

/**
 * Browser UI preview: stand-ins for Clerk's native AuthView and
 * UserProfileView (SwiftUI / Jetpack Compose, which don't run on the web).
 * They drive the in-memory backend's sample accounts so the walkthrough can
 * sign in, sign up and sign out through the app's real gates; the real
 * screens are Clerk's.
 */

import { type ReactElement, useState } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { previewSignIn, previewSignOut, previewSignUp, previewUser } from '../fake-backend';
import { Text } from '@/ui/text';
import { Body, Button, Caption, Card, ErrorText, ListGroup, ListRow, TextField } from '@/ui/components';
import { colors, font, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

const MESSAGES: Record<string, string> = {
  form_password_or_identifier_incorrect: 'Password is incorrect. Try again, or use another method.',
  user_banned: 'This account is banned from MatIQ.',
  form_code_incorrect: 'Incorrect code. Try again.',
  form_identifier_exists: 'That email address is taken. Please try another.',
};
const message = (code: string) => MESSAGES[code] ?? 'Something went wrong. Please try again.';

type Step = 'sign-in' | 'second-factor' | 'sign-up' | 'verify-email';

export function AuthView({ logo }: { logo?: ReactElement; mode?: string; isDismissible?: boolean; onDismiss?: () => void }) {
  useTheme();
  const [step, setStep] = useState<Step>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<{ error: { code: string } | null }>, next: () => Promise<void> | void) => {
    setBusy(true);
    setError(null);
    try {
      const { error: failed } = await action();
      if (failed) return setError(message(failed.code));
      await next();
    } finally {
      setBusy(false);
    }
  };
  const go = (to: Step) => {
    setError(null);
    setCode('');
    setStep(to);
  };

  const title = { 'sign-in': 'Sign in to MatIQ', 'second-factor': 'Two-step verification', 'sign-up': 'Create your account', 'verify-email': 'Verify your email' }[step];
  return (
    <View style={styles.root}>
      <View style={styles.head}>
        {logo}
        <Text style={font.title} accessibilityRole="header">
          {title}
        </Text>
      </View>
      <Card>
        {step === 'sign-in' || step === 'sign-up' ? (
          <>
            <TextField label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
            <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete={step === 'sign-in' ? 'current-password' : 'new-password'} />
          </>
        ) : (
          <>
            <Body muted>{step === 'second-factor' ? 'Enter the code from your authenticator app.' : `Enter the code sent to ${email}.`}</Body>
            <TextField label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" maxLength={6} />
          </>
        )}
        <ErrorText>{error}</ErrorText>
        <Button
          label="Continue"
          loading={busy}
          onPress={() => {
            if (step === 'sign-in') {
              return run(
                () => previewSignIn.password({ emailAddress: email, password }),
                () => (previewSignIn.status === 'needs_second_factor' ? go('second-factor') : void previewSignIn.finalize()),
              );
            } else if (step === 'second-factor') {
              return run(() => previewSignIn.mfa.verifyTOTP({ code }), () => void previewSignIn.finalize());
            } else if (step === 'sign-up') {
              return run(() => previewSignUp.password({ emailAddress: email, password }), () => go('verify-email'));
            } else {
              return run(() => previewSignUp.verifications.verifyEmailCode({ code }), () => void previewSignUp.finalize());
            }
          }}
        />
      </Card>
      {step === 'sign-in' ? (
        <Button label="Don't have an account? Sign up" variant="ghost" disabled={busy} onPress={() => go('sign-up')} />
      ) : (
        <Button label="Back to sign in" variant="ghost" disabled={busy} onPress={() => go('sign-in')} />
      )}
      <Caption>Preview of Clerk's sign-in screen; the app shows Clerk's native one.</Caption>
    </View>
  );
}

export function UserProfileView({ onHostBack, style }: { onHostBack?: () => void; style?: StyleProp<ViewStyle>; isDismissible?: boolean; onDismiss?: () => void }) {
  useTheme();
  const user = previewUser();
  return (
    <View style={[styles.root, style]}>
      <View style={styles.bar}>
        {onHostBack ? <Button label="Back" variant="ghost" icon="chevron-back" onPress={onHostBack} /> : null}
        <Text style={font.heading} accessibilityRole="header">
          Account
        </Text>
      </View>
      <Card>
        <Text style={font.heading}>{user?.fullName ?? user?.username ?? 'Your account'}</Text>
        <Caption>{user?.primaryEmailAddress.emailAddress ?? ''}</Caption>
      </Card>
      <ListGroup>
        <ListRow icon="mail" title="Email addresses" subtitle={user?.primaryEmailAddress.emailAddress ?? ''} />
        <ListRow icon="lock-closed" title="Password" subtitle="Set" />
        <ListRow icon="logo-google" title="Connected accounts" subtitle="Google" />
        <ListRow icon="shield-checkmark" title="Two-step verification" value={user?.twoFactorEnabled ? 'On' : 'Off'} />
        <ListRow icon="phone-portrait" title="Active devices" subtitle="This device" />
      </ListGroup>
      <Button label="Sign out" variant="secondary" icon="log-out-outline" onPress={() => previewSignOut()} />
      <Caption>Preview of Clerk's account screen; the app shows Clerk's native one.</Caption>
    </View>
  );
}

export const UserButton = () => null;

const styles = themedStyles(() => ({
  root: { flex: 1, gap: spacing.md, padding: spacing.lg, backgroundColor: colors.background },
  head: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
}));
