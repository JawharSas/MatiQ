/**
 * Provisional score during a live recording.
 *
 * Subscribes to the match's analysed batches (Realtime; RLS limits them to
 * the owner) and runs the shared rules engine on the device over all events
 * received so far. Updates arrive once per batch (~every 20-40 s), so this
 * re-renders rarely and never touches the camera subtree.
 */

import { analyzeMatch, type Discipline, type Scorecard } from '@matiq/rules-engine';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface BatchRow {
  batch_index: number;
  status: 'processing' | 'done' | 'failed';
  frame_ts: number[];
  events: unknown[];
}

export interface LiveScore {
  scorecard: Scorecard | null;
  analysedBatches: number;
  pendingBatches: number;
}

export function useLiveScore(match: { id: string; discipline: Discipline; variant: string } | null): LiveScore {
  const [batches, setBatches] = useState<Map<number, BatchRow>>(new Map());

  useEffect(() => {
    if (!match) return;
    let cancelled = false;
    const upsert = (row: BatchRow) =>
      setBatches((current) => {
        const next = new Map(current);
        next.set(row.batch_index, row);
        return next;
      });

    const channel = supabase
      .channel(`live-batches:${match.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'match_live_batches', filter: `match_id=eq.${match.id}` },
        (payload) => {
          if (payload.new && 'batch_index' in payload.new) upsert(payload.new as BatchRow);
        },
      )
      .subscribe();

    // Catch up on batches finished before the subscription was established.
    supabase
      .from('match_live_batches')
      .select('batch_index, status, frame_ts, events')
      .eq('match_id', match.id)
      .then(({ data }) => {
        if (!cancelled) for (const row of (data ?? []) as BatchRow[]) upsert(row);
      });

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [match]);

  return useMemo(() => {
    const rows = [...batches.values()];
    const done = rows.filter((row) => row.status === 'done');
    const events = done.flatMap((row) => row.events);
    const lastT = Math.max(1000, ...done.flatMap((row) => row.frame_ts));
    let scorecard: Scorecard | null = null;
    if (match && done.length > 0) {
      try {
        scorecard = analyzeMatch(match.discipline, events, { durationMs: lastT + 1000, variant: match.variant });
      } catch {
        scorecard = null;
      }
    }
    return {
      scorecard,
      analysedBatches: done.length,
      pendingBatches: rows.filter((row) => row.status === 'processing').length,
    };
  }, [batches, match]);
}
