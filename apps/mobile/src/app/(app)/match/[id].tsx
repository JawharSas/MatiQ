import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Alert } from 'react-native';
import { z } from 'zod';
import { MatchDashboard } from '@/features/analysis/MatchDashboard';
import { resolveClip } from '@/features/analysis/technique-breakdown';
import { useMatch, useMatchVideoUrl } from '@/features/analysis/useMatch';
import { useStoredKeys } from '@/features/api-keys/api';
import { useUserId } from '@/features/auth/AuthProvider';
import { cancelLiveAnalysis } from '@/features/capture/live-analysis';
import { discardMatch, requestAnalysis } from '@/features/capture/match-session';
import { useRankedForMatch } from '@/features/ranked/api';
import { describeRanked } from '@/features/ranked/ranked-state';
import { errorMessage, messageFor } from '@/lib/errors';
import { Body, Button, Caption, Card, ErrorText, Heading, Loading, Screen, StatusText } from '@/ui/components';

const paramsSchema = z.object({
  id: z.string().uuid(),
  // Optional highlight range in ms (feed "play highlight" links).
  t: z.coerce.number().int().min(0).optional(),
  end: z.coerce.number().int().min(0).optional(),
});

export default function MatchScreen() {
  const params = paramsSchema.safeParse(useLocalSearchParams());
  if (!params.success) {
    return (
      <Screen>
        <ErrorText>Invalid match link.</ErrorText>
      </Screen>
    );
  }
  return <MatchView id={params.data.id} clipStart={params.data.t} clipEnd={params.data.end} />;
}

function MatchView({ id, clipStart, clipEnd }: { id: string; clipStart?: number; clipEnd?: number }) {
  const userId = useUserId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const match = useMatch(id);
  const video = useMatchVideoUrl(match.data);
  const isOwner = match.data?.owner_id === userId;
  // Only needed to offer a BYOK retry on the owner's failed matches.
  const keys = useStoredKeys(isOwner && match.data?.status === 'failed');
  const ranked = useRankedForMatch(id);
  const retry = useMutation({
    mutationFn: (keySource: 'platform' | 'byok') => requestAnalysis(id, { keySource }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['match', id] }),
  });

  if (match.isPending) return <Loading />;
  if (!match.data) {
    return (
      <Screen>
        <ErrorText>{errorMessage(match.error)}</ErrorText>
      </Screen>
    );
  }

  const data = match.data;
  const hasStoredKey = (keys.data?.length ?? 0) > 0;
  const title = data.title || `${data.athlete_a_label} vs ${data.athlete_b_label}`;

  const rankedPending = ranked.data?.status === 'awaiting_confirmation' || ranked.data?.status === 'disputed';
  const remove = () =>
    Alert.alert(
      'Delete this match?',
      `The video, analysis and any posts sharing it will be permanently deleted.${rankedPending ? ' The unconfirmed ranked result will be voided.' : ''}`,
      [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          // An abandoned live session still holds a quota reservation: release it first.
          if (data.status === 'live') await cancelLiveAnalysis(id).catch(() => undefined);
          await discardMatch(userId, id);
          await queryClient.invalidateQueries({ queryKey: ['my-matches'] });
          await queryClient.invalidateQueries({ queryKey: ['ranked'] });
          router.back();
        },
      },
      ],
    );

  const rankedView = ranked.data ? describeRanked(ranked.data, userId) : null;

  return (
    <Screen>
      <Stack.Screen options={{ title }} />
      {ranked.data && rankedView ? (
        <Card>
          <Heading>Ranked match</Heading>
          <Body muted>{rankedView.label}</Body>
          <Button
            label={rankedView.canConfirm ? 'Confirm or dispute the result' : 'Ranked details'}
            variant={rankedView.canConfirm ? 'primary' : 'secondary'}
            onPress={() => router.push({ pathname: '/ranked/match/[id]', params: { id: ranked.data!.id } })}
          />
        </Card>
      ) : null}
      {data.status === 'live' ? (
        <Card>
          <Heading>Live analysis in progress</Heading>
          <Body muted>
            This round is being recorded and analysed. If the recording was interrupted, delete the match to release its analysis
            credit.
          </Body>
        </Card>
      ) : null}
      {data.status === 'queued' || data.status === 'processing' ? (
        <Card>
          {/* Announced when it changes (WCAG 4.1.3); the results replace it when ready. */}
          <StatusText>{data.status === 'queued' ? 'Queued for analysis' : 'Analysing your round…'}</StatusText>
          <Body muted>This usually takes a minute or two. This screen updates automatically.</Body>
        </Card>
      ) : null}
      {data.status === 'failed' ? (
        <Card>
          <Heading>Analysis failed</Heading>
          <Body muted>{messageFor(data.error_code ?? undefined, 'The analysis could not be completed. Your quota was not charged.')}</Body>
          {isOwner ? (
            <>
              <Button label="Retry analysis" loading={retry.isPending} onPress={() => retry.mutate('platform')} />
              {hasStoredKey ? (
                <Button label="Retry with my API key" variant="secondary" disabled={retry.isPending} onPress={() => retry.mutate('byok')} />
              ) : null}
              <ErrorText>{retry.error ? errorMessage(retry.error) : null}</ErrorText>
            </>
          ) : null}
        </Card>
      ) : null}
      {data.status === 'completed' ? (
        <MatchDashboard match={data} videoUrl={video.data} initialClip={resolveClip(clipStart, clipEnd, data.duration_ms)} />
      ) : null}
      {isOwner && data.status === 'completed' ? (
        <Button label="Share to feed" onPress={() => router.push({ pathname: '/share/[matchId]', params: { matchId: id } })} />
      ) : null}
      {isOwner ? <Button label="Delete match" variant="danger" onPress={remove} /> : null}
      <Caption>Only you can see this match unless you share it.</Caption>
    </Screen>
  );
}
