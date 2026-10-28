import Constants from 'expo-constants';
import { File, Paths } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Share } from 'react-native';
import { useAuth } from '@/features/auth/AuthProvider';
import { fromFunctionError, errorMessage } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { Body, Button, Caption, Card, ErrorText, Heading, Screen, TextField } from '@/ui/components';

export default function SettingsScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const exportData = async () => {
    setExporting(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('account', { method: 'GET' });
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
            const { error: fnError } = await supabase.functions.invoke('account', {
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
      <Card>
        <Heading>Security</Heading>
        <Button label="Two-factor authentication" variant="secondary" onPress={() => router.push('/settings/two-factor')} />
        <Button label="API keys (bring your own key)" variant="secondary" onPress={() => router.push('/settings/api-keys')} />
        <Button label="Sign out" variant="secondary" onPress={() => void signOut()} />
        <Button label="Sign out of all devices" variant="secondary" onPress={() => void signOut({ everywhere: true })} />
      </Card>
      <Card>
        <Heading>Privacy & legal</Heading>
        <Body muted>Your data, profile and videos are never sold or shared with data brokers.</Body>
        <Button label="Privacy Policy" variant="secondary" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'privacy' } })} />
        <Button label="Terms of Service" variant="secondary" onPress={() => router.push({ pathname: '/legal/[doc]', params: { doc: 'terms' } })} />
        <Button label="Export my data" variant="secondary" onPress={() => void exportData()} loading={exporting} />
      </Card>
      <Card>
        <Heading>Delete account</Heading>
        <Caption>Type DELETE MY ACCOUNT to enable deletion.</Caption>
        <TextField label="Confirmation" value={confirmText} onChangeText={setConfirmText} autoCapitalize="characters" />
        <Button label="Delete my account" variant="danger" disabled={confirmText !== 'DELETE MY ACCOUNT'} loading={deleting} onPress={deleteAccount} />
      </Card>
      <Caption>
        MatIQ {Constants.expoConfig?.version ?? ''}
        {typeof Constants.expoConfig?.extra?.releaseLabel === 'string' ? ` · ${Constants.expoConfig.extra.releaseLabel}` : ''}
      </Caption>
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
