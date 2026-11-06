/**
 * What each notification says and where tapping it goes, in Activity and
 * when a push is tapped. Pure, so it is tested on its own.
 */

import type { NotificationKind } from './api';

const KINDS = new Set<NotificationKind>(['friend_request', 'friend_accepted', 'ranked_challenge', 'ranked_accepted', 'ranked_result', 'post_like', 'post_comment']);

export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === 'string' && KINDS.has(value as NotificationKind);
}

/** The sentence after the person's name ("Sam Okafor" + this). */
export function activityText(kind: NotificationKind): string {
  switch (kind) {
    case 'friend_request':
      return 'sent you a friend request.';
    case 'friend_accepted':
      return 'accepted your friend request.';
    case 'ranked_challenge':
      return 'challenged you to a ranked match.';
    case 'ranked_accepted':
      return 'accepted your ranked challenge.';
    case 'ranked_result':
      return 'recorded your ranked match. Check the result.';
    case 'post_like':
      return 'liked your post.';
    case 'post_comment':
      return 'commented on your post.';
  }
}

export type ActivityTarget =
  | { pathname: '/friends' }
  | { pathname: '/user/[id]'; params: { id: string } }
  | { pathname: '/ranked/match/[id]'; params: { id: string } }
  | { pathname: '/comments/[postId]'; params: { postId: string } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where a notification leads; null when its ids are missing or malformed (a push's data is untrusted). */
export function activityTarget(kind: NotificationKind, subjectId: string | null | undefined, actorId: string | null | undefined): ActivityTarget | null {
  const subject = subjectId && UUID.test(subjectId) ? subjectId : null;
  const actor = actorId && UUID.test(actorId) ? actorId : null;
  switch (kind) {
    case 'friend_request':
      return { pathname: '/friends' };
    case 'friend_accepted':
      return actor ? { pathname: '/user/[id]', params: { id: actor } } : null;
    case 'ranked_challenge':
    case 'ranked_accepted':
    case 'ranked_result':
      return subject ? { pathname: '/ranked/match/[id]', params: { id: subject } } : null;
    case 'post_like':
    case 'post_comment':
      return subject ? { pathname: '/comments/[postId]', params: { postId: subject } } : null;
  }
}
