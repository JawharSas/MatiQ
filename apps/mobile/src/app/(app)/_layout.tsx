import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { acceptCurrentVersions, missingAcceptances } from '@/features/legal/consent';
import { LEGAL_DOCUMENTS } from '@/features/legal/documents';
import { errorMessage } from '@/lib/errors';
import { Body, Button, Card, ErrorText, Loading, Screen, Title } from '@/ui/components';
import { colors } from '@/ui/theme';

/**
 * Signed-in area. Before anything else, the user must have accepted the
 * current Terms and Privacy Policy versions (re-prompted when they change).
 */
export default function AppLayout() {
  const consent = useQuery({ queryKey: ['consent'], queryFn: missingAcceptances, staleTime: Infinity });

  if (consent.isPending) return <Loading />;
  if (consent.data && consent.data.length > 0) return <ConsentGate missing={consent.data} />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="match/[id]" options={{ title: 'Match' }} />
      <Stack.Screen name="share/[matchId]" options={{ title: 'Share', presentation: 'modal' }} />
      <Stack.Screen name="user/[id]" options={{ title: '' }} />
      <Stack.Screen name="friends" options={{ title: 'Friends' }} />
      <Stack.Screen name="settings/index" options={{ title: 'Settings' }} />
      <Stack.Screen name="settings/api-keys" options={{ title: 'API keys' }} />
      <Stack.Screen name="admin" options={{ title: 'Owner panel' }} />
    </Stack>
  );
}

function ConsentGate({ missing }: { missing: ('terms' | 'privacy')[] }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await acceptCurrentVersions(missing);
      await queryClient.invalidateQueries({ queryKey: ['consent'] });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Title>Please review our policies</Title>
      {missing.map((id) => (
        <Card key={id}>
          <Body>{LEGAL_DOCUMENTS[id].summary}</Body>
          <Link href={{ pathname: '/legal/[doc]', params: { doc: id } }}>
            <Body>Read the {LEGAL_DOCUMENTS[id].title} (version {LEGAL_DOCUMENTS[id].version})</Body>
          </Link>
        </Card>
      ))}
      <ErrorText>{error}</ErrorText>
      <Button label="I agree" onPress={() => void accept()} loading={busy} />
    </Screen>
  );
}
