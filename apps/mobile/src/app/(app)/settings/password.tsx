import { useUser } from '@clerk/expo';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { clerkErrorMessage } from '@/features/auth/clerk-errors';
import { isVerificationCancelled, useVerifiedAction } from '@/features/auth/reverify';
import { firstIssue, passwordSchema } from '@/lib/validation';
import { Body, Button, Caption, Card, ErrorText, Loading, Screen, StatusText, TextField, ToggleRow } from '@/ui/components';
import { useTheme } from '@/ui/ThemeProvider';

/**
 * Change the password, or set one for an account that signs in with Google
 * only (then the email and that password work too).
 */
export default function PasswordScreen() {
  useTheme();
  const router = useRouter();
  const { user } = useUser();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const update = useVerifiedAction((params: Parameters<NonNullable<typeof user>['updatePassword']>[0]) => user!.updatePassword(params));

  if (!user) return <Loading />;
  const hasPassword = user.passwordEnabled;

  const save = async () => {
    setError(null);
    if (hasPassword && !current) return setError('Enter your current password.');
    const parsed = passwordSchema.safeParse(next);
    if (!parsed.success) return setError(firstIssue(parsed.error));
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    try {
      await update.run({ newPassword: next, ...(hasPassword ? { currentPassword: current } : {}), signOutOfOtherSessions: signOutOthers });
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (caught) {
      if (!isVerificationCancelled(caught)) setError(clerkErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen>
        <Card>
          <StatusText>{hasPassword ? 'Password changed.' : 'Password set.'}</StatusText>
          <Body muted>
            {hasPassword
              ? signOutOthers
                ? 'Your other devices were signed out.'
                : 'Use it the next time you sign in.'
              : `You can now also sign in with ${user.primaryEmailAddress?.emailAddress ?? 'your email'} and this password.`}
          </Body>
          <Button label="Done" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <Card>
        <Body muted>
          {hasPassword
            ? 'Choose a new password: 12 or more characters, with upper and lower case, a number and a symbol.'
            : `You sign in with Google. Set a password to also sign in with ${user.primaryEmailAddress?.emailAddress ?? 'your email'}.`}
        </Body>
        {hasPassword ? (
          <TextField label="Current password" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" />
        ) : null}
        <TextField label="New password" value={next} onChangeText={setNext} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
        <TextField label="Repeat the new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
        <ToggleRow label="Sign out of my other devices" value={signOutOthers} onValueChange={setSignOutOthers} />
        <ErrorText>{error}</ErrorText>
        <Button label={hasPassword ? 'Change password' : 'Set password'} onPress={() => void save()} loading={busy} />
      </Card>
      {hasPassword ? <Caption>Forgot your current password? Sign out, then choose "Forgot password?" on the sign-in screen.</Caption> : null}
      {update.prompt}
    </Screen>
  );
}
