/**
 * Match + analysis data with live status updates.
 *
 * The `matches` row is polled while the analysis is queued or processing;
 * nothing else about a match changes on the server meanwhile.
 */

import type { Discipline, Scorecard } from '@matiq/rules-engine';
import { useQuery } from '@tanstack/react-query';
import { fromPostgrest } from '@/lib/errors';
import { backend } from '@/lib/backend';

export type MatchStatus = 'draft' | 'live' | 'queued' | 'processing' | 'completed' | 'failed';

export interface MatchDetail {
  id: string;
  owner_id: string;
  discipline: Discipline;
  variant: string;
  title: string;
  athlete_a_label: string;
  athlete_b_label: string;
  source: 'live' | 'upload';
  status: MatchStatus;
  duration_ms: number;
  has_video: boolean;
  error_code: string | null;
  recorded_at: string;
  analysis: {
    scorecard: Scorecard;
    coaching_summary: string | null;
    model: string;
    ruleset_version: string;
    created_at: string;
  } | null;
}

const COLUMNS =
  'id, owner_id, discipline, variant, title, athlete_a_label, athlete_b_label, source, status, duration_ms, has_video, error_code, recorded_at, match_analyses(scorecard, coaching_summary, model, ruleset_version, created_at)';

async function fetchMatch(id: string): Promise<MatchDetail> {
  const { data, error } = await backend.from('matches').select(COLUMNS).eq('id', id).single();
  if (error) throw fromPostgrest(error);
  const { match_analyses: analyses, ...match } = data as Omit<MatchDetail, 'analysis'> & {
    match_analyses: MatchDetail['analysis'] | MatchDetail['analysis'][];
  };
  const analysis = Array.isArray(analyses) ? (analyses[0] ?? null) : analyses;
  return { ...match, analysis };
}

export function useMatch(id: string) {
  // Polled while the analysis runs; it is the only change made elsewhere.
  return useQuery({
    queryKey: ['match', id],
    queryFn: () => fetchMatch(id),
    refetchInterval: (current) => {
      const status = current.state.data?.status;
      return status === 'queued' || status === 'processing' ? 5000 : false;
    },
  });
}

/** Short-lived signed URL for the match video (storage RLS decides access). */
export function useMatchVideoUrl(match: MatchDetail | undefined) {
  return useQuery({
    queryKey: ['match-video', match?.id],
    enabled: Boolean(match?.has_video),
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const folder = `${match!.owner_id}/${match!.id}`;
      const { data: objects } = await backend.storage.from('match-videos').list(folder, { limit: 5 });
      const file = objects?.find((object) => object.name === 'video.mp4' || object.name === 'video.mov');
      if (!file) return null;
      const { data, error } = await backend.storage.from('match-videos').createSignedUrl(`${folder}/${file.name}`, 3600);
      if (error) throw fromPostgrest({ message: error.message });
      return data.signedUrl;
    },
  });
}
