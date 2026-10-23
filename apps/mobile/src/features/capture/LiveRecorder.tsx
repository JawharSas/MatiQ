import { useIsFocused } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, useCameraPermission, useMicrophonePermission } from 'react-native-vision-camera';
import { formatClock } from '@matiq/rules-engine';
import { Body, Button, Card } from '@/ui/components';
import { colors, radius, spacing } from '@/ui/theme';
import type { SampledFrame } from './frame-processor';
import { type LiveCaptureResult, useLiveCapture } from './useLiveCapture';

interface LiveRecorderProps {
  maxDurationMs: number;
  maxFrames: number;
  onFrame: (frame: SampledFrame) => void;
  uploadPressure: () => number;
  /** Called before recording starts (create the draft match here). */
  onBeforeStart: () => Promise<void>;
  onFinished: (result: LiveCaptureResult) => void;
  onCancel: () => void;
}

export function LiveRecorder(props: LiveRecorderProps) {
  const camera = useCameraPermission();
  const microphone = useMicrophonePermission();
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<() => void>(() => undefined);

  const capture = useLiveCapture({
    maxDurationMs: props.maxDurationMs,
    maxFrames: props.maxFrames,
    enableAudio: microphone.hasPermission,
    onFrame: props.onFrame,
    uploadPressure: props.uploadPressure,
    onAutoStop: () => stopRef.current(),
    onInterrupted: () => stopRef.current(),
  });

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setAppActive(state === 'active'));
    return () => subscription.remove();
  }, []);

  const finish = async () => {
    try {
      const result = await capture.stop();
      if (result) props.onFinished(result);
    } catch {
      setError('The recording could not be saved.');
    }
  };
  useEffect(() => {
    stopRef.current = () => void finish();
  });

  const begin = async () => {
    setError(null);
    try {
      await props.onBeforeStart();
      await capture.start();
    } catch {
      setError('Could not start recording. Check your connection and try again.');
    }
  };

  if (!camera.hasPermission) {
    return (
      <Card>
        <Body>MatIQ needs camera access to record your rounds. Video stays private to you unless you share it.</Body>
        <Button
          label={camera.canRequestPermission ? 'Allow camera' : 'Open settings to allow camera'}
          onPress={async () => {
            await camera.requestPermission();
            if (!microphone.hasPermission) await microphone.requestPermission();
          }}
        />
        <Button label="Back" variant="secondary" onPress={props.onCancel} />
      </Card>
    );
  }

  const recording = capture.state === 'recording';
  const remaining = Math.max(0, props.maxDurationMs - capture.elapsedMs);

  return (
    <View style={styles.container}>
      <Camera
        ref={capture.cameraRef}
        style={StyleSheet.absoluteFill}
        device="back"
        isActive={isFocused && appActive}
        outputs={[capture.videoOutput]}
        constraints={[{ fps: 30 }]}
        enableNativeZoomGesture
        resizeMode="cover"
      />
      <View style={styles.hud} pointerEvents="box-none">
        <View style={styles.badge}>
          {recording ? <View style={styles.dot} /> : null}
          <Text style={styles.badgeText}>
            {recording ? `${formatClock(capture.elapsedMs)} · ${capture.keptFrames} frames` : 'Ready'}
          </Text>
        </View>
        {recording && remaining < 30_000 ? <Text style={styles.warning}>{Math.ceil(remaining / 1000)}s left</Text> : null}
      </View>
      <View style={styles.controls}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
          disabled={capture.state === 'finishing'}
          onPress={recording ? () => void finish() : () => void begin()}
          style={styles.shutter}
        >
          <View style={recording ? styles.stopIcon : styles.recordIcon} />
        </Pressable>
        {!recording ? (
          <Pressable accessibilityRole="button" onPress={props.onCancel} style={styles.cancel}>
            <Text style={styles.badgeText}>Cancel</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, minHeight: 520, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' },
  hud: { position: 'absolute', top: spacing.lg, left: spacing.lg, right: spacing.lg, gap: spacing.sm },
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
  badgeText: { color: colors.text, fontVariant: ['tabular-nums'], fontWeight: '600' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  warning: { color: colors.warning, fontWeight: '700' },
  controls: { position: 'absolute', bottom: spacing.xl, left: 0, right: 0, alignItems: 'center', gap: spacing.md },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.danger },
  stopIcon: { width: 28, height: 28, borderRadius: 4, backgroundColor: colors.danger },
  cancel: { padding: spacing.sm },
  error: { color: colors.danger, backgroundColor: 'rgba(0,0,0,0.6)', padding: spacing.sm, borderRadius: radius.sm },
});
