// Web preview stand-in for expo-notifications: no pushes in a browser.
// The app treats web as "push unavailable" and still shows Activity.

export const AndroidImportance = { HIGH: 4 } as const;

export function setNotificationHandler(): void {}

export async function setNotificationChannelAsync(): Promise<null> {
  return null;
}

export async function getPermissionsAsync() {
  return { status: 'undetermined', canAskAgain: true, granted: false };
}

export async function requestPermissionsAsync() {
  return { status: 'denied', canAskAgain: false, granted: false };
}

export async function getDevicePushTokenAsync(): Promise<never> {
  throw new Error('Push notifications are not available in the browser preview');
}

export function useLastNotificationResponse() {
  return null;
}

export function addNotificationResponseReceivedListener() {
  return { remove() {} };
}

export async function unregisterForNotificationsAsync(): Promise<void> {}
