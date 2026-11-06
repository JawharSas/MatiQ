import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUserId } from '@/features/auth/AuthProvider';
import { fromPostgrest } from '@/lib/errors';
import { backend } from '@/lib/backend';

export type NotificationKind =
  | 'friend_request'
  | 'friend_accepted'
  | 'ranked_challenge'
  | 'ranked_accepted'
  | 'ranked_result'
  | 'post_like'
  | 'post_comment';

export interface ActivityItem {
  id: string;
  kind: NotificationKind;
  actor_id: string;
  actor_username: string;
  actor_display_name: string;
  actor_avatar_path: string | null;
  subject_id: string | null;
  created_at: string;
  read_at: string | null;
}

/** Your notifications, newest first (Activity). Refreshes every minute while open. */
export function useActivity() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['activity', userId],
    refetchInterval: 60_000,
    queryFn: async (): Promise<ActivityItem[]> => {
      const { data, error } = await backend.rpc('get_notifications', { p_limit: 50 });
      if (error) throw fromPostgrest(error);
      return (data ?? []) as ActivityItem[];
    },
  });
}

export function useUnreadCount(): number {
  return (useActivity().data ?? []).filter((item) => !item.read_at).length;
}

export function useMarkActivityRead() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return async () => {
    const { error } = await backend.rpc('mark_notifications_read');
    if (error) throw fromPostgrest(error);
    await queryClient.invalidateQueries({ queryKey: ['activity', userId] });
  };
}

export const NOTIFICATION_SWITCHES = ['friend_requests', 'ranked', 'likes', 'comments'] as const;
export type NotificationSwitch = (typeof NOTIFICATION_SWITCHES)[number];
export type NotificationSettings = Record<NotificationSwitch, boolean>;

const ALL_ON: NotificationSettings = { friend_requests: true, ranked: true, likes: true, comments: true };

/** Which kinds of push you get (no row yet: all on). */
export function useNotificationSettings() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['notification-settings', userId],
    queryFn: async (): Promise<NotificationSettings> => {
      const { data, error } = await backend.from('notification_settings').select('friend_requests, ranked, likes, comments').maybeSingle();
      if (error) throw fromPostgrest(error);
      return { ...ALL_ON, ...((data ?? {}) as Partial<NotificationSettings>) };
    },
  });
}

export function useSaveNotificationSetting() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return async (settings: NotificationSettings) => {
    const { error } = await backend.from('notification_settings').upsert({ user_id: userId, ...settings }, { onConflict: 'user_id' });
    if (error) throw fromPostgrest(error);
    await queryClient.invalidateQueries({ queryKey: ['notification-settings', userId] });
  };
}
