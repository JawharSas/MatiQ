/**
 * Dual input: record a round live or upload a video from the gallery.
 *
 * Both modes feed the same pipeline:
 *   draft match -> SampledFrame stream -> FrameUploadQueue (progressive,
 *   bounded) -> optional native video upload -> analyze-match -> dashboard
 */

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useUserId } from '@/features/auth/AuthProvider';
import { useStoredKeys } from '@/features/api-keys/api';
import { remainingAnalyses, useMyUsage } from '@/features/usage/useMyUsage';
import { errorMessage } from '@/lib/errors';
import { matchSetupSchema } from '@/lib/validation';
import { Body, Button, Caption, Card, ErrorText, Heading, Segmented } from '@/ui/components';
import { LiveRecorder } from './LiveRecorder';
import { defaultSetup, MatchSetupForm } from './MatchSetupForm';
import {
  createDraftMatch,
  deleteLocalFile,
  discardMatch,
  finalizeDuration,
  type MatchSetup,
  requestAnalysis,
  uploadFrame,
  uploadVideo,
} from './match-session';
import { FrameUploadQueue } from './upload-queue';
import type { LiveCaptureResult } from './useLiveCapture';
import { extractFrames } from './video-frame-extractor';
import { type PickedVideo, VideoUploader } from './VideoUploader';

/** Frame budget per analysis (matches the server's ANALYSIS_MAX_FRAMES default). */
const MAX_FRAMES = 240;
const MIN_FRAMES = 3;

type Mode = 'live' | 'upload';
type Phase =
  | { kind: 'setup' }
  | { kind: 'capture' }
  | { kind: 'processing'; step: string; progress?: number }
  | { kind: 'failed'; message: string };

export function DualInputHandler() {
  const userId = useUserId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const usage = useMyUsage();
  const keys = useStoredKeys();

  const [mode, setMode] = useState<Mode>('live');
  const [setup, setSetup] = useState<MatchSetup>(defaultSetup());
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const matchIdRef = useRef<string | null>(null);
  const queueRef = useRef<FrameUploadQueue | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const maxDurationMs = (usage.data?.max_video_seconds ?? 600) * 1000;
  const remaining = remainingAnalyses(usage.data);
  const outOfQuota = setup.keySource === 'platform' && remaining === 0;

  const validSetup = (): MatchSetup | null => {
    const parsed = matchSetupSchema.safeParse(setup);
    if (!parsed.success) {
      setPhase({ kind: 'failed', message: 'Check the match details.' });
      return null;
    }
    return { ...setup, ...parsed.data };
  };

  const openSession = async (cleanSetup: MatchSetup, durationMs: number) => {
    const matchId = await createDraftMatch(cleanSetup, mode, durationMs);
    matchIdRef.current = matchId;
    queueRef.current = new FrameUploadQueue((frame) => uploadFrame(userId, matchId, frame));
    return matchId;
  };

  const finishSession = async (cleanSetup: MatchSetup, matchId: string) => {
    setPhase({ kind: 'processing', step: 'Uploading frames' });
    const stats = await queueRef.current!.flush();
    if (stats.uploaded < MIN_FRAMES) throw new Error('Not enough frames were uploaded.');

    setPhase({ kind: 'processing', step: 'Starting analysis' });
    await requestAnalysis(matchId, cleanSetup);
    await queryClient.invalidateQueries({ queryKey: ['my-usage'] });
    await queryClient.invalidateQueries({ queryKey: ['my-matches'] });
    reset();
    router.push({ pathname: '/match/[id]', params: { id: matchId } });
  };

  const fail = (error: unknown) => setPhase({ kind: 'failed', message: errorMessage(error) });

  /**
   * Samples frames from a video file (when they were not sampled live) and
   * uploads the video, in parallel, reporting combined progress.
   */
  const processVideoFile = async (
    cleanSetup: MatchSetup,
    matchId: string,
    video: { uri: string; durationMs: number; mimeType: PickedVideo['mimeType'] },
    { sampleFrames }: { sampleFrames: boolean },
  ) => {
    const queue = queueRef.current!;
    const controller = new AbortController();
    abortRef.current = controller;

    let extraction = sampleFrames ? 0 : 1;
    let videoProgress = cleanSetup.uploadVideo ? 0 : 1;
    const step = [sampleFrames ? 'Sampling frames' : null, cleanSetup.uploadVideo ? 'uploading video' : null]
      .filter(Boolean)
      .join(' and ');
    const report = () =>
      setPhase({
        kind: 'processing',
        step: step.charAt(0).toUpperCase() + step.slice(1),
        progress: (extraction + videoProgress) / 2,
      });
    if (step) report();

    await Promise.all([
      sampleFrames
        ? extractFrames(video.uri, {
            durationMs: video.durationMs,
            maxFrames: MAX_FRAMES,
            onFrame: (frame) => queue.enqueue(frame),
            onProgress: (fraction) => {
              extraction = fraction;
              report();
            },
            uploadPressure: () => queue.pressure,
            signal: controller.signal,
          })
        : Promise.resolve(),
      cleanSetup.uploadVideo
        ? uploadVideo(userId, matchId, video.uri, {
            mimeType: video.mimeType,
            signal: controller.signal,
            onProgress: (fraction) => {
              videoProgress = fraction;
              report();
            },
          })
        : Promise.resolve(),
    ]);
  };

  // Live mode ----------------------------------------------------------------
  const onLiveFinished = async (result: LiveCaptureResult) => {
    const matchId = matchIdRef.current;
    const cleanSetup = validSetup();
    if (!matchId || !cleanSetup) return;
    try {
      await finalizeDuration(matchId, result.durationMs);
      // Plans without the live analysis stream (needed to keep 60 FPS on
      // some devices) sample the recorded file instead.
      await processVideoFile(
        cleanSetup,
        matchId,
        { uri: result.videoUri, durationMs: result.durationMs, mimeType: 'video/mp4' },
        { sampleFrames: !result.liveSampled },
      );
      deleteLocalFile(result.videoUri);
      await finishSession(cleanSetup, matchId);
    } catch (error) {
      fail(error);
    }
  };

  // Upload mode --------------------------------------------------------------
  const onVideoPicked = async (video: PickedVideo) => {
    const cleanSetup = validSetup();
    if (!cleanSetup) return;
    try {
      setPhase({ kind: 'processing', step: 'Preparing' });
      const matchId = await openSession(cleanSetup, video.durationMs);
      await processVideoFile(cleanSetup, matchId, video, { sampleFrames: true });
      await finishSession(cleanSetup, matchId);
    } catch (error) {
      fail(error);
    }
  };

  const reset = () => {
    queueRef.current?.clear();
    queueRef.current = null;
    matchIdRef.current = null;
    abortRef.current = null;
    setPhase({ kind: 'setup' });
  };

  const discard = async () => {
    abortRef.current?.abort();
    const matchId = matchIdRef.current;
    reset();
    if (matchId) await discardMatch(userId, matchId).catch(() => undefined);
  };

  // Render -------------------------------------------------------------------
  if (phase.kind === 'capture' && mode === 'live') {
    return (
      <LiveRecorder
        maxDurationMs={maxDurationMs}
        maxFrames={MAX_FRAMES}
        onFrame={(frame) => queueRef.current?.enqueue(frame)}
        uploadPressure={() => queueRef.current?.pressure ?? 0}
        onBeforeStart={async () => {
          const cleanSetup = validSetup();
          if (!cleanSetup) throw new Error('invalid setup');
          // Duration is finalised when recording stops.
          await openSession(cleanSetup, maxDurationMs);
        }}
        onFinished={(result) => void onLiveFinished(result)}
        onCancel={() => void discard()}
      />
    );
  }

  if (phase.kind === 'capture' && mode === 'upload') {
    return <VideoUploader maxDurationMs={maxDurationMs} onPicked={(video) => void onVideoPicked(video)} onCancel={reset} />;
  }

  if (phase.kind === 'processing') {
    return (
      <Card>
        <Heading>{phase.step}…</Heading>
        {phase.progress !== undefined ? <Body>{Math.round(phase.progress * 100)}%</Body> : null}
        <Caption>Keep MatIQ open until the analysis starts. You will be notified when results are ready.</Caption>
        <Button label="Cancel" variant="secondary" onPress={() => void discard()} />
      </Card>
    );
  }

  return (
    <View style={{ gap: 16 }}>
      <Segmented
        options={[
          { value: 'live', label: 'Record live' },
          { value: 'upload', label: 'Upload video' },
        ]}
        value={mode}
        onChange={setMode}
      />
      <MatchSetupForm value={setup} onChange={setSetup} hasOwnKey={(keys.data?.length ?? 0) > 0} />
      <Card>
        <Caption>
          {remaining === 'unlimited'
            ? 'Unlimited analyses'
            : remaining === null
              ? 'Checking your analysis quota…'
              : `${remaining} of ${usage.data?.monthly_limit ?? 0} analyses left this month`}
        </Caption>
        {phase.kind === 'failed' ? <ErrorText>{phase.message}</ErrorText> : null}
        {usage.data?.is_suspended ? <ErrorText>This account is suspended.</ErrorText> : null}
        <Button
          label={mode === 'live' ? 'Open camera' : 'Choose a video'}
          disabled={outOfQuota || usage.data?.is_suspended === true}
          onPress={() => setPhase({ kind: 'capture' })}
        />
        {phase.kind === 'failed' && matchIdRef.current ? (
          <Button label="Discard this capture" variant="danger" onPress={() => void discard()} />
        ) : null}
      </Card>
    </View>
  );
}
