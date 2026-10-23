/**
 * Social data access. Privacy is enforced in Postgres (RLS + SECURITY
 * INVOKER feed function); these wrappers never filter for privacy themselves,
 * so a client bug cannot widen what a user is allowed to see.
 */

import type { MatchResult, AthleteTotals } from '@matiq/rules-engine';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromPostgrest } from '@/lib/errors';
import { readCache, writeCache } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { cleanText } from '@/lib/validation';

export type Visibility = 'public' | 'private';

export interface FeedItem {
  post_id: string;
  author_id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  body: string;
  friends_only: boolean;
  created_at: string;
  match_id: string | null;
  discipline: 'bjj' | 'wrestling' | 'mma' | null;
  variant: string | null;
  match_title: string | null;
  athlete_a_label: string | null;
  athlete_b_label: string | null;
  has_video: boolean;
  highlight_start_ms: number | null;
  highlight_end_ms: number | null;
  result: MatchResult | null;
  totals: Record<'A' | 'B', AthleteTotals> | null;
  like_count: number;
  liked_by_me: boolean;
}

export interface FeedFilter {
  author?: string;
  friendsOnly?: boolean;
}

const PAGE_SIZE = 20;

async function fetchFeedPage(filter: FeedFilter, before: string | null): Promise<FeedItem[]> {
  const { data, error } = await supabase.rpc('get_feed', {
    p_before: before,
    p_limit: PAGE_SIZE,
    p_author: filter.author ?? null,
    p_friends_only: filter.friendsOnly ?? false,
  });
  if (error) throw fromPostgrest(error);
  return (data ?? []) as FeedItem[];
}

export function useFeed(filter: FeedFilter = {}) {
  const cacheKey = `feed:${filter.author ?? 'all'}:${filter.friendsOnly ? 'friends' : 'community'}`;
  const cached = readCache<FeedItem[]>(cacheKey);
  return useInfiniteQuery({
    queryKey: ['feed', filter],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const page = await fetchFeedPage(filter, pageParam);
      if (pageParam === null) writeCache(cacheKey, page);
      return page;
    },
    getNextPageParam: (lastPage) => (lastPage.length === PAGE_SIZE ? (lastPage[lastPage.length - 1]?.created_at ?? null) : null),
    ...(cached ? { placeholderData: { pages: [cached], pageParams: [null] } } : {}),
  });
}

export function useToggleLike() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ postId, liked }: { postId: string; liked: boolean }) => {
      const { error } = liked
        ? await supabase.from('post_likes').delete().eq('post_id', postId)
        : await supabase.from('post_likes').insert({ post_id: postId });
      if (error) throw fromPostgrest(error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });
}

export async function createPost(input: {
  matchId: string | null;
  body: string;
  friendsOnly: boolean;
  highlight?: { start: number; end: number };
}): Promise<void> {
  const { error } = await supabase.from('posts').insert({
    match_id: input.matchId,
    body: cleanText(input.body, { multiline: true }),
    friends_only: input.friendsOnly,
    highlight_start_ms: input.highlight?.start ?? null,
    highlight_end_ms: input.highlight?.end ?? null,
  });
  if (error) throw fromPostgrest(error);
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) throw fromPostgrest(error);
}

// Profiles ---------------------------------------------------------------------

export interface ProfileCard {
  user_id: string;
  username: string;
  display_name: string;
  bio: string;
  avatar_path: string | null;
  primary_discipline: 'bjj' | 'wrestling' | 'mma' | null;
  visibility: Visibility;
  relationship: 'self' | 'friend' | 'outgoing' | 'incoming' | 'none';
  can_view_content: boolean;
  post_count: number | null;
  friend_count: number;
}

export function useProfile(userId: string) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_profile', { p_user_id: userId });
      if (error) throw fromPostgrest(error);
      return ((data ?? []) as ProfileCard[])[0] ?? null;
    },
  });
}

export async function updateProfile(userId: string, patch: { display_name?: string; bio?: string; visibility?: Visibility }) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw fromPostgrest(error);
}

// Friends ----------------------------------------------------------------------

export interface FriendEntry {
  user_id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  status: 'pending' | 'accepted';
  direction: 'friend' | 'incoming' | 'outgoing';
  since: string;
}

export function useFriends() {
  return useQuery({
    queryKey: ['friends'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_friends');
      if (error) throw fromPostgrest(error);
      return (data ?? []) as FriendEntry[];
    },
  });
}

export async function searchProfiles(query: string) {
  const { data, error } = await supabase.rpc('search_profiles', { p_query: cleanText(query), p_limit: 20 });
  if (error) throw fromPostgrest(error);
  return (data ?? []) as Pick<ProfileCard, 'user_id' | 'username' | 'display_name' | 'avatar_path' | 'visibility'>[];
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw fromPostgrest(error);
  return data;
}

export const friendActions = {
  request: (userId: string) => rpc('send_friend_request', { p_target: userId }),
  accept: (userId: string) => rpc('respond_friend_request', { p_requester: userId, p_accept: true }),
  decline: (userId: string) => rpc('respond_friend_request', { p_requester: userId, p_accept: false }),
  remove: (userId: string) => rpc('remove_friend', { p_other: userId }),
  block: async (userId: string) => {
    const { error } = await supabase.from('blocks').insert({ blocked_id: userId });
    if (error) throw fromPostgrest(error);
  },
};

export function useFriendAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, userId }: { action: keyof typeof friendActions; userId: string }) => friendActions[action](userId),
    onSettled: (_data, _error, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
      void queryClient.invalidateQueries({ queryKey: ['profile', userId] });
      void queryClient.invalidateQueries({ queryKey: ['feed'] });
    },
  });
}
