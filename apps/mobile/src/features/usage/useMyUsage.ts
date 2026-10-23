import { useQuery } from '@tanstack/react-query';
import { fromPostgrest } from '@/lib/errors';
import { supabase } from '@/lib/supabase';

export interface MyUsage {
  used: number;
  monthly_limit: number;
  is_unlimited: boolean;
  is_suspended: boolean;
  max_video_seconds: number;
  period_start: string;
  resets_at: string;
}

/** Remaining analyses for display. The server enforces the real limit. */
export function remainingAnalyses(usage: MyUsage | undefined): number | 'unlimited' | null {
  if (!usage) return null;
  if (usage.is_unlimited) return 'unlimited';
  return Math.max(0, usage.monthly_limit - usage.used);
}

export function useMyUsage() {
  return useQuery({
    queryKey: ['my-usage'],
    queryFn: async (): Promise<MyUsage | undefined> => {
      const { data, error } = await supabase.rpc('get_my_usage');
      if (error) throw fromPostgrest(error);
      return (data as MyUsage[] | null)?.[0];
    },
    staleTime: 30_000,
  });
}
