import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { messageFor } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { emailSchema } from '@/lib/validation';
import { Body, Button, Caption, Card, ErrorText, Screen, TextField, Title } from '@/ui/components';

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
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
      <Title>MatIQ</Title>
      <Body muted>AI analysis for BJJ, wrestling and MMA.</Body>
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
