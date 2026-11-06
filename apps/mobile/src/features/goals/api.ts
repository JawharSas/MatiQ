import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUserId } from '@/features/auth/AuthProvider';
import { fromPostgrest } from '@/lib/errors';
import { backend } from '@/lib/backend';
import { GOAL_KINDS, type Goal, type GoalKind } from './progress';

/** Your weekly goals (RLS returns only your own). */
export function useGoals() {
  const userId = useUserId();
  return useQuery({
    queryKey: ['goals', userId],
    queryFn: async (): Promise<Goal[]> => {
      const { data, error } = await backend.from('training_goals').select('kind, target');
      if (error) throw fromPostgrest(error);
      return ((data ?? []) as Goal[]).filter((goal) => (GOAL_KINDS as readonly string[]).includes(goal.kind));
    },
  });
}

/**
 * Saves the goals: kinds with a target are set (or changed), kinds without
 * one are removed.
 */
export function useSaveGoals() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return async (targets: Partial<Record<GoalKind, number>>) => {
    const set = GOAL_KINDS.filter((kind) => (targets[kind] ?? 0) > 0).map((kind) => ({ kind, target: targets[kind]! }));
    const removed = GOAL_KINDS.filter((kind) => !((targets[kind] ?? 0) > 0));
    if (set.length > 0) {
      const { error } = await backend.from('training_goals').upsert(set, { onConflict: 'user_id,kind' });
      if (error) throw fromPostgrest(error);
    }
    if (removed.length > 0) {
      const { error } = await backend.from('training_goals').delete().in('kind', removed);
      if (error) throw fromPostgrest(error);
    }
    await queryClient.invalidateQueries({ queryKey: ['goals', userId] });
  };
}
