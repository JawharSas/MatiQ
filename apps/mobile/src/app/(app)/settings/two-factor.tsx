'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { useUser } from '@clerk/expo';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import { Text } from '@/ui/text';
import { newBackupCodes, removeTotp, startTotpEnrollment, type TotpEnrollment, verifyTotp } from '@/features/auth/mfa';
import { isVerificationCancelled, useVerifiedAction } from '@/features/auth/reverify';
import { groupSecret } from '@/features/auth/totp';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Caption, Card, ErrorText, Heading, Loading, Screen, TextField } from '@/ui/components';
import { font } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

export default function TwoFactorScreen() {
  useTheme();
  const { user } = useUser();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Changes to two-factor may need the person to confirm it's them first.
  const verified = useVerifiedAction((work: () => Promise<void>) => work());

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await verified.run(work);
    } catch (caught) {
      if (!isVerificationCancelled(caught)) setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (!user) return <Loading />;

  const start = () => run(async () => setEnrollment(await startTotpEnrollment(user)));

  const confirm = () =>
    run(async () => {
      if (!enrollment) return;
      setBackupCodes(await verifyTotp(user, code));
      setEnrollment(null);
      setCode('');
    });

  const regenerate = () => run(async () => setBackupCodes(await newBackupCodes(user)));

  const disable = () =>
    Alert.alert('Turn off two-factor authentication?', 'Your account will be protected by your password only.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Turn off',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            await removeTotp(user);
            setBackupCodes([]);
          }),
      },
    ]);

  return (
    <Screen>
      <Card>
        <Heading>Two-factor authentication</Heading>
        <Body muted>
          Protects your account with a code from an authenticator app (Apple Passwords, Google Authenticator, 1Password…) in addition to your
          password. Once it's on, a stolen password alone can't access your matches or videos.
        </Body>
        {user.totpEnabled ? (
          <>
            <Body>On</Body>
            {user.backupCodeEnabled ? <Button label="New backup codes" variant="secondary" disabled={busy} onPress={() => void regenerate()} /> : null}
            <Button label="Turn off" variant="danger" disabled={busy} onPress={disable} />
          </>
        ) : enrollment ? null : (
          <Button label="Set up authenticator" loading={busy} onPress={() => void start()} />
        )}
      </Card>
      {enrollment ? <EnrollmentCard enrollment={enrollment} code={code} onCode={setCode} busy={busy} onConfirm={() => void confirm()} onCancel={() => setEnrollment(null)} /> : null}
      {backupCodes.length > 0 ? <BackupCodesCard codes={backupCodes} /> : null}
      <ErrorText>{error}</ErrorText>
      {verified.prompt}
    </Screen>
  );
}

function EnrollmentCard(props: {
  enrollment: TotpEnrollment;
  code: string;
  onCode: (code: string) => void;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useTheme();
  // The secret is as sensitive as a password while it is on screen.
  usePreventScreenCapture();
  return (
    <Card>
      <Heading>1. Add MatIQ to your authenticator</Heading>
      <Button label="Open authenticator app" variant="secondary" onPress={() => void Linking.openURL(props.enrollment.uri).catch(() => undefined)} />
      <Caption>Or enter this setup key manually (time-based, 6 digits):</Caption>
      <Text selectable style={[font.body, { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), letterSpacing: 1 }]}>
        {groupSecret(props.enrollment.secret)}
      </Text>
      <Heading>2. Enter the code it shows</Heading>
      <TextField
        label="6-digit code"
        value={props.code}
        onChangeText={props.onCode}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={7}
      />
      <Button label="Turn on" loading={props.busy} onPress={props.onConfirm} />
      <Button label="Cancel" variant="secondary" disabled={props.busy} onPress={props.onCancel} />
    </Card>
  );
}

function BackupCodesCard({ codes }: { codes: string[] }) {
  useTheme();
  return (
    <Card>
      <Heading>Backup codes</Heading>
      <Body muted>
        Each one signs you in once if you lose your phone. Save them somewhere safe now (a password manager is ideal): they won't be shown again.
      </Body>
      <Text selectable style={[font.body, { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), letterSpacing: 1 }]}>
        {codes.join('\n')}
      </Text>
    </Card>
  );
}
