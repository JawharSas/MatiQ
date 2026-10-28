import { useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useVerifiedFactors, verifyTotp } from '@/features/auth/mfa';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Card, ErrorText, Loading, Screen, TextField, Title } from '@/ui/components';

/**
 * Second sign-in step for accounts with two-factor authentication. Shown by
 * the root navigator while the session is aal1; verifying upgrades it to aal2
 * and the navigator moves on to the app.
 */
export default function MfaChallengeScreen() {
  const { signOut } = useAuth();
  const factors = useVerifiedFactors();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (factors.isPending) return <Loading />;
  const factor = factors.data?.[0];

  const verify = async () => {
    if (!factor) return;
    setBusy(true);
    setError(null);
    try {
      await verifyTotp(factor.id, code);
    } catch (caught) {
      setError(errorMessage(caught));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Two-factor verification</Title>
      {factor ? (
        <Card>
          <Body muted>Enter the 6-digit code from your authenticator app.</Body>
          <TextField
            label="Code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={7}
            autoFocus
            onSubmitEditing={() => void verify()}
          />
          <ErrorText>{error}</ErrorText>
          <Button label="Verify" onPress={() => void verify()} loading={busy} />
        </Card>
      ) : (
        <ErrorText>{factors.error ? errorMessage(factors.error) : 'No authenticator is set up for this account.'}</ErrorText>
      )}
      <Body muted>Lost your authenticator? Contact support from the email on your account to recover access.</Body>
      <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
    </Screen>
  );
}
