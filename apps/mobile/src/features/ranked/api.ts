/**
 * Ranked ladder data access. Reads go straight to tables and invoker RPCs, so
 * RLS decides what is visible (ratings and titles follow account privacy;
 * ranked matches are participant-only). Every state change is a server RPC
 * that re-checks the rules; ratings are only written by the `ranked` Edge
 * Function.
 */

import type { CareerTotals, Discipline } from '@matiq/rules-engine';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppError, fromFunctionError, fromPostgrest } from '@/lib/errors';
import { backend } from '@/lib/backend';
import { cleanText } from '@/lib/validation';
import type { RankedMatchRow } from './ranked-state';

export interface RatingRow {
  user_id: string;
  discipline: Discipline;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  current_streak: number;
  peak_rating: number;
  totals: Partial<CareerTotals>;
}

export interface TitleRow {
  title_id: string;
  discipline: Discipline;
  is_featured: boolean;
  unlocked_at: string;
}

export interface LeaderboardRow {
  ladder_position: number;
  user_id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  featured_title: string | null;
}

export interface OpponentRow {
  user_id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
  rating: number;
  games: number;
  is_friend: boolean;
  rating_gap: number;
}

export interface PersonRow {
  id: string;
  username: string;
  display_name: string;
  avatar_path: string | null;
}

const RANKED_COLUMNS =
  'id, discipline, variant, challenger_id, opponent_id, message, status, match_id, fighter_a_id, fighter_b_id, winner_id, result_method, confirmed_a_at, confirmed_b_at, confirm_by, recorded_at, dispute_reason, rating_a_before, rating_a_after, rating_b_before, rating_b_after, expires_at, created_at, settled_at';

// Reads ---------------------------------------------------------------------------

export function useRankedMatches() {
  // Challenges and results from the other fighter show up within a minute.
  return useQuery({
    queryKey: ['ranked', 'matches'],
    queryFn: async () => {
      const { data, error } = await backend.from('ranked_matches').select(RANKED_COLUMNS).order('created_at', { ascending: false }).limit(60);
      if (error) throw fromPostgrest(error);
      return (data ?? []) as RankedMatchRow[];
    },
    refetchInterval: 60_000,
  });
}

export function useRankedMatch(id: string) {
  return useQuery({
    queryKey: ['ranked', 'match', id],
    queryFn: async () => {
      const { data, error } = await backend.from('ranked_matches').select(RANKED_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw fromPostgrest(error);
      return data as RankedMatchRow | null;
    },
  });
}

/** The ranked match a recording belongs to (only visible to its fighters). */
export function useRankedForMatch(matchId: string) {
  return useQuery({
    queryKey: ['ranked', 'for-match', matchId],
    queryFn: async () => {
      const { data, error } = await backend.from('ranked_matches').select(RANKED_COLUMNS).eq('match_id', matchId).maybeSingle();
      if (error) throw fromPostgrest(error);
      return data as RankedMatchRow | null;
    },
  });
}

export function useRatings(userId: string) {
  return useQuery({
    queryKey: ['ranked', 'ratings', userId],
    queryFn: async () => {
      const { data, error } = await backend
        .from('ranked_ratings')
        .select('user_id, discipline, rating, games, wins, losses, draws, current_streak, peak_rating, totals')
        .eq('user_id', userId);
      if (error) throw fromPostgrest(error);
      return (data ?? []) as RatingRow[];
    },
  });
}

export function useTitles(userId: string) {
  return useQuery({
    queryKey: ['ranked', 'titles', userId],
    queryFn: async () => {
      const { data, error } = await backend
        .from('user_titles')
        .select('title_id, discipline, is_featured, unlocked_at')
        .eq('user_id', userId)
        .order('unlocked_at', { ascending: false });
      if (error) throw fromPostgrest(error);
      return (data ?? []) as TitleRow[];
    },
  });
}

export function useLeaderboard(discipline: Discipline, scope: 'global' | 'friends') {
  return useQuery({
    queryKey: ['ranked', 'leaderboard', discipline, scope],
    queryFn: async () => {
      const { data, error } = await backend.rpc('get_leaderboard', { p_discipline: discipline, p_scope: scope, p_limit: 100 });
      if (error) throw fromPostgrest(error);
      return (data ?? []) as LeaderboardRow[];
    },
  });
}

export function useOpponents(discipline: Discipline) {
  return useQuery({
    queryKey: ['ranked', 'opponents', discipline],
    queryFn: async () => {
      const { data, error } = await backend.rpc('get_ranked_opponents', { p_discipline: discipline, p_limit: 30 });
      if (error) throw fromPostgrest(error);
      return (data ?? []) as OpponentRow[];
    },
  });
}

/** Names and avatars for the people in a list of ranked matches. */
export function usePeople(ids: readonly string[]) {
  const unique = [...new Set(ids)].sort();
  return useQuery({
    queryKey: ['people', unique],
    enabled: unique.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await backend.from('profiles').select('id, username, display_name, avatar_path').in('id', unique);
      if (error) throw fromPostgrest(error);
      return new Map(((data ?? []) as PersonRow[]).map((person) => [person.id, person]));
    },
  });
}

// Actions -------------------------------------------------------------------------

async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await backend.rpc(name, args);
  if (error) {
    // Duplicate open match is the one 23505 here; give it a clear message.
    if (error.code === '23505') throw new AppError('ranked_already_open', 'You already have an open ranked match with this fighter in this discipline.');
    if (error.code === 'P0429' && error.hint === 'pair_limit') {
      throw new AppError('pair_limit', "You've played 3 ranked matches with this fighter this week. Try again in a few days.");
    }
    throw fromPostgrest(error);
  }
  return data;
}

async function invokeRanked(action: 'confirm' | 'settle', id: string): Promise<{ status: string }> {
  const { data, error } = await backend.functions.invoke<{ status: string }>('ranked', { body: { action, id } });
  if (error || !data) throw await fromFunctionError(error);
  return data;
}

export const rankedActions = {
  challenge: (input: { opponentId: string; discipline: Discipline; variant: string; message?: string }) =>
    rpc('create_ranked_challenge', {
      p_opponent: input.opponentId,
      p_discipline: input.discipline,
      p_variant: input.variant,
      p_message: input.message ? cleanText(input.message).slice(0, 140) : null,
    }),
  respond: (id: string, accept: boolean) => rpc('respond_ranked_challenge', { p_id: id, p_accept: accept }),
  cancel: (id: string) => rpc('cancel_ranked_challenge', { p_id: id }),
  dispute: (id: string, reason: string) => rpc('dispute_ranked_result', { p_id: id, p_reason: cleanText(reason).slice(0, 280) }),
  featureTitle: (titleId: string | null) => rpc('feature_title', { p_title_id: titleId }),
  confirm: (id: string) => invokeRanked('confirm', id),
  settle: (id: string) => invokeRanked('settle', id),
};

/** Attaches a fresh draft recording to an accepted ranked match (caller = Fighter 1). */
export async function linkRankedMatch(rankedId: string, matchId: string): Promise<void> {
  await rpc('link_ranked_match', { p_id: rankedId, p_match_id: matchId });
}

export function useRankedAction<A extends unknown[]>(action: (...args: A) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: A) => action(...args),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['ranked'] }),
  });
}
