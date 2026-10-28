import { useLocalSearchParams, useRouter } from 'expo-router';
import { useUserId } from '@/features/auth/AuthProvider';
import { DualInputHandler } from '@/features/capture/DualInputHandler';
import { useRankedRecording } from '@/features/ranked/recording';
import { Loading, Screen } from '@/ui/components';

export default function RecordScreen() {
  const userId = useUserId();
  const router = useRouter();
  const { ranked: rankedId } = useLocalSearchParams<{ ranked?: string }>();
  const ranked = useRankedRecording(rankedId, userId);

  if (ranked.isLoading) return <Loading />;
  const context = ranked.data ?? null;

  return (
    <Screen>
      {/* Keyed so switching between ranked and casual starts a fresh setup. */}
      <DualInputHandler key={context?.id ?? 'casual'} ranked={context} onExitRanked={() => router.setParams({ ranked: undefined })} />
    </Screen>
  );
}
