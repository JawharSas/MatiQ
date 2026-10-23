import { useQueryClient } from '@tanstack/react-query';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { deleteKey, storeKey, useStoredKeys } from '@/features/api-keys/api';
import { confirmDeviceOwner } from '@/lib/device-auth';
import { errorMessage } from '@/lib/errors';
import { apiKeySchema, firstIssue } from '@/lib/validation';
import { Body, Button, Caption, Card, ErrorText, Heading, Loading, Screen, TextField } from '@/ui/components';

/**
 * Bring-your-own-key vault. The key is typed once, sent over TLS to the
 * `api-keys` Edge Function, verified with the provider, encrypted with
 * AES-256-GCM server side and never returned to the device again. This
 * screen blocks screenshots/screen recording and requires device
 * authentication to open.
 */
export default function ApiKeysScreen() {
  usePreventScreenCapture('api-keys');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [unlocked, setUnlocked] = useState(false);
  const keys = useStoredKeys();
  const [apiKey, setApiKey] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    confirmDeviceOwner('Unlock your API keys').then((ok) => (ok ? setUnlocked(true) : router.back()));
  }, [router]);

  if (!unlocked || keys.isPending) return <Loading />;
  const stored = keys.data?.[0];

  const save = async () => {
    const parsed = apiKeySchema.safeParse({ apiKey, label: label || undefined });
    if (!parsed.success) return setError(firstIssue(parsed.error));
    setBusy(true);
    setError(null);
    try {
      await storeKey(parsed.data.apiKey, parsed.data.label);
      // Drop the plaintext from memory as soon as it has been sent.
      setApiKey('');
      setLabel('');
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await deleteKey();
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <Heading>Anthropic API key</Heading>
        <Body muted>
          Use your own key to run analyses beyond your monthly MatIQ quota. It is encrypted on our servers and never shown again, logged
          or stored on this phone. Usage is billed to your Anthropic account.
        </Body>
        {stored ? (
          <>
            <Body>
              Stored key ending in …{stored.last4}
              {stored.label ? ` (${stored.label})` : ''}
            </Body>
            <Caption>
              Added {new Date(stored.created_at).toLocaleDateString()}
              {stored.last_used_at ? ` · last used ${new Date(stored.last_used_at).toLocaleDateString()}` : ''}
            </Caption>
            <Button label="Remove key" variant="danger" onPress={() => void remove()} loading={busy} />
          </>
        ) : null}
      </Card>
      <Card>
        <Heading>{stored ? 'Replace key' : 'Add key'}</Heading>
        <TextField
          label="API key"
          value={apiKey}
          onChangeText={setApiKey}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="off"
          importantForAutofill="no"
          textContentType="none"
          contextMenuHidden
          maxLength={300}
        />
        <TextField label="Label (optional)" value={label} onChangeText={setLabel} maxLength={40} />
        <ErrorText>{error}</ErrorText>
        <Button label="Verify and save" onPress={() => void save()} loading={busy} />
      </Card>
    </Screen>
  );
}
