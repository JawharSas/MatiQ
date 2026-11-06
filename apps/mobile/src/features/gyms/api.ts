import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUserId } from '@/features/auth/AuthProvider';
import type { FeedItem } from '@/features/social/api';
import { fromPostgrest } from '@/lib/errors';
import { backend } from '@/lib/backend';

export interface Gym {
  id: string;
  name: string;
  city: string | null;
  invite_code: string;
  role: 'owner' | 'member';
  member_count: number;
  created_at: string;
}

export interface GymMember {
  user_id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  role: 'owner' | 'member';
  joined_at: string;
}

export interface GymRanking {
  user_id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
}

/** Your gym, or null when you're in none. */
export function useMyGym() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['gym', userId],
    queryFn: async (): Promise<Gym | null> => {
      const { data, error } = await backend.rpc('get_my_gym');
      if (error) throw fromPostgrest(error);
      return (data ?? null) as Gym | null;
    },
  });
}

export function useGymMembers(enabled: boolean) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['gym-members', userId],
    enabled,
    queryFn: async (): Promise<GymMember[]> => {
      const { data, error } = await backend.rpc('get_gym_members');
      if (error) throw fromPostgrest(error);
      return (data ?? []) as GymMember[];
    },
  });
}

export function useGymLeaderboard(discipline: 'bjj' | 'wrestling' | 'mma', enabled: boolean) {
  const userId = useUserId();
  return useQuery({
    queryKey: ['gym-leaderboard', userId, discipline],
    enabled,
    queryFn: async (): Promise<GymRanking[]> => {
      const { data, error } = await backend.rpc('get_gym_leaderboard', { p_discipline: discipline });
      if (error) throw fromPostgrest(error);
      return (data ?? []) as GymRanking[];
    },
  });
}

const PAGE_SIZE = 20;

/** Teammates' posts (the feed's own visibility rules apply). */
export function useGymFeed(enabled: boolean) {
  const userId = useUserId();
  return useInfiniteQuery({
    queryKey: ['feed', 'gym', userId],
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<FeedItem[]> => {
      const { data, error } = await backend.rpc('get_gym_feed', { p_before: pageParam, p_limit: PAGE_SIZE });
      if (error) throw fromPostgrest(error);
      return (data ?? []) as FeedItem[];
    },
    getNextPageParam: (lastPage) => (lastPage.length === PAGE_SIZE ? (lastPage[lastPage.length - 1]?.created_at ?? null) : null),
  });
}

/** Starting, joining, leaving and the owner's actions; each refreshes the gym. */
export function useGymActions() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  const refresh = async () => {
    await Promise.all(
      [['gym', userId], ['gym-members', userId], ['gym-leaderboard', userId], ['feed', 'gym', userId]].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  };
  const call = async <T>(name: string, args?: Record<string, unknown>): Promise<T> => {
    const { data, error } = await backend.rpc(name, args);
    if (error) throw fromPostgrest(error);
    await refresh();
    return data as T;
  };
  return {
    create: (name: string, city: string) => call<string>('create_gym', { p_name: name, p_city: city || null }),
    join: (code: string) => call<string>('join_gym', { p_code: code }),
    leave: () => call<boolean>('leave_gym'),
    remove: (memberId: string) => call<boolean>('remove_gym_member', { p_user: memberId }),
    rotateCode: () => call<string>('rotate_gym_code'),
  };
}
