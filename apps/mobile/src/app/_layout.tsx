import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { envError } from '@/config/env';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { enableCertificatePinning } from '@/lib/ssl-pinning';
import { openSecureStorage } from '@/lib/storage';
import { initSupabase } from '@/lib/supabase';
import { Body, Caption, Loading, Screen, Title } from '@/ui/components';
import { colors } from '@/ui/theme';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000 },
    mutations: { retry: 0 },
  },
});

type BootState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; message: string };

/**
 * Boot order matters for security:
 *   1. validate public config
 *   2. enable TLS pinning (before ANY request)
 *   3. open the encrypted store (key from Keychain/Keystore)
 *   4. create the Supabase client (may refresh the session immediately)
 */
async function boot(): Promise<void> {
  if (envError) throw new Error(__DEV__ ? `Invalid configuration:\n${envError}` : 'This build is misconfigured.');
  await enableCertificatePinning();
  await openSecureStorage();
  initSupabase();
}

export default function RootLayout() {
  const [state, setState] = useState<BootState>({ kind: 'loading' });

  useEffect(() => {
    boot()
      .then(() => setState({ kind: 'ready' }))
      .catch((error: unknown) =>
        setState({ kind: 'failed', message: error instanceof Error ? error.message : 'Startup failed' }),
      )
      .finally(() => void SplashScreen.hideAsync());
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {state.kind === 'ready' ? (
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </QueryClientProvider>
      ) : state.kind === 'failed' ? (
        <Screen>
          <Title>MatIQ can't start</Title>
          <Body>{state.message}</Body>
          <Caption>If this keeps happening, update the app or contact support.</Caption>
        </Screen>
      ) : (
        <Loading />
      )}
    </SafeAreaProvider>
  );
}

function RootNavigator() {
  const { session, initializing } = useAuth();
  if (initializing) return <Loading />;
  const signedIn = Boolean(session);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Screen name="legal/[doc]" options={{ headerShown: true, title: '', presentation: 'modal' }} />
      <Stack.Screen name="auth/callback" />
    </Stack>
  );
}
