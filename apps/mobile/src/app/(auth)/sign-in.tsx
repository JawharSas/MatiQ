'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { useAuth as useClerkAuth } from '@clerk/expo';
import { AuthView } from '@clerk/expo/native';
import { Link, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/features/auth/AuthProvider';
import { ageCheckLocked } from '@/features/legal/age';
import { AppError, errorMessage, isBannedError } from '@/lib/errors';
import { LogoMark } from '@/ui/brand';
import { Body, Button, Caption, Card, inlineLink, Screen } from '@/ui/components';
import { colors, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

/**
 * Signing in and signing up: Clerk's native AuthView (email and password,
 * Google, email codes, two-factor and password resets, as enabled in the
 * Clerk Dashboard). Once Clerk has a session, AuthProvider opens the MatIQ
 * account and the signed-in area takes over with the age check and consent.
 *
 * Clerk's pending sessions (a task such as setting up two-factor) count as
 * signed out here, so AuthView stays on screen until it has finished them.
 */
export default function SignIn() {
  useTheme();
  const router = useRouter();
  const { accountError, retryAccount, signOut } = useAuth();
  const { isSignedIn } = useClerkAuth();
  const [notCreated, setNotCreated] = useState(false);

  useEffect(() => {
    void ageCheckLocked().then(setNotCreated);
  }, []);

  // Clerk signed in, but the MatIQ account didn't open (a ban, no network, a
  // server problem). Anything but a ban can be tried again; the code is
  // there for support.
  if (isSignedIn && accountError) {
    const banned = isBannedError(accountError);
    const code = accountError instanceof AppError && accountError.code !== 'unknown' ? accountError.code : null;
    return (
      <Screen>
        <View style={styles.errorLogo}>
          <LogoMark size={56} />
        </View>
        <Card>
          {banned ? (
            <Body>{errorMessage(accountError)}</Body>
          ) : (
            <>
              <Body>You're signed in, but your MatIQ account didn't open.</Body>
              <Caption>
                {errorMessage(accountError)}
                {code ? ` (error ${code})` : ''}
              </Caption>
              <Button label="Try again" icon="refresh" onPress={retryAccount} />
            </>
          )}
          <Button label="Sign out" variant="secondary" icon="log-out-outline" onPress={() => signOut()} />
        </Card>
      </Screen>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
      {notCreated ? (
        <View style={styles.notice}>
          <Body>Sorry, we couldn't create a MatIQ account for you. If you already have one, sign in below.</Body>
        </View>
      ) : null}
      <View style={styles.auth}>
        {/* Clerk's screen is black and red in every theme (clerk-theme.json), so the logo is the white-M one. */}
        <AuthView isDismissible={false} logo={<LogoMark size={56} onDark />} />
      </View>
      <View style={styles.footer}>
        <Caption>
          By using MatIQ you agree to the{' '}
          <Link href={{ pathname: '/legal/[doc]', params: { doc: 'terms' } }} style={inlineLink}>
            Terms
          </Link>{' '}
          and{' '}
          <Link href={{ pathname: '/legal/[doc]', params: { doc: 'privacy' } }} style={inlineLink}>
            Privacy Policy
          </Link>
          . We never sell your data.
        </Caption>
        <Button label="Accessibility options" variant="ghost" icon="accessibility-outline" onPress={() => router.push('/accessibility')} />
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  root: { flex: 1, backgroundColor: colors.background },
  auth: { flex: 1 },
  notice: { marginHorizontal: spacing.lg, marginTop: spacing.sm, padding: spacing.md, borderRadius: 12, backgroundColor: colors.surface },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, gap: spacing.xs, alignItems: 'center' },
  errorLogo: { alignItems: 'center', paddingTop: spacing.xl },
}));
