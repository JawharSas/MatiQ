'use no memo'; // Reads the theme, which changes in place (src/ui/theme.ts); React Compiler would keep old colours.

import { useUser } from '@clerk/expo';
import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Share } from 'react-native';
import { Text } from '@/ui/text';
import { useAuth } from '@/features/auth/AuthProvider';
import { contactSupport, supportEmail } from '@/features/legal/contact';
import { fromFunctionError, errorMessage } from '@/lib/errors';
import { backend } from '@/lib/backend';
import { Button, Caption, Card, ErrorText, Heading, ListGroup, ListRow, Screen, SectionHeader, TextField } from '@/ui/components';
import { font, themedStyles } from '@/ui/theme';
import { type ThemePreference, useTheme } from '@/ui/ThemeProvider';

const THEME_LABELS: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark', midnight: 'Midnight' };

/** Everything essential in one place: account and sign-in, appearance, AI, data, help and legal. */
export default function SettingsScreen() {
  const { preference } = useTheme();
  const router = useRouter();
  const { signOut, email } = useAuth();
  const { user } = useUser();
  const google = user?.externalAccounts.find((account) => account.provider === 'google');
  const googleConnected = google?.verification?.status === 'verified';
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const exportData = async () => {
    setExporting(true);
    setError(null);
    try {
      const { data, error: fnError } = await backend.functions.invoke('account', { method: 'GET' });
      if (fnError) throw await fromFunctionError(fnError);
      const file = new File(Paths.cache, `matiq-export-${Date.now()}.json`);
      file.write(JSON.stringify(data, null, 2));
      await Share.share({ url: file.uri, title: 'MatIQ data export' });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = () => {
    Alert.alert('Delete your account permanently?', 'All matches, videos, analyses, posts and stored keys are deleted. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete everything',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          setError(null);
          try {
            const { error: fnError } = await backend.functions.invoke('account', {
              method: 'DELETE',
              body: { confirm: 'DELETE MY ACCOUNT' },
            });
            if (fnError) throw await fromFunctionError(fnError);
            await signOut();
          } catch (caught) {
            setError(errorMessage(caught));
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  return (
    <Screen>
      <SectionHeader title="Account and sign-in" />
      <ListGroup>
        <ListRow icon="mail" title="Email" subtitle={email || 'Not set'} />
        <ListRow
          icon="lock-closed"
          title="Password"
          subtitle={user?.passwordEnabled ? 'Change your password' : 'Set one to also sign in with your email'}
          onPress={() => router.push('/settings/password')}
        />
        <ListRow
          icon="logo-google"
          title="Google"
          subtitle={googleConnected ? `Connected as ${google?.emailAddress ?? 'your Google account'}` : 'Connect to sign in with Google'}
          value={googleConnected ? 'On' : 'Off'}
          onPress={() => router.push('/settings/google')}
        />
        <ListRow
          icon="shield-checkmark"
          title="Two-factor authentication"
          subtitle="A code from your authenticator app when you sign in"
          value={user?.totpEnabled ? 'On' : 'Off'}
          onPress={() => router.push('/settings/two-factor')}
        />
      </ListGroup>

      <SectionHeader title="Appearance" />
      <ListGroup>
        <ListRow
          icon="contrast"
          title="Theme"
          subtitle="Light, Dark, Midnight or your phone's setting"
          value={THEME_LABELS[preference]}
          onPress={() => router.push('/appearance')}
        />
        <ListRow
          icon="accessibility"
          title="Accessibility"
          subtitle="Text size, high contrast and motion"
          onPress={() => router.push('/accessibility')}
        />
      </ListGroup>

      <SectionHeader title="Analysis" />
      <ListGroup>
        <ListRow
          icon="key"
          title="AI provider"
          subtitle="Use your own key for Claude, ChatGPT, Gemini or any AI"
          onPress={() => router.push('/settings/api-keys')}
        />
      </ListGroup>

      <SectionHeader title="Help" />
      <ListGroup>
        <ListRow
          icon="help-buoy"
          title="Help and support"
          subtitle={supportEmail ? `Email ${supportEmail}` : 'Report a problem on GitHub'}
          onPress={() => contactSupport('MatIQ support')}
        />
      </ListGroup>

      <SectionHeader title="Privacy and data" />
      <ListGroup>
        <ListRow
          icon="document-text"
          tone="blue"
          title="Privacy Policy"
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })}
        />
        <ListRow
          icon="reader"
          tone="blue"
          title="Terms of Service"
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })}
        />
        <ListRow
          icon="ribbon"
          tone="blue"
          title="Copyright and DMCA"
          subtitle="Report infringement to our designated agent"
          onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'copyright' } })}
        />
        <ListRow
          icon="download"
          tone="blue"
          title="Export my data"
          subtitle="A copy of everything MatIQ stores about you"
          value={exporting ? 'Preparing…' : undefined}
          onPress={exporting ? undefined : () => void exportData()}
        />
      </ListGroup>
      <Caption>Your data, profile and videos are never sold or shared with data brokers.</Caption>

      <SectionHeader title="Session" />
      <ListGroup>
        <ListRow icon="log-out" tone="neutral" title="Sign out" onPress={() => void signOut()} />
        <ListRow
          icon="phone-portrait"
          tone="neutral"
          title="Sign out of all devices"
          onPress={() => void signOut({ everywhere: true })}
        />
      </ListGroup>

      <ErrorText>{error}</ErrorText>

      <SectionHeader title="Danger zone" />
      <Card>
        <Heading>Delete account</Heading>
        <Caption>Permanently removes your profile, matches, videos and posts. Type DELETE MY ACCOUNT to continue.</Caption>
        <TextField label="Confirmation" value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" />
        <Button
          label="Delete my account"
          variant="danger"
          icon="trash"
          disabled={confirmText !== 'DELETE MY ACCOUNT'}
          loading={deleting}
          onPress={deleteAccount}
        />
      </Card>
      <Text style={styles.version}>
        MatIQ {Constants.expoConfig?.version ?? ''}
        {typeof Constants.expoConfig?.extra?.releaseLabel === 'string' ? ` · ${Constants.expoConfig.extra.releaseLabel}` : ''}
      </Text>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  version: { ...font.caption, textAlign: 'center', color: font.overline.color },
}));
