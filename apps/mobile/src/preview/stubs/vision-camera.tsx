/**
 * Browser UI preview stub for react-native-vision-camera: a placeholder
 * viewfinder and always-granted permissions. The real camera only exists on
 * iOS/Android.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

export function Camera({ style }: { style?: ViewStyle; children?: ReactNode; [key: string]: unknown }) {
  return (
    <View style={[styles.viewfinder, style]} accessibilityLabel="Camera preview placeholder">
      <View style={styles.frame} />
      <Text style={styles.text}>Camera runs on iOS and Android.</Text>
      <Text style={styles.hint}>This browser preview simulates a 2:30 round.</Text>
    </View>
  );
}

const granted = { hasPermission: true, canRequestPermission: true, requestPermission: () => Promise.resolve(true) };
export const useCameraPermission = () => granted;
export const useMicrophonePermission = () => granted;
export const useCameraDevice = () => ({ id: 'preview-back-camera', position: 'back' });
export const CommonResolutions = { FHD_16_9: { width: 1920, height: 1080 } };

const styles = StyleSheet.create({
  viewfinder: { backgroundColor: '#05070A', alignItems: 'center', justifyContent: 'center', gap: 6 },
  frame: {
    position: 'absolute',
    top: '18%',
    bottom: '30%',
    left: '12%',
    right: '12%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 16,
  },
  text: { color: '#9AA4B5', fontSize: 14, fontWeight: '600' },
  hint: { color: '#A3ACBB', fontSize: 12 },
});
