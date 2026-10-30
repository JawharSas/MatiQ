'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useA11y } from '@/features/accessibility/A11yProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { ageCheckStatus } from '@/features/legal/age';
import { missingAcceptances } from '@/features/legal/consent';
import { ConsentGate, NotEligible } from '@/features/legal/ConsentGate';
import { LEGAL_VERSIONS, type LegalDocumentId } from '@/features/legal/documents';
import { Banned } from '@/features/moderation/Banned';
import { isBannedError } from '@/lib/errors';
import { Loading } from '@/ui/components';
import { colors } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

/**
 * Signed-in area. Before anything else, the user must have answered the age
 * check once and accepted the current Terms and Privacy Policy versions
 * (re-prompted when they change). Banned accounts only see why.
 */
// Deep links into a stack screen (a shared match, a ranked match) keep the
// tabs underneath, so Back always has somewhere to go.
export const unstable_settings = { anchor: '(tabs)' };

const ALL_DOCUMENTS = Object.keys(LEGAL_VERSIONS) as LegalDocumentId[];

export default function AppLayout() {
  useTheme();
  const { email } = useAuth();
  const { reduceMotion } = useA11y();
  const age = useQuery({ queryKey: ['age-check'], queryFn: () => ageCheckStatus(email), staleTime: Infinity });
  // After the age check (even a failed lookup), which may save the consent
  // given on the sign-up form.
  const consent = useQuery({ queryKey: ['consent'], queryFn: missingAcceptances, staleTime: Infinity, enabled: !age.isPending });

  if (isBannedError(age.error)) return <Banned />;
  if (consent.isPending || age.isPending) return <Loading />;
  if (age.data === 'not_eligible') return <NotEligible />;
  // If the status cannot be read, ask: answering it again is harmless.
  const needsAge = age.data !== 'done';
  // Likewise, if acceptances cannot be read, ask (saving them again is harmless).
  const missing = consent.data ?? (consent.isError ? ALL_DOCUMENTS : []);
  if (needsAge || missing.length > 0) return <ConsentGate missing={missing} needsAge={needsAge} />;

  return (
    <Stack
      screenOptions={{
        animation: reduceMotion ? 'none' : 'default',
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="match/[id]" options={{ title: 'Match' }} />
      <Stack.Screen name="share/[matchId]" options={{ title: 'Share', presentation: 'modal' }} />
      <Stack.Screen name="report/[postId]" options={{ title: 'Report post', presentation: 'modal' }} />
      <Stack.Screen name="user/[id]" options={{ title: '' }} />
      <Stack.Screen name="friends" options={{ title: 'Friends' }} />
      <Stack.Screen name="settings/password" options={{ title: 'Password' }} />
      <Stack.Screen name="settings/google" options={{ title: 'Google' }} />
      <Stack.Screen name="settings/api-keys" options={{ title: 'AI provider' }} />
      <Stack.Screen name="settings/two-factor" options={{ title: 'Two-factor authentication' }} />
      <Stack.Screen name="admin" options={{ title: 'Owner panel' }} />
      <Stack.Screen name="ranked/opponents" options={{ title: 'Opponents' }} />
      <Stack.Screen name="ranked/leaderboard" options={{ title: 'Ladder' }} />
      <Stack.Screen name="ranked/titles" options={{ title: 'Titles' }} />
      <Stack.Screen name="ranked/match/[id]" options={{ title: 'Ranked match' }} />
    </Stack>
  );
}
