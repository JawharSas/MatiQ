/**
 * Owner Panel data access. Every call is a SECURITY DEFINER RPC that checks
 * the caller's role in `user_entitlements` (and MFA, when enabled) on every
 * request and writes an audit log entry for each change. Hiding the panel in
 * the UI is a convenience, not the security boundary.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fromFunctionError, fromPostgrest } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { cleanText } from '@/lib/validation';

export interface AdminUserRow {
  user_id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: 'user' | 'owner';
  is_unlimited: boolean;
  is_suspended: boolean;
  monthly_analysis_limit: number;
  max_video_seconds: number;
  used_this_month: number;
  total_analyses: number;
  created_at: string;
  last_sign_in_at: string | null;
}

export interface UsageOverview {
  period_start: string;
  total_users: number;
  unlimited_users: number;
  suspended_users: number;
  analyses_this_month: number;
  platform_units_this_month: number;
  byok_analyses_this_month: number;
  active_users_this_month: number;
  top_users: { user_id: string; username: string; units: number; analyses: number }[];
}

export interface AuditEntry {
  id: number;
  actor_username: string | null;
  target_username: string | null;
  action: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason: string | null;
  created_at: string;
}

export function useAdminUsers(query: string, page: number, pageSize = 25) {
  return useQuery({
    queryKey: ['admin', 'users', query, page],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_search_users', {
        p_query: cleanText(query),
        p_limit: pageSize,
        p_offset: page * pageSize,
      });
      if (error) throw fromPostgrest(error);
      return (data ?? []) as AdminUserRow[];
    },
  });
}

export function useUsageOverview() {
  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_usage_overview');
      if (error) throw fromPostgrest(error);
      return data as UsageOverview;
    },
  });
}

export function useAuditLog() {
  return useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_audit_log', { p_limit: 50 });
      if (error) throw fromPostgrest(error);
      return (data ?? []) as AuditEntry[];
    },
  });
}

export interface RankedDispute {
  id: string;
  discipline: 'bjj' | 'wrestling' | 'mma';
  variant: string;
  match_id: string | null;
  fighter_a_id: string;
  fighter_a_username: string | null;
  fighter_b_id: string;
  fighter_b_username: string | null;
  winner_id: string | null;
  result_method: string | null;
  dispute_reason: string | null;
  disputed_by: string | null;
  recorded_at: string | null;
  updated_at: string;
}

export function useRankedDisputes() {
  return useQuery({
    queryKey: ['admin', 'ranked-disputes'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('admin_list_ranked_disputes', { p_limit: 50 });
      if (error) throw fromPostgrest(error);
      return (data ?? []) as RankedDispute[];
    },
  });
}

/**
 * Voids a disputed ranked result, or upholds it: the server marks it ready
 * and the `ranked` function applies the ratings. Both are audited.
 */
export function useResolveDispute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, outcome, reason }: { id: string; outcome: 'apply' | 'void'; reason?: string }) => {
      const { error } = await supabase.rpc('admin_resolve_ranked_dispute', {
        p_id: id,
        p_outcome: outcome,
        p_reason: reason ? cleanText(reason) : null,
      });
      if (error) throw fromPostgrest(error);
      if (outcome === 'apply') {
        const { error: settleError } = await supabase.functions.invoke('ranked', { body: { action: 'settle', id } });
        if (settleError) throw await fromFunctionError(settleError);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  });
}

function useAdminMutation<T>(fn: (input: T) => Promise<void>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  });
}

/**
 * Removes a post named in a copyright notice (or another violation). Audited
 * against the author, which is the record for the repeat-infringer policy.
 */
export function useRemovePost() {
  return useAdminMutation(async ({ postId, reason }: { postId: string; reason: string }) => {
    const { error } = await supabase.rpc('admin_remove_post', { p_post_id: postId.trim(), p_reason: cleanText(reason) });
    if (error) throw fromPostgrest(error);
  });
}

/** The owner's "Unlimited Access" switch (`is_unlimited`). */
export function useSetUnlimited() {
  return useAdminMutation(async ({ userId, value, reason }: { userId: string; value: boolean; reason: string }) => {
    const { error } = await supabase.rpc('admin_set_unlimited', {
      p_user_id: userId,
      p_value: value,
      p_reason: cleanText(reason).slice(0, 280) || null,
    });
    if (error) throw fromPostgrest(error);
  });
}

export function useUpdateEntitlements() {
  return useAdminMutation(
    async (input: {
      userId: string;
      monthlyLimit?: number;
      maxVideoSeconds?: number;
      suspended?: boolean;
      suspendedReason?: string;
      reason: string;
    }) => {
      const { error } = await supabase.rpc('admin_update_entitlements', {
        p_user_id: input.userId,
        p_monthly_analysis_limit: input.monthlyLimit ?? null,
        p_max_video_seconds: input.maxVideoSeconds ?? null,
        p_is_suspended: input.suspended ?? null,
        p_suspended_reason: input.suspendedReason ? cleanText(input.suspendedReason) : null,
        p_reason: cleanText(input.reason).slice(0, 280) || null,
      });
      if (error) throw fromPostgrest(error);
    },
  );
}

// Moderation -------------------------------------------------------------------

export interface BanRow {
  user_id: string;
  username: string | null;
  reason: string;
  category: 'sexual_content' | 'text' | 'other';
  source: 'owner' | 'automatic';
  created_at: string;
  strikes: number;
}

export interface StrikeRow {
  user_id: string;
  username: string | null;
  kind: string;
  detail: string | null;
  created_at: string;
}

export interface BlockedTerm {
  term: string;
  category: 'sexual' | 'hate' | 'harassment';
  created_at: string;
}

function useAdminList<T>(key: string, rpc: 'admin_list_bans' | 'admin_list_strikes' | 'admin_list_blocked_terms') {
  return useQuery({
    queryKey: ['admin', key],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(rpc);
      if (error) throw fromPostgrest(error);
      return (data ?? []) as T[];
    },
  });
}

export const useBans = () => useAdminList<BanRow>('bans', 'admin_list_bans');
export const useStrikes = () => useAdminList<StrikeRow>('strikes', 'admin_list_strikes');
export const useBlockedTerms = () => useAdminList<BlockedTerm>('blocked-terms', 'admin_list_blocked_terms');

/** Bans the account and blocks the networks it used (stored as one-way fingerprints). */
export function useBanUser() {
  return useAdminMutation(async ({ userId, reason }: { userId: string; reason: string }) => {
    const { error } = await supabase.rpc('admin_ban_user', { p_user_id: userId, p_reason: cleanText(reason).slice(0, 280) });
    if (error) throw fromPostgrest(error);
  });
}

export function useUnbanUser() {
  return useAdminMutation(async ({ userId }: { userId: string }) => {
    const { error } = await supabase.rpc('admin_unban_user', { p_user_id: userId });
    if (error) throw fromPostgrest(error);
  });
}

export function useAddBlockedTerm() {
  return useAdminMutation(async ({ term, category }: { term: string; category: BlockedTerm['category'] }) => {
    const { error } = await supabase.rpc('admin_add_blocked_term', { p_term: term.trim().toLowerCase(), p_category: category });
    if (error) throw fromPostgrest(error);
  });
}

export function useRemoveBlockedTerm() {
  return useAdminMutation(async ({ term }: { term: string }) => {
    const { error } = await supabase.rpc('admin_remove_blocked_term', { p_term: term });
    if (error) throw fromPostgrest(error);
  });
}
