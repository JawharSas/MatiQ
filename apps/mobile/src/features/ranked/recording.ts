/**
 * Ranked recording context: an accepted ranked match the user is about to
 * record. The capture flow uses it to fix the ruleset, name the fighters and
 * link the draft to the ranked match before anything is uploaded.
 */

import type { Discipline } from '@matiq/rules-engine';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { defaultSetup } from '@/features/capture/MatchSetupForm';
import type { MatchSetup } from '@/features/capture/match-session';
import { fromPostgrest } from '@/lib/errors';
import { backend } from '@/lib/backend';
import { describeRanked, type RankedMatchRow } from './ranked-state';

export interface RankedRecording {
  id: string;
  discipline: Discipline;
  variant: string;
  myName: string;
  opponentName: string;
}

const uuid = z.string().uuid();

/** Loads the ranked match behind `/record?ranked=<id>`; null unless it is ready to record. */
export function useRankedRecording(rankedId: string | undefined, userId: string) {
  const id = uuid.safeParse(rankedId).success ? rankedId! : null;
  return useQuery({
    queryKey: ['ranked', 'recording', id],
    enabled: id !== null,
    queryFn: async (): Promise<RankedRecording | null> => {
      const { data, error } = await backend
        .from('ranked_matches')
        .select('id, discipline, variant, challenger_id, opponent_id, status, match_id, expires_at, fighter_a_id, fighter_b_id, winner_id, confirmed_a_at, confirmed_b_at, confirm_by, recorded_at, rating_a_before, rating_a_after, rating_b_before, rating_b_after, message, result_method, dispute_reason, created_at, settled_at')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw fromPostgrest(error);
      const row = data as RankedMatchRow | null;
      if (!row || describeRanked(row, userId).stage !== 'to_record') return null;
      const opponentId = row.challenger_id === userId ? row.opponent_id : row.challenger_id;
      const { data: people, error: peopleError } = await backend.from('profiles').select('id, display_name').in('id', [userId, opponentId]);
      if (peopleError) throw fromPostgrest(peopleError);
      const nameOf = (uid: string) => people?.find((person) => person.id === uid)?.display_name ?? 'Fighter';
      return { id: row.id, discipline: row.discipline, variant: row.variant, myName: nameOf(userId), opponentName: nameOf(opponentId) };
    },
  });
}

export function rankedSetup(ranked: RankedRecording): MatchSetup {
  return {
    ...defaultSetup(ranked.discipline),
    variant: ranked.variant,
    title: `Ranked: ${ranked.myName} vs ${ranked.opponentName}`.slice(0, 80),
    athleteALabel: ranked.myName.slice(0, 40),
    athleteBLabel: ranked.opponentName.slice(0, 40),
  };
}
