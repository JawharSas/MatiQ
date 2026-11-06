import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useUserId } from '@/features/auth/AuthProvider';
import { activityTarget, isNotificationKind } from './activity';
import { enablePush } from './push';

/**
 * Signed in: re-registers this phone for pushes when permission was given
 * before (never asks), and opens the right screen when a push is tapped,
 * including the one that started the app.
 */
export function PushBridge() {
  const router = useRouter();
  const userId = useUserId();
  const last = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  // Again whenever the account changes (a switched account registers this phone anew).
  useEffect(() => {
    void enablePush({ ask: false }).catch(() => undefined);
  }, [userId]);

  useEffect(() => {
    if (!last) return;
    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;
    const data = (last.notification.request.content.data ?? {}) as Record<string, unknown>;
    if (!isNotificationKind(data.kind)) return;
    const target = activityTarget(data.kind, typeof data.subjectId === 'string' ? data.subjectId : null, typeof data.actorId === 'string' ? data.actorId : null);
    router.push(target ?? '/activity');
  }, [last, router]);

  return null;
}
