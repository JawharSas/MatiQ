/**
 * Dual input: record a round live or upload a video from the gallery.
 *
 * Both modes feed the same pipeline:
 *   draft match -> SampledFrame stream -> FrameUploadQueue (progressive,
 *   bounded) -> optional native video upload -> analyze-match -> dashboard
 *
 * Live recordings with live sampling also run live analysis: uploaded frames
 * are analysed in batches during the round (provisional score on screen) and
 * finalize only analyses what is left.
 *
 * Ranked recordings fix the ruleset agreed in the challenge and link the
 * draft to the ranked match before any upload; the recorder is Fighter 1.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/ui/text';
import { useUserId } from '@/features/auth/AuthProvider';
import { useStoredKeys } from '@/features/api-keys/api';
import { linkRankedMatch } from '@/features/ranked/api';
import { type RankedRecording, rankedSetup } from '@/features/ranked/recording';
import { remainingAnalyses, useMyUsage } from '@/features/usage/useMyUsage';
import { errorMessage } from '@/lib/errors';
import { matchSetupSchema } from '@/lib/validation';
import { Body, Button, Caption, Card, ErrorText, Heading, IconTile, ProgressBar, Segmented, StatusText } from '@/ui/components';
import { font } from '@/ui/theme';
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
  type VideoStage,
} from './match-session';
import { FrameUploadQueue } from './upload-queue';
import type { CapturePlan } from './capture-plan';
import { cancelLiveAnalysis, finalizeLiveAnalysis, LiveBatcher, startLiveAnalysis } from './live-analysis';
import type { LiveMatchInfo } from './LiveScoreboard';
import type { LiveCaptureResult } from './useLiveCapture';
import { extractFrames } from './video-frame-extractor';
import { MAX_VIDEO_SECONDS } from './video-quality';
import { type PickedVideo, VideoUploader } from './VideoUploader';

/** Frame budget per analysis (matches the server's ANALYSIS_MAX_FRAMES default). */
const MAX_FRAMES = 240;
const MIN_FRAMES = 3;

const VIDEO_STAGES: Record<VideoStage, string> = {
  checking: 'checking the video',
  compressing: 'compressing the video',
  uploading: 'uploading the video',
};

type Mode = 'live' | 'upload';
type Phase =
  | { kind: 'setup' }
  | { kind: 'capture' }
  | { kind: 'processing'; step: string; progress?: number }
  | { kind: 'failed'; message: string };

export function DualInputHandler({ ranked = null, onExitRanked }: { ranked?: RankedRecording | null; onExitRanked?: () => void }) {
  const userId = useUserId();
  const router = useRouter();
  const queryClient = useQueryClient();
  const usage = useMyUsage();
  const keys = useStoredKeys();

  const [mode, setMode] = useState<Mode>('live');
  const [setup, setSetup] = useState<MatchSetup>(() => (ranked ? rankedSetup(ranked) : defaultSetup()));
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const matchIdRef = useRef<string | null>(null);
  const queueRef = useRef<FrameUploadQueue | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const batcherRef = useRef<LiveBatcher | null>(null);
  const [liveMatch, setLiveMatch] = useState<LiveMatchInfo | null>(null);

  const maxDurationMs = Math.min(usage.data?.max_video_seconds ?? MAX_VIDEO_SECONDS, MAX_VIDEO_SECONDS) * 1000;
  const remaining = remainingAnalyses(usage.data);
  const outOfQuota = setup.keySource === 'platform' && remaining === 0;

  const validSetup = (): MatchSetup | null => {
    const parsed = matchSetupSchema.safeParse(setup);
    if (!parsed.success) {
      setPhase({ kind: 'failed', message: 'Check the match details.' });
      return null;
    }
    const clean = { ...setup, ...parsed.data };
    // The ranked ruleset can't be changed from the form, but never trust state.
    return ranked ? { ...clean, discipline: ranked.discipline, variant: ranked.variant } : clean;
  };

  const openSession = async (cleanSetup: MatchSetup, durationMs: number, { live = false } = {}) => {
    const matchId = await createDraftMatch(cleanSetup, mode, durationMs);
    if (ranked) {
      try {
        await linkRankedMatch(ranked.id, matchId);
      } catch (error) {
        await discardMatch(userId, matchId).catch(() => undefined);
        throw error;
      }
    }
    matchIdRef.current = matchId;
    const batcher = live ? new LiveBatcher(matchId) : null;
    batcherRef.current = batcher;
    queueRef.current = new FrameUploadQueue(async (frame) => {
      await uploadFrame(userId, matchId, frame);
      batcher?.onUploaded(frame.t);
    });
    return matchId;
  };

  const finishSession = async (cleanSetup: MatchSetup, matchId: string) => {
    setPhase({ kind: 'processing', step: 'Uploading frames' });
    const stats = await queueRef.current!.flush();
    if (stats.uploaded < MIN_FRAMES) throw new Error('Not enough frames were uploaded.');

    setPhase({ kind: 'processing', step: 'Starting analysis' });
    if (batcherRef.current) {
      // Live analysis: batches are already running; analyse what is left.
      await batcherRef.current.settle();
      await finalizeLiveAnalysis(matchId);
    } else {
      await requestAnalysis(matchId, cleanSetup);
    }
    await queryClient.invalidateQueries({ queryKey: ['my-usage'] });
    await queryClient.invalidateQueries({ queryKey: ['my-matches'] });
    if (ranked) await queryClient.invalidateQueries({ queryKey: ['ranked'] });
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
    video: { uri: string; durationMs: number; verified?: PickedVideo['verified'] },
    { sampleFrames }: { sampleFrames: boolean },
  ) => {
    const queue = queueRef.current!;
    const controller = new AbortController();
    abortRef.current = controller;

    let extraction = sampleFrames ? 0 : 1;
    let videoProgress = cleanSetup.uploadVideo ? 0 : 1;
    let videoStage: VideoStage | null = cleanSetup.uploadVideo ? 'checking' : null;
    const report = () => {
      const step = [sampleFrames && extraction < 1 ? 'Sampling frames' : null, videoStage ? VIDEO_STAGES[videoStage] : null]
        .filter(Boolean)
        .join(' and ');
      setPhase({
        kind: 'processing',
        step: step.charAt(0).toUpperCase() + step.slice(1),
        progress: (extraction + videoProgress) / 2,
      });
    };
    if (sampleFrames || videoStage) report();

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
            ...(video.verified ? { verified: video.verified } : {}),
            durationMs: video.durationMs,
            signal: controller.signal,
            onStage: (stage) => {
              videoStage = stage;
              report();
            },
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
        { uri: result.videoUri, durationMs: result.durationMs },
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
    batcherRef.current = null;
    setLiveMatch(null);
    abortRef.current = null;
    setPhase({ kind: 'setup' });
  };

  const discard = async () => {
    abortRef.current?.abort();
    const matchId = matchIdRef.current;
    const wasLive = batcherRef.current !== null;
    reset();
    if (!matchId) return;
    // Refund the live session's quota unit before deleting the match.
    if (wasLive) await cancelLiveAnalysis(matchId).catch(() => undefined);
    await discardMatch(userId, matchId).catch(() => undefined);
  };

  /** Creates the draft (and the live session when frames are sampled live). */
  const prepareLiveRecording = async (plan: CapturePlan) => {
    const cleanSetup = validSetup();
    if (!cleanSetup) throw new Error('invalid setup');
    // Duration is finalised when recording stops.
    const matchId = await openSession(cleanSetup, maxDurationMs, { live: plan.liveSampling });
    if (!plan.liveSampling) return;
    try {
      // Reserves the quota unit up front: an exhausted quota stops here,
      // before the user records a round that could not be analysed.
      await startLiveAnalysis(matchId, cleanSetup);
    } catch (error) {
      reset();
      await discardMatch(userId, matchId).catch(() => undefined);
      throw error;
    }
    setLiveMatch({
      id: matchId,
      discipline: cleanSetup.discipline,
      variant: cleanSetup.variant,
      athleteALabel: cleanSetup.athleteALabel,
      athleteBLabel: cleanSetup.athleteBLabel,
    });
  };

  // Render -------------------------------------------------------------------
  if (phase.kind === 'capture' && mode === 'live') {
    return (
      <LiveRecorder
        maxDurationMs={maxDurationMs}
        maxFrames={MAX_FRAMES}
        onFrame={(frame) => queueRef.current?.enqueue(frame)}
        uploadPressure={() => queueRef.current?.pressure ?? 0}
        onBeforeStart={prepareLiveRecording}
        liveMatch={liveMatch}
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
        <StatusText>{phase.step}…</StatusText>
        {phase.progress !== undefined ? (
          <ProgressBar label={phase.step} value={phase.progress} />
        ) : null}
        {phase.progress !== undefined ? <Body>{Math.round(phase.progress * 100)}%</Body> : null}
        <Caption>Keep MatIQ open until the analysis starts. Results then appear on the match screen automatically.</Caption>
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
      {ranked ? (
        <Card>
          <Heading>Ranked: {ranked.myName} vs {ranked.opponentName}</Heading>
          <Caption>
            You are Fighter 1. After the analysis, {ranked.opponentName} can watch the recording and confirm or dispute the
            result. A win you record only counts once they confirm it.
          </Caption>
          {onExitRanked ? <Button label="Record a casual match instead" variant="secondary" onPress={onExitRanked} /> : null}
        </Card>
      ) : null}
      <MatchSetupForm value={setup} onChange={setSetup} ownKey={keys.data?.find((key) => key.active) ?? null} rulesetLocked={ranked !== null} />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconTile icon="flash" tone={outOfQuota ? 'danger' : 'accent'} />
          <View style={{ flex: 1 }}>
            <Text style={font.heading}>
              {remaining === 'unlimited'
                ? 'Unlimited analyses'
                : remaining === null
                  ? 'Checking your quota…'
                  : `${remaining} of ${usage.data?.monthly_limit ?? 0} analyses left`}
            </Text>
            <Caption>{remaining === 'unlimited' ? 'No monthly limit on this account' : 'Resets at the start of each month'}</Caption>
          </View>
        </View>
        {phase.kind === 'failed' ? <ErrorText>{phase.message}</ErrorText> : null}
        {usage.data?.is_suspended ? <ErrorText>This account is suspended.</ErrorText> : null}
        <Button
          label={mode === 'live' ? 'Open camera' : 'Choose a video'}
          icon={mode === 'live' ? 'videocam' : 'cloud-upload'}
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
