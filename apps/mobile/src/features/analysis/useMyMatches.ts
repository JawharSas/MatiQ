import { useQuery } from '@tanstack/react-query';
import { useUserId } from '@/features/auth/AuthProvider';
import { fromPostgrest } from '@/lib/errors';
import { readCache, writeCache } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import type { MatchResultSummary } from './match-record';
import type { MatchStatus } from './useMatch';

export interface MatchListItem {
  id: string;
  discipline: 'bjj' | 'wrestling' | 'mma';
  title: string;
  status: MatchStatus;
  duration_ms: number;
  recorded_at: string;
  athlete_a_label: string;
  athlete_b_label: string;
  /** From the analysis, when there is one. */
  result: MatchResultSummary | null;
  totals: { A: { points: number }; B: { points: number } } | null;
}

// Only the result and totals of each scorecard, not the whole thing.
const COLUMNS =
  'id, discipline, title, status, duration_ms, recorded_at, athlete_a_label, athlete_b_label, match_analyses(result:scorecard->result, totals:scorecard->totals)';

type Row = Omit<MatchListItem, 'result' | 'totals'> & {
  match_analyses: Pick<MatchListItem, 'result' | 'totals'> | Pick<MatchListItem, 'result' | 'totals'>[] | null;
};

/** The signed-in person's matches, newest first (shared by Matches and Profile). */
export function useMyMatches() {
  const userId = useUserId();
  const cacheKey = `matches:v2:${userId}`;
  return useQuery({
    queryKey: ['my-matches'],
    placeholderData: readCache<MatchListItem[]>(cacheKey),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('matches')
        .select(COLUMNS)
        .eq('owner_id', userId)
        .order('recorded_at', { ascending: false })
        .limit(100);
      if (error) throw fromPostgrest(error);
      const matches = ((data ?? []) as Row[]).map(({ match_analyses: analyses, ...match }) => {
        const analysis = Array.isArray(analyses) ? analyses[0] : analyses;
        return { ...match, result: analysis?.result ?? null, totals: analysis?.totals ?? null };
      });
      writeCache(cacheKey, matches);
      return matches;
    },
  });
}
