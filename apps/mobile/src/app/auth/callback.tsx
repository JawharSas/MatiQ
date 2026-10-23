import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Body, Button, Loading, Screen, Title } from '@/ui/components';

/**
 * Email confirmation / magic-link landing route (matiq://auth/callback).
 * PKCE: the one-time `code` is exchanged together with the verifier stored
 * in the encrypted local store, so an intercepted link alone is useless.
 */
export default function AuthCallback() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (typeof code !== 'string' || !/^[A-Za-z0-9-]{8,128}$/.test(code)) {
      setFailed(true);
      return;
    }
    supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) setFailed(true);
      else router.replace('/');
    });
  }, [code, router]);

  if (!failed) return <Loading />;
  return (
    <Screen>
      <Title>Link expired</Title>
      <Body>This confirmation link is invalid or was opened on a different device. Sign in to request a new one.</Body>
      <Button label="Go to sign in" onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}
