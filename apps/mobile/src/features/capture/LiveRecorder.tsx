import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/text';
import { Camera, useCameraPermission, useMicrophonePermission } from 'react-native-vision-camera';
import { errorMessage } from '@/lib/errors';
import { readPreference, writePreference } from '@/lib/storage';
import { Body, Button, Card, Segmented } from '@/ui/components';
import { colors, radius, spacing } from '@/ui/theme';
import type { CapturePlan, FpsPreference } from './capture-plan';
import { CaptureHud } from './CaptureHud';
import type { SampledFrame } from './frame-processor';
import { type LiveMatchInfo, LiveScoreboard } from './LiveScoreboard';
import { type LiveCaptureResult, useLiveCapture } from './useLiveCapture';

const FPS_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: '60', label: '60 FPS' },
  { value: '30', label: '30 FPS' },
] as const;
const FPS_VALUES = FPS_OPTIONS.map((option) => option.value);

interface LiveRecorderProps {
  maxDurationMs: number;
  maxFrames: number;
  onFrame: (frame: SampledFrame) => void;
  uploadPressure: () => number;
  /** Called before recording starts with the chosen plan (create the draft / live session here). */
  onBeforeStart: (plan: CapturePlan) => Promise<void>;
  /** Set while a live analysis runs, to show the provisional score. */
  liveMatch?: LiveMatchInfo | null;
  onFinished: (result: LiveCaptureResult) => void;
  onCancel: () => void;
}

export function LiveRecorder(props: LiveRecorderProps) {
  const camera = useCameraPermission();
  const microphone = useMicrophonePermission();
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [error, setError] = useState<string | null>(null);
  const [fpsPreference, setFpsPreference] = useState<FpsPreference>(() => readPreference('capture-fps', FPS_VALUES, 'auto'));
  const stopRef = useRef<() => void>(() => undefined);

  const capture = useLiveCapture({
    maxDurationMs: props.maxDurationMs,
    maxFrames: props.maxFrames,
    enableAudio: microphone.hasPermission,
    fpsPreference,
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
    if (!capture.plan) return;
    setError(null);
    try {
      await props.onBeforeStart(capture.plan);
      await capture.start();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const onCameraError = useCallback(() => setError('The camera stopped unexpectedly.'), []);

  const choosePreference = (next: FpsPreference) => {
    setFpsPreference(next);
    writePreference('capture-fps', next);
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

  if (!capture.device) {
    return (
      <Card>
        <Body>No rear camera is available on this device.</Body>
        <Button label="Back" variant="secondary" onPress={props.onCancel} />
      </Card>
    );
  }

  const recording = capture.state === 'recording';
  const idle = capture.state === 'idle';

  return (
    <View style={styles.stack}>
      {idle ? <Segmented options={FPS_OPTIONS} value={fpsPreference} onChange={choosePreference} /> : null}
      <View style={styles.container}>
        {capture.plan ? (
          <Camera
            style={StyleSheet.absoluteFill}
            device={capture.device}
            isActive={isFocused && appActive}
            outputs={capture.outputs}
            constraints={capture.constraints}
            onSessionConfigSelected={capture.onSessionConfigSelected}
            onInterruptionStarted={capture.onInterruptionStarted}
            onError={onCameraError}
            // Low-light boost lengthens exposure by dropping the frame rate.
            enableLowLightBoost={false}
            enableSmoothAutoFocus
            enableNativeZoomGesture
            resizeMode="cover"
          />
        ) : null}
        <CaptureHud telemetry={capture.telemetry} maxDurationMs={props.maxDurationMs} />
        {recording && props.liveMatch ? <LiveScoreboard match={props.liveMatch} /> : null}
        <View style={styles.controls}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
            disabled={capture.state === 'finishing' || capture.probing || !capture.plan}
            onPress={recording ? () => void finish() : () => void begin()}
            style={[styles.shutter, (capture.probing || !capture.plan) && { opacity: 0.4 }]}
          >
            <View style={recording ? styles.stopIcon : styles.recordIcon} />
          </Pressable>
          {idle ? (
            <Pressable accessibilityRole="button" onPress={props.onCancel} style={styles.cancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  container: { flex: 1, minHeight: 520, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000' },
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
  cancelText: { color: colors.text, fontWeight: '600' },
  error: { color: colors.danger, backgroundColor: 'rgba(0,0,0,0.6)', padding: spacing.sm, borderRadius: radius.sm },
});
