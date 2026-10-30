import { formatClock } from '@matiq/rules-engine';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { onVideo, radius, spacing } from '@/ui/theme';
import { type TelemetryStore, useTelemetry } from './capture-telemetry';

/**
 * Overlay with frame rate, recording clock and sampling stats. This is the
 * only component that re-renders while recording; the camera view does not.
 */
export function CaptureHud({ telemetry, maxDurationMs }: { telemetry: TelemetryStore; maxDurationMs: number }) {
  const targetFps = useTelemetry(telemetry, (t) => t.plan?.fps ?? null);
  const liveSampling = useTelemetry(telemetry, (t) => t.plan?.liveSampling ?? null);
  const configuredFps = useTelemetry(telemetry, (t) => t.configuredFps);
  const measuredFps = useTelemetry(telemetry, (t) => t.measuredFps);
  const startedAt = useTelemetry(telemetry, (t) => t.recordingStartedAt);
  const keptFrames = useTelemetry(telemetry, (t) => t.keptFrames);
  const warning = useTelemetry(telemetry, (t) => t.warning);

  const elapsedMs = useElapsed(startedAt);
  const recording = startedAt > 0;
  const remaining = Math.max(0, maxDurationMs - elapsedMs);

  const shownFps = measuredFps ?? configuredFps ?? targetFps;
  const healthy = targetFps === null || shownFps === null || shownFps >= targetFps * 0.9;

  return (
    <View style={styles.hud} pointerEvents="none">
      <View style={styles.row}>
        <View style={styles.badge}>
          <View style={[styles.dot, { backgroundColor: healthy ? onVideo.success : onVideo.warning }]} />
          <Text style={styles.text} accessibilityLabel={`${shownFps ?? 'unknown'} frames per second`}>
            {shownFps === null ? '… FPS' : `${shownFps} FPS`}
            {measuredFps !== null ? ' live' : ''}
          </Text>
        </View>
        {recording ? (
          <View style={styles.badge}>
            <View style={[styles.dot, { backgroundColor: onVideo.danger }]} />
            <Text style={styles.text}>{formatClock(elapsedMs)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.badge}>
        <Text style={styles.caption}>
          {liveSampling === null
            ? 'Checking camera…'
            : liveSampling
              ? recording
                ? `AI frames: ${keptFrames} sampled live`
                : 'AI frames sampled live while recording'
              : 'AI frames sampled after recording'}
        </Text>
      </View>
      {recording && remaining < 30_000 ? <Text style={styles.warning}>{Math.ceil(remaining / 1000)}s left</Text> : null}
      {warning ? <Text style={styles.warning}>{warning}</Text> : null}
    </View>
  );
}

/** Local 4 Hz clock, so only this component ticks. */
function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === 0) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === 0 ? 0 : Math.max(0, now - startedAt);
}

const styles = StyleSheet.create({
  hud: { position: 'absolute', top: spacing.lg, left: spacing.lg, right: spacing.lg, gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { color: onVideo.text, fontVariant: ['tabular-nums'], fontWeight: '700' },
  caption: { color: onVideo.text, fontSize: 12 },
  warning: {
    alignSelf: 'flex-start',
    color: onVideo.warning,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
});
