'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { env, envError } from '@/config/env';
import { A11yProvider, useA11y } from '@/features/accessibility/A11yProvider';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { UpdateRequired } from '@/features/update/UpdateRequired';
import { useUpdateRequired } from '@/features/update/useUpdateRequired';
import { isBannedError } from '@/lib/errors';
import { enableCertificatePinning } from '@/lib/ssl-pinning';
import { openSecureStorage } from '@/lib/storage';
import '@/preview/setup';
import { Body, Caption, Loading, Screen, Title } from '@/ui/components';
import { colors, isDarkTheme } from '@/ui/theme';
import { ThemeProvider, useTheme } from '@/ui/ThemeProvider';

void SplashScreen.preventAutoHideAsync();

// A ban takes effect mid-session: the next refused request re-reads the
// account state, and the signed-in area then shows the banned screen. Once
// that read has failed with the ban there is nothing more to re-read.
const onError = (error: unknown) => {
  if (!isBannedError(error) || isBannedError(queryClient.getQueryState(['age-check'])?.error)) return;
  void queryClient.invalidateQueries({ queryKey: ['age-check'] });
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (error, query) => query.queryKey[0] !== 'age-check' && onError(error) }),
  mutationCache: new MutationCache({ onError }),
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
 *   4. then Clerk starts (it may refresh the session immediately); Clerk
 *      keeps its session token in the keychain (expo-secure-store).
 */
async function boot(): Promise<void> {
  if (envError) throw new Error(__DEV__ ? `Invalid configuration:\n${envError}` : 'This build is misconfigured.');
  await enableCertificatePinning();
  await openSecureStorage();
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
      {state.kind === 'ready' ? (
        // The theme comes from the encrypted store, which is open by now.
        <ThemeProvider>
          <ThemedStatusBar />
          <ClerkProvider publishableKey={env.clerkPublishableKey} tokenCache={tokenCache}>
            <A11yProvider>
              <QueryClientProvider client={queryClient}>
                <AuthProvider>
                  <RootNavigator />
                </AuthProvider>
              </QueryClientProvider>
            </A11yProvider>
          </ClerkProvider>
        </ThemeProvider>
      ) : state.kind === 'failed' ? (
        <Screen>
          <Title>MatIQ can't start</Title>
          <Body>{state.message}</Body>
          <Caption>If this keeps happening, update the app or contact support.</Caption>
        </Screen>
      ) : (
        <Loading />
      )}
      {state.kind !== 'ready' ? <StatusBar style="light" /> : null}
    </SafeAreaProvider>
  );
}

function ThemedStatusBar() {
  const { theme } = useTheme();
  return <StatusBar style={isDarkTheme(theme) ? 'light' : 'dark'} />;
}

function RootNavigator() {
  useTheme();
  const { signedIn, initializing } = useAuth();
  const { reduceMotion } = useA11y();
  const update = useUpdateRequired();
  // A version too old to keep working shows only the way to the new one.
  if (update.required) return <UpdateRequired downloadUrl={update.downloadUrl} />;
  if (initializing) return <Loading />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'none' : 'default',
        contentStyle: { backgroundColor: colors.background },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
      }}
    >
      {/* Explicit redirects: the root stack has no anchor, so without them a
          guarded URL (e.g. "/" while signed out) would land on a bare group. */}
      <Stack.Protected guard={!signedIn} redirectTo="/">
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn} redirectTo="/sign-in">
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Screen name="legal/[doc]" options={{ headerShown: true, title: '', presentation: 'modal' }} />
      <Stack.Screen name="accessibility" options={{ headerShown: true, title: 'Accessibility', presentation: 'modal' }} />
      <Stack.Screen name="appearance" options={{ headerShown: true, title: 'Appearance', presentation: 'modal' }} />
      <Stack.Screen name="auth/callback" />
    </Stack>
  );
}
