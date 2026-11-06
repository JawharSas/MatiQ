/**
 * Push notifications on this phone: permission, the Firebase token, and
 * telling the backend which account it belongs to.
 *
 * Push needs Firebase in the build (google-services.json, release.yml). A
 * build without it, or a phone that refuses, gets no pushes; everything
 * still shows in Activity. The token is kept on this device only so it can
 * be removed from the account on sign-out.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { backend } from '@/lib/backend';
import { readDeviceValue, writePreference } from '@/lib/storage';

export type PushStatus = 'on' | 'off' | 'denied' | 'unavailable';

const TOKEN_KEY = 'push-token';

// Shown while the app is open too, as a banner.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'MatIQ',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#DC2626',
  });
}

/** Whether pushes are on for this phone, without asking. */
export async function pushStatus(): Promise<PushStatus> {
  if (Platform.OS === 'web') return 'unavailable';
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status === 'denied' && !permission.canAskAgain) return 'denied';
  if (permission.status !== 'granted') return 'off';
  return storedToken() ? 'on' : 'off';
}

function storedToken(): string | null {
  return readDeviceValue(TOKEN_KEY) ?? null;
}

/**
 * Turns pushes on: asks for permission when `ask` (otherwise only when it
 * was given before), gets this phone's token and registers it.
 */
export async function enablePush({ ask }: { ask: boolean }): Promise<PushStatus> {
  if (Platform.OS === 'web') return 'unavailable';
  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') {
    if (!ask || !permission.canAskAgain) return permission.status === 'denied' ? 'denied' : 'off';
    await ensureChannel();
    permission = await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return 'denied';
  }
  await ensureChannel();
  let token: string;
  try {
    token = String((await Notifications.getDevicePushTokenAsync()).data);
  } catch {
    // No Firebase in this build.
    return 'unavailable';
  }
  const { error } = await backend.rpc('register_push_token', { p_token: token, p_platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  if (error) return 'off';
  writePreference(TOKEN_KEY, token);
  return 'on';
}

/** Stops pushes to this phone for the signed-in account (sign-out, or switched off). */
export async function disablePush(): Promise<void> {
  const token = storedToken();
  if (!token) return;
  await backend.rpc('unregister_push_token', { p_token: token }).then(
    () => undefined,
    () => undefined,
  );
  writePreference(TOKEN_KEY, '');
}
