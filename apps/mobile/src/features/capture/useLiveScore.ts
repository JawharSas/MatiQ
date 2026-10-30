/**
 * Provisional score during a live recording.
 *
 * Polls the match's analysed batches (RLS limits them to the owner) and runs
 * the shared rules engine on the device over all events received so far.
 * Batches finish every 20-40 s and only changed rows cause a render, so this
 * re-renders rarely and never touches the camera subtree.
 */

import { analyzeMatch, type Discipline, type Scorecard } from '@matiq/rules-engine';
import { useEffect, useMemo, useState } from 'react';
import { backend } from '@/lib/backend';

/** Batches take 20-40 s, so a few seconds of delay is never noticed. */
const POLL_MS = 5000;

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
    const merge = (rows: BatchRow[]) =>
      setBatches((current) => {
        const changed = rows.filter((row) => {
          const known = current.get(row.batch_index);
          return !known || known.status !== row.status || known.events.length !== row.events.length;
        });
        if (changed.length === 0) return current;
        const next = new Map(current);
        for (const row of changed) next.set(row.batch_index, row);
        return next;
      });

    const poll = async () => {
      const { data } = await backend.from('match_live_batches').select('batch_index, status, frame_ts, events').eq('match_id', match.id);
      if (!cancelled && data) merge(data as BatchRow[]);
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
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
