import { useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { z } from 'zod';
import { MatchDashboard } from '@/features/analysis/MatchDashboard';
import { useMatch, useMatchVideoUrl } from '@/features/analysis/useMatch';
import { useUserId } from '@/features/auth/AuthProvider';
import { discardMatch } from '@/features/capture/match-session';
import { errorMessage, messageFor } from '@/lib/errors';
import { Body, Button, Caption, Card, ErrorText, Heading, Loading, Screen } from '@/ui/components';

const paramsSchema = z.object({ id: z.string().uuid() });

export default function MatchScreen() {
  const params = paramsSchema.safeParse(useLocalSearchParams());
  if (!params.success) {
    return (
      <Screen>
        <ErrorText>Invalid match link.</ErrorText>
      </Screen>
    );
  }
  return <MatchView id={params.data.id} />;
}

function MatchView({ id }: { id: string }) {
  const userId = useUserId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const match = useMatch(id);
  const video = useMatchVideoUrl(match.data);

  if (match.isPending) return <Loading />;
  if (!match.data) {
    return (
      <Screen>
        <ErrorText>{errorMessage(match.error)}</ErrorText>
      </Screen>
    );
  }

  const data = match.data;
  const isOwner = data.owner_id === userId;
  const title = data.title || `${data.athlete_a_label} vs ${data.athlete_b_label}`;

  const remove = () =>
    Alert.alert('Delete this match?', 'The video, analysis and any posts sharing it will be permanently deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await discardMatch(userId, id);
          await queryClient.invalidateQueries({ queryKey: ['my-matches'] });
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      {data.status === 'queued' || data.status === 'processing' ? (
        <Card>
          <Heading>{data.status === 'queued' ? 'Queued for analysis' : 'Analysing your round…'}</Heading>
          <Body muted>This usually takes a minute or two. This screen updates automatically.</Body>
        </Card>
      ) : null}
      {data.status === 'failed' ? (
        <Card>
          <Heading>Analysis failed</Heading>
          <Body muted>{messageFor(data.error_code ?? undefined, 'The analysis could not be completed. Your quota was not charged.')}</Body>
        </Card>
      ) : null}
      {data.status === 'completed' ? <MatchDashboard match={data} videoUrl={video.data} /> : null}
      {isOwner && data.status === 'completed' ? (
        <Button label="Share to feed" onPress={() => router.push({ pathname: '/share/[matchId]', params: { matchId: id } })} />
      ) : null}
      {isOwner ? <Button label="Delete match" variant="danger" onPress={remove} /> : null}
      <Caption>Only you can see this match unless you share it.</Caption>
    </Screen>
  );
}
