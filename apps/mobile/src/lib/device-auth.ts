/**
 * Local re-authentication (Face ID / Touch ID / device passcode) before
 * opening sensitive screens such as the API-key vault and the Owner Panel.
 * This protects an unlocked, unattended phone; it is not a substitute for
 * server-side authorization, which every sensitive operation also enforces.
 */

import * as LocalAuthentication from 'expo-local-authentication';

export async function confirmDeviceOwner(reason: string): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  // Devices without biometrics or a passcode cannot be re-verified locally.
  if (!hasHardware || !isEnrolled) return true;

  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
    disableDeviceFallback: false,
  });
  return result.success;
}
