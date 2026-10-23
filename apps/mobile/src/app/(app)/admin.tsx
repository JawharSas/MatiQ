import { usePreventScreenCapture } from 'expo-screen-capture';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { OwnerPanel } from '@/features/admin/OwnerPanel';
import { useAuth } from '@/features/auth/AuthProvider';
import { confirmDeviceOwner } from '@/lib/device-auth';
import { Body, Caption, Loading, Screen } from '@/ui/components';

/**
 * Owner panel route. Three layers protect it:
 *  1. UI: only shown when `am_i_owner()` is true.
 *  2. Device: Face ID / Touch ID / passcode before opening.
 *  3. Server: every admin RPC re-verifies the owner role (and MFA when
 *     enabled) and audits each change. Layers 1-2 are conveniences; 3 is the
 *     actual security boundary.
 */
export default function AdminScreen() {
  usePreventScreenCapture('owner-panel');
  const { isOwner } = useAuth();
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (!isOwner) return;
    confirmDeviceOwner('Open the owner panel').then((ok) => (ok ? setUnlocked(true) : router.back()));
  }, [isOwner, router]);

  if (!isOwner) {
    return (
      <Screen>
        <Body>This area is restricted to the app owner.</Body>
      </Screen>
    );
  }
  if (!unlocked) return <Loading />;

  return (
    <Screen>
      <OwnerPanel />
      <Caption>All owner actions are recorded in the audit log.</Caption>
    </Screen>
  );
}
