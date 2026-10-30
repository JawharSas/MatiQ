'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { useUser } from '@clerk/expo';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Image, View } from 'react-native';
import { Text } from '@/ui/text';
import { clerkErrorMessage } from '@/features/auth/clerk-errors';
import { isVerificationCancelled, useVerifiedAction } from '@/features/auth/reverify';
import { Body, Button, Caption, Card, ErrorText, Loading, Screen } from '@/ui/components';
import { colors, font, radius, spacing, themedStyles } from '@/ui/theme';
import { useTheme } from '@/ui/ThemeProvider';

const G = require('../../../../assets/brand/google-g.png');

/**
 * Connect Google to an account made with email and password (or disconnect
 * it): either way of signing in then opens the same MatIQ account.
 */
export default function GoogleScreen() {
  useTheme();
  const { user } = useUser();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const google = user?.externalAccounts.find((account) => account.provider === 'google');
  const connected = google?.verification?.status === 'verified';

  const connect = useVerifiedAction(async () => {
    if (!user) return;
    // A connection started earlier but never finished.
    if (google && !connected) await google.destroy();
    const redirectUrl = Linking.createURL('/auth/callback');
    const account = await user.createExternalAccount({ strategy: 'oauth_google', redirectUrl });
    const url = account.verification?.externalVerificationRedirectURL?.toString();
    if (!url) throw new Error('Google did not answer. Please try again.');
    await WebBrowser.openAuthSessionAsync(url, redirectUrl);
    await user.reload();
  });
  const disconnect = useVerifiedAction(async () => {
    if (!user || !google) return;
    await google.destroy();
    await user.reload();
  });

  if (!user) return <Loading />;

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      if (!isVerificationCancelled(caught)) setError(caught instanceof Error && !('errors' in caught) ? caught.message : clerkErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <View style={styles.header}>
          <View style={styles.logo}>
            <Image source={G} style={styles.g} accessible={false} />
          </View>
          <View style={styles.headerText}>
            <Text style={font.heading}>Google</Text>
            <Text style={font.caption}>{connected ? `Connected as ${google?.emailAddress ?? 'your Google account'}` : 'Not connected'}</Text>
          </View>
        </View>
        <Body muted>
          {connected
            ? 'You can sign in with Google or with your email and password. Both open this MatIQ account.'
            : 'Connect your Google account to sign in with one tap. Your email and password keep working too.'}
        </Body>
        <ErrorText>{error}</ErrorText>
        {connected ? (
          <>
            <Button
              label="Disconnect Google"
              variant="secondary"
              icon="unlink"
              disabled={!user.passwordEnabled}
              loading={busy}
              onPress={() => void run(() => disconnect.run())}
            />
            {!user.passwordEnabled ? <Caption>Set a password first (Settings → Password), so you can still sign in without Google.</Caption> : null}
          </>
        ) : (
          <Button label="Connect Google" icon="logo-google" loading={busy} onPress={() => void run(() => connect.run())} />
        )}
      </Card>
      {connect.prompt}
      {disconnect.prompt}
    </Screen>
  );
}

const styles = themedStyles(() => ({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headerText: { flex: 1, gap: 2 },
  logo: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  g: { width: 22, height: 22 },
}));
