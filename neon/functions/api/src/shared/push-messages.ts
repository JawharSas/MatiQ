/**
 * The words of each push notification, and which switch in Settings →
 * Notifications covers it. Kept apart from the sending code so it can be
 * tested on its own.
 */

export type NotificationKind =
  | 'friend_request'
  | 'friend_accepted'
  | 'ranked_challenge'
  | 'ranked_accepted'
  | 'ranked_result'
  | 'post_like'
  | 'post_comment';

/** The notification_settings column that switches a kind on or off. */
export type NotificationSwitch = 'friend_requests' | 'ranked' | 'likes' | 'comments';

export const SWITCH_FOR: Record<NotificationKind, NotificationSwitch> = {
  friend_request: 'friend_requests',
  friend_accepted: 'friend_requests',
  ranked_challenge: 'ranked',
  ranked_accepted: 'ranked',
  ranked_result: 'ranked',
  post_like: 'likes',
  post_comment: 'comments',
};

const TEXT: Record<NotificationKind, { title: string; body: (name: string) => string }> = {
  friend_request: { title: 'Friend request', body: (name) => `${name} wants to be friends on MatIQ.` },
  friend_accepted: { title: 'New friend', body: (name) => `${name} accepted your friend request.` },
  ranked_challenge: { title: 'Ranked challenge', body: (name) => `${name} challenged you to a ranked match.` },
  ranked_accepted: { title: 'Challenge accepted', body: (name) => `${name} accepted your ranked challenge.` },
  ranked_result: { title: 'Check your result', body: (name) => `${name} recorded your ranked match. Confirm or dispute the result.` },
  post_like: { title: 'New like', body: (name) => `${name} liked your post.` },
  post_comment: { title: 'New comment', body: (name) => `${name} commented on your post.` },
};

export interface PushMessage {
  title: string;
  body: string;
  /** For the app to open the right screen when the push is tapped. */
  data: Record<string, string>;
}

/** Names are shown as they are, cut to 40 characters and without control characters. */
export function cleanName(name: string | null | undefined): string {
  const clean = (name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 40);
  return clean || 'Someone';
}

export function pushMessage(kind: NotificationKind, actorName: string | null | undefined, ids: { id: string; subjectId: string | null; actorId: string }): PushMessage {
  const text = TEXT[kind];
  return {
    title: text.title,
    body: text.body(cleanName(actorName)),
    data: { notificationId: ids.id, kind, actorId: ids.actorId, ...(ids.subjectId ? { subjectId: ids.subjectId } : {}) },
  };
}

/** Whether a person's switches let this kind through (no row: everything on). */
export function allowed(kind: NotificationKind, settings: Partial<Record<NotificationSwitch, boolean>> | null): boolean {
  return settings?.[SWITCH_FOR[kind]] !== false;
}
