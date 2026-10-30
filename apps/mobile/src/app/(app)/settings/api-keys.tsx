import { useQueryClient } from '@tanstack/react-query';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { checkKey, deleteKey, type KeyCheck, selectKey, type StoredKey, storeKey, useStoredKeys } from '@/features/api-keys/api';
import { ModelPicker } from '@/features/api-keys/ModelPicker';
import { detectProvider, PROVIDER_OPTIONS, type ProviderId, providerOption } from '@/features/api-keys/providers';
import { confirmDeviceOwner } from '@/lib/device-auth';
import { errorMessage } from '@/lib/errors';
import { apiKeySchema, firstIssue, modelIdSchema } from '@/lib/validation';
import { Badge, Body, Button, Caption, Card, ChoiceChips, ErrorText, Heading, IconTile, Loading, Screen, SectionHeader, StatusText, TextField } from '@/ui/components';
import { Text } from '@/ui/text';
import { font, spacing } from '@/ui/theme';

const PROVIDER_CHIPS = PROVIDER_OPTIONS.map((option) => ({
  value: option.id,
  label: option.name,
  accessibilityLabel: `${option.name}, ${option.detail}`,
}));

/**
 * Use any AI with your own key. The key is typed once, sent over TLS to the
 * `api-keys` Edge Function, checked with the provider (which lists the
 * models it can use), tested with one small picture, encrypted with
 * AES-256-GCM server side and never returned to the device again. This
 * screen blocks screenshots/screen recording and requires device
 * authentication to open.
 */
export default function ApiKeysScreen() {
  usePreventScreenCapture('api-keys');
  const router = useRouter();
  const queryClient = useQueryClient();
  const [unlocked, setUnlocked] = useState(false);
  const keys = useStoredKeys(unlocked);

  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [check, setCheck] = useState<KeyCheck | null>(null);
  const [model, setModel] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    confirmDeviceOwner('Unlock your AI keys').then((ok) => (ok ? setUnlocked(true) : router.back()));
  }, [router]);

  if (!unlocked || keys.isPending) return <Loading />;
  const stored = keys.data ?? [];
  const option = provider ? providerOption(provider) : null;

  const reset = () => {
    // Drop the plaintext from memory as soon as it is no longer needed.
    setApiKey('');
    setBaseUrl('');
    setProvider(null);
    setCheck(null);
    setModel('');
    setLabel('');
    setError(null);
  };

  const changeKey = (text: string) => {
    setApiKey(text);
    setCheck(null);
    setDone(null);
    const detected = detectProvider(text);
    if (detected) setProvider(detected);
  };

  const input = () => {
    const parsed = apiKeySchema.safeParse({ apiKey, baseUrl: provider === 'custom' ? baseUrl : undefined });
    if (!parsed.success) {
      setError(firstIssue(parsed.error));
      return null;
    }
    if (!provider) {
      setError('Choose which AI this key is for.');
      return null;
    }
    return { provider, apiKey: parsed.data.apiKey, ...(parsed.data.baseUrl ? { baseUrl: parsed.data.baseUrl } : {}) };
  };

  const runCheck = async () => {
    const request = input();
    if (!request) return;
    setBusy(true);
    setError(null);
    try {
      const result = await checkKey(request);
      setCheck(result);
      setModel(result.suggested ?? '');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const request = input();
    if (!request) return;
    const parsedModel = modelIdSchema.safeParse(model);
    if (!parsedModel.success) return setError(firstIssue(parsedModel.error));
    setBusy(true);
    setError(null);
    try {
      await storeKey({ ...request, model: parsedModel.data, ...(label.trim() ? { label: label.trim() } : {}) });
      setDone(`${providerOption(request.provider).name} is ready: your analyses now use ${parsedModel.data}.`);
      reset();
      await queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const act = async (run: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await run();
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
        <View style={styles.hero}>
          <IconTile icon="sparkles" size={44} />
          <View style={styles.fill}>
            <Heading>Use any AI</Heading>
            <Caption>Claude, ChatGPT, Gemini, Grok, OpenRouter, Groq, Mistral, Together or any OpenAI-compatible service.</Caption>
          </View>
        </View>
        <Body muted>
          Paste a key and MatIQ finds the models it can use, then tests the one you pick with one small picture before saving it. Your
          analyses then run on your account with that provider, beyond your monthly MatIQ quota. The key is encrypted on our servers and
          never shown again, logged or stored on this phone.
        </Body>
      </Card>

      {done ? <StatusText>{done}</StatusText> : null}

      {stored.length > 0 ? (
        <>
          <SectionHeader title="Your AI keys" />
          {stored.map((key) => (
            <StoredKeyCard
              key={key.provider}
              stored={key}
              busy={busy}
              onUse={() => void act(() => selectKey(key.provider))}
              onRemove={() => void act(() => deleteKey(key.provider))}
            />
          ))}
        </>
      ) : null}

      <SectionHeader title={stored.length > 0 ? 'Add another AI' : 'Add your AI'} />
      <Card>
        <TextField
          label="API key"
          value={apiKey}
          onChangeText={changeKey}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="off"
          importantForAutofill="no"
          textContentType="none"
          contextMenuHidden
          maxLength={500}
        />
        <ChoiceChips
          label="Which AI is this key for?"
          options={PROVIDER_CHIPS}
          value={provider}
          onChange={(next) => {
            setProvider(next);
            setCheck(null);
          }}
          columns={3}
        />
        {option ? (
          <Caption>
            {option.detail}
            {option.keyPage ? ` · keys at ${option.keyPage}` : ''}
          </Caption>
        ) : (
          <Caption>Paste a key: most providers are recognised automatically.</Caption>
        )}
        {provider === 'custom' ? (
          <TextField
            label="Service address"
            value={baseUrl}
            onChangeText={(text) => {
              setBaseUrl(text);
              setCheck(null);
            }}
            placeholder="https://api.example.com/v1"
            autoCapitalize="none"
            keyboardType="url"
            maxLength={300}
          />
        ) : null}

        {check ? (
          <View style={styles.stack}>
            <Heading>Choose a model</Heading>
            {check.listed && check.models.length > 0 ? (
              <ModelPicker models={check.models} value={model} onChange={setModel} />
            ) : (
              <Caption>This service doesn't list its models. Type the ID of a model that can read images.</Caption>
            )}
            <TextField label="Model ID" value={model} onChangeText={setModel} autoCapitalize="none" maxLength={200} />
            <TextField label="Label (optional)" value={label} onChangeText={setLabel} maxLength={40} />
          </View>
        ) : null}

        <ErrorText>{error}</ErrorText>
        {check ? (
          <>
            <Button label="Test and save" icon="checkmark-circle" onPress={() => void save()} loading={busy} />
            <Button label="Cancel" variant="secondary" onPress={reset} disabled={busy} />
          </>
        ) : (
          <Button label="Check key" icon="key" onPress={() => void runCheck()} loading={busy} disabled={!apiKey.trim()} />
        )}
      </Card>
      <Caption>
        Pick a model that can read images: MatIQ sends it frames from your recording. Usage is billed to your account with that provider.
      </Caption>
    </Screen>
  );
}

function StoredKeyCard({ stored, busy, onUse, onRemove }: { stored: StoredKey; busy: boolean; onUse: () => void; onRemove: () => void }) {
  const option = providerOption(stored.provider);
  return (
    <Card>
      <View style={styles.hero}>
        <IconTile icon="hardware-chip" tone={stored.active ? 'success' : 'neutral'} />
        <View style={styles.fill}>
          <Text style={font.heading}>
            {option.name}
            {stored.label ? <Text style={font.caption}>{`  ${stored.label}`}</Text> : null}
          </Text>
          <Caption>
            {stored.model ?? 'Default model'} · key …{stored.last4}
          </Caption>
          {stored.base_url ? <Caption>{stored.base_url}</Caption> : null}
        </View>
        {stored.active ? <Badge label="In use" tone="success" icon="checkmark" /> : null}
      </View>
      <Caption>
        Added {new Date(stored.created_at).toLocaleDateString()}
        {stored.last_used_at ? ` · last used ${new Date(stored.last_used_at).toLocaleDateString()}` : ''}
      </Caption>
      <View style={styles.actions}>
        {!stored.active ? <Button label="Use for my analyses" size="sm" onPress={onUse} disabled={busy} /> : null}
        <Button label={`Remove ${option.name} key`} variant="danger" size="sm" onPress={onRemove} disabled={busy} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, gap: 2 },
  stack: { gap: spacing.md },
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
