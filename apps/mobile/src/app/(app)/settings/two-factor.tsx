import { useQueryClient } from '@tanstack/react-query';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useState } from 'react';
import { Alert, Linking, Platform, Text } from 'react-native';
import { removeFactor, startTotpEnrollment, type TotpEnrollment, useVerifiedFactors, verifyTotp } from '@/features/auth/mfa';
import { groupSecret } from '@/features/auth/totp';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Caption, Card, ErrorText, Heading, Loading, Screen, TextField } from '@/ui/components';
import { font } from '@/ui/theme';

export default function TwoFactorScreen() {
  const queryClient = useQueryClient();
  const factors = useVerifiedFactors();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const start = () => run(async () => setEnrollment(await startTotpEnrollment()));

  const confirm = () =>
    run(async () => {
      if (!enrollment) return;
      await verifyTotp(enrollment.factorId, code);
      setEnrollment(null);
      setCode('');
      await queryClient.invalidateQueries({ queryKey: ['mfa-factors'] });
    });

  const disable = (factorId: string) =>
    Alert.alert('Turn off two-factor authentication?', 'Your account will be protected by your password only.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Turn off',
        style: 'destructive',
        onPress: () =>
          void run(async () => {
            await removeFactor(factorId);
            await queryClient.invalidateQueries({ queryKey: ['mfa-factors'] });
          }),
      },
    ]);

  if (factors.isPending) return <Loading />;
  const active = factors.data?.[0];

  return (
    <Screen>
      <Card>
        <Heading>Two-factor authentication</Heading>
        <Body muted>
          Protects your account with a code from an authenticator app (Apple Passwords, Google Authenticator, 1Password…) in addition to your
          password. Once it's on, a stolen password alone can't access your matches or videos.
        </Body>
        {active ? (
          <>
            <Body>On · added {new Date(active.created_at).toLocaleDateString()}</Body>
            <Button label="Turn off" variant="danger" disabled={busy} onPress={() => disable(active.id)} />
          </>
        ) : enrollment ? null : (
          <Button label="Set up authenticator" loading={busy} onPress={() => void start()} />
        )}
      </Card>
      {enrollment ? <EnrollmentCard enrollment={enrollment} code={code} onCode={setCode} busy={busy} onConfirm={() => void confirm()} onCancel={() => setEnrollment(null)} /> : null}
      <ErrorText>{error ?? (factors.error ? errorMessage(factors.error) : null)}</ErrorText>
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
