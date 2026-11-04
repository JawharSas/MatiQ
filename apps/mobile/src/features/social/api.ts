/**
 * Social data access. Privacy is enforced in Postgres (RLS + SECURITY
 * INVOKER feed function); these wrappers never filter for privacy themselves,
 * so a client bug cannot widen what a user is allowed to see.
 */

import type { MatchResult, AthleteTotals } from '@matiq/rules-engine';
import { type InfiniteData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppError, fromPostgrest } from '@/lib/errors';
import { persisted } from '@/lib/persisted';
import { readCache, writeCache } from '@/lib/storage';
import { backend } from '@/lib/backend';
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
  comment_count: number;
  /** Off when the author turned comments off (when sharing, or later). */
  comments_enabled: boolean;
}

export interface FeedFilter {
  author?: string;
  friendsOnly?: boolean;
}

const PAGE_SIZE = 20;

async function fetchFeedPage(filter: FeedFilter, before: string | null): Promise<FeedItem[]> {
  const { data, error } = await backend.rpc('get_feed', {
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
        ? await backend.from('post_likes').delete().eq('post_id', postId)
        : await backend.from('post_likes').insert({ post_id: postId });
      if (error) throw fromPostgrest(error);
    },
    // The heart and count change at once; a refused like puts them back.
    onMutate: async ({ postId, liked }) => {
      await queryClient.cancelQueries({ queryKey: ['feed'] });
      const before = queryClient.getQueriesData<InfiniteData<FeedItem[]>>({ queryKey: ['feed'] });
      queryClient.setQueriesData<InfiniteData<FeedItem[]>>({ queryKey: ['feed'] }, (feed) =>
        feed && {
          ...feed,
          pages: feed.pages.map((page) =>
            page.map((post) =>
              post.post_id === postId ? { ...post, liked_by_me: !liked, like_count: Math.max(0, post.like_count + (liked ? -1 : 1)) } : post,
            ),
          ),
        },
      );
      return { before };
    },
    onError: (_error, _variables, context) => {
      for (const [key, data] of context?.before ?? []) queryClient.setQueryData(key, data);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['feed'] }),
  });
}

export async function createPost(input: {
  matchId: string | null;
  body: string;
  friendsOnly: boolean;
  commentsEnabled: boolean;
  highlight?: { start: number; end: number };
}): Promise<void> {
  const { data, error } = await backend
    .from('posts')
    .insert({
      match_id: input.matchId,
      body: cleanText(input.body, { multiline: true }),
      friends_only: input.friendsOnly,
      comments_enabled: input.commentsEnabled,
      highlight_start_ms: input.highlight?.start ?? null,
      highlight_end_ms: input.highlight?.end ?? null,
    })
    .select('id, moderation')
    .single();
  if (error) throw fromPostgrest(error);
  // The server's word filter held it back (only its author could see it) and
  // counted a strike. It is not kept: the strike is.
  if (data.moderation === 'blocked') {
    const { error: deleteError } = await backend.from('posts').delete().eq('id', data.id);
    // The third strike bans the account straight away: say so.
    const refused = fromPostgrest(deleteError);
    if (refused?.code === 'banned') throw refused;
    throw new AppError('content_not_allowed', POST_HELD_MESSAGE);
  }
}

export const POST_HELD_MESSAGE =
  "This post wasn't shared: it includes words MatIQ doesn't allow. Three of these in 30 days ban the account.";

export async function deletePost(postId: string): Promise<void> {
  const { error } = await backend.from('posts').delete().eq('id', postId);
  if (error) throw fromPostgrest(error);
}

// Comments ---------------------------------------------------------------------

export interface PostComment {
  comment_id: string;
  author_id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  body: string;
  created_at: string;
  /** The comment's writer or the post's author. */
  can_delete: boolean;
}

export interface CommentState {
  author_id: string;
  comments_enabled: boolean;
  comment_count: number;
}

export const COMMENT_MAX_LENGTH = 500;

/** The post's newest comments, oldest first, as a conversation reads. */
export function useComments(postId: string) {
  return useQuery({
    queryKey: ['comments', postId],
    ...persisted<PostComment[]>(`comments:${postId}`),
    queryFn: async () => {
      const { data, error } = await backend.rpc('get_post_comments', { p_post_id: postId, p_limit: 100 }, { get: true });
      if (error) throw fromPostgrest(error);
      return ((data ?? []) as PostComment[]).slice().reverse();
    },
  });
}

/** Who wrote the post and whether it takes comments; null when it can't be seen. */
export function useCommentState(postId: string) {
  return useQuery({
    queryKey: ['comments', postId, 'state'],
    queryFn: async () => {
      const { data, error } = await backend.rpc('get_post_comment_state', { p_post_id: postId }, { get: true });
      if (error) throw fromPostgrest(error);
      return ((data ?? []) as CommentState[])[0] ?? null;
    },
  });
}

function refreshComments(queryClient: ReturnType<typeof useQueryClient>, postId: string) {
  void queryClient.invalidateQueries({ queryKey: ['comments', postId] });
  void queryClient.invalidateQueries({ queryKey: ['feed'] });
}

export function useAddComment(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: string) => {
      const { error } = await backend.rpc('add_post_comment', { p_post_id: postId, p_body: cleanText(body, { multiline: true }) });
      if (error) throw fromPostgrest(error);
    },
    onSuccess: () => refreshComments(queryClient, postId),
  });
}

export function useDeleteComment(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (commentId: string) => {
      const { error } = await backend.rpc('delete_post_comment', { p_comment_id: commentId });
      if (error) throw fromPostgrest(error);
    },
    // Gone from the list at once; a refusal puts it back.
    onMutate: async (commentId) => {
      await queryClient.cancelQueries({ queryKey: ['comments', postId] });
      const before = queryClient.getQueryData<PostComment[]>(['comments', postId]);
      queryClient.setQueryData<PostComment[]>(['comments', postId], (list) => list?.filter((c) => c.comment_id !== commentId));
      return { before };
    },
    onError: (_error, _commentId, context) => {
      if (context?.before) queryClient.setQueryData(['comments', postId], context.before);
    },
    onSettled: () => refreshComments(queryClient, postId),
  });
}

/** The post's author turns its comments on or off. */
export function useSetCommentsEnabled(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { data, error } = await backend.rpc('set_post_comments', { p_post_id: postId, p_enabled: enabled });
      if (error) throw fromPostgrest(error);
      if (data !== true) throw new AppError('42501', "You can't change this post's comments.");
    },
    onMutate: async (enabled) => {
      const key = ['comments', postId, 'state'];
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<CommentState | null>(key);
      queryClient.setQueryData<CommentState | null>(key, (state) => state && { ...state, comments_enabled: enabled });
      return { before };
    },
    onError: (_error, _enabled, context) => {
      queryClient.setQueryData(['comments', postId, 'state'], context?.before);
    },
    onSettled: () => refreshComments(queryClient, postId),
  });
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
    ...persisted<ProfileCard | null>(`profile:${userId}`),
    queryFn: async () => {
      const { data, error } = await backend.rpc('get_profile', { p_user_id: userId });
      if (error) throw fromPostgrest(error);
      return ((data ?? []) as ProfileCard[])[0] ?? null;
    },
  });
}

export async function updateProfile(
  userId: string,
  patch: { username?: string; display_name?: string; bio?: string; visibility?: Visibility; avatar_path?: string | null },
) {
  const { error } = await backend.from('profiles').update(patch).eq('id', userId);
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
    ...persisted<FriendEntry[]>('friends'),
    queryFn: async () => {
      const { data, error } = await backend.rpc('get_friends');
      if (error) throw fromPostgrest(error);
      return (data ?? []) as FriendEntry[];
    },
  });
}

export async function searchProfiles(query: string) {
  const { data, error } = await backend.rpc('search_profiles', { p_query: cleanText(query), p_limit: 20 });
  if (error) throw fromPostgrest(error);
  return (data ?? []) as Pick<ProfileCard, 'user_id' | 'username' | 'display_name' | 'avatar_path' | 'visibility'>[];
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await backend.rpc(name, args);
  if (error) throw fromPostgrest(error);
  return data;
}

export const friendActions = {
  request: (userId: string) => rpc('send_friend_request', { p_target: userId }),
  accept: (userId: string) => rpc('respond_friend_request', { p_requester: userId, p_accept: true }),
  decline: (userId: string) => rpc('respond_friend_request', { p_requester: userId, p_accept: false }),
  remove: (userId: string) => rpc('remove_friend', { p_other: userId }),
  block: async (userId: string) => {
    const { error } = await backend.from('blocks').insert({ blocked_id: userId });
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
