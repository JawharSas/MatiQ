import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { exchangeAuthCode, redirectErrorMessage } from '@/features/auth/oauth';
import { Body, Button, Loading, Screen, Title } from '@/ui/components';

/**
 * Landing route for email confirmation links and Google sign-in
 * (matiq:///auth/callback). PKCE: the one-time `code` is exchanged together
 * with the verifier stored in the encrypted local store, so an intercepted
 * link alone is useless.
 */
export default function AuthCallback() {
  const { code, error_description: errorDescription } = useLocalSearchParams<{ code?: string; error_description?: string }>();
  const router = useRouter();
  const [failure, setFailure] = useState<{ title: string; body: string } | null>(null);

  useEffect(() => {
    if (typeof code !== 'string') {
      setFailure(
        typeof errorDescription === 'string'
          ? { title: 'Not signed in', body: redirectErrorMessage(errorDescription) }
          : { title: 'Link expired', body: 'This link is invalid or was opened on a different device. Sign in to request a new one.' },
      );
      return;
    }
    exchangeAuthCode(code).then(
      () => router.replace('/'),
      () =>
        setFailure({
          title: 'Link expired',
          body: 'This link is invalid or was opened on a different device. Sign in to request a new one.',
        }),
    );
  }, [code, errorDescription, router]);

  if (!failure) return <Loading />;
  return (
    <Screen>
      <Title>{failure.title}</Title>
      <Body>{failure.body}</Body>
      <Button label="Go to sign in" onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}
