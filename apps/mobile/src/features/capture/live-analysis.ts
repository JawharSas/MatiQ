/**
 * Live (incremental) analysis client.
 *
 * While recording, every ~20 uploaded frames are sent to the server as one
 * batch; results are polled from `match_live_batches` (useLiveScore) and are
 * scored on the device with the same rules engine the server uses, so the
 * athlete sees a provisional score during the round. At the end only the
 * frames no batch covered are analysed, then the server scores everything
 * once. One quota unit is reserved for the whole match at `live_start`.
 */

import { fromFunctionError } from '@/lib/errors';
import { backend } from '@/lib/backend';
import type { MatchSetup } from './match-session';

export const FRAMES_PER_LIVE_BATCH = 20;

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await backend.functions.invoke<T>('analyze-match', { body });
  if (error || !data) throw await fromFunctionError(error);
  return data;
}

export function startLiveAnalysis(matchId: string, setup: MatchSetup) {
  return invoke<{ status: 'live'; usage: { used: number; monthlyLimit: number; isUnlimited: boolean } }>({
    action: 'live_start',
    matchId,
    keySource: setup.keySource,
    ...(setup.athleteAHint ? { athleteA: setup.athleteAHint } : {}),
    ...(setup.athleteBHint ? { athleteB: setup.athleteBHint } : {}),
  });
}

export function finalizeLiveAnalysis(matchId: string) {
  return invoke<{ status: 'queued' }>({ action: 'live_finalize', matchId });
}

export function cancelLiveAnalysis(matchId: string) {
  return invoke<{ status: 'cancelled' }>({ action: 'live_cancel', matchId });
}

/**
 * Groups uploaded frames into batches and submits them. Submission failures
 * are tolerated: finalize analyses any frame that no batch covered.
 */
export class LiveBatcher {
  private readonly matchId: string;
  private readonly batchSize: number;
  private pending: number[] = [];
  private nextIndex = 0;
  private inFlight = new Set<Promise<void>>();
  submitted = 0;
  failed = 0;

  constructor(matchId: string, batchSize = FRAMES_PER_LIVE_BATCH) {
    this.matchId = matchId;
    this.batchSize = batchSize;
  }

  /** Call after each frame upload succeeds. */
  onUploaded(t: number): void {
    this.pending.push(t);
    if (this.pending.length >= this.batchSize) this.submit(this.pending.splice(0, this.batchSize));
  }

  /** Waits for in-flight submissions (the analyses themselves keep running server side). */
  async settle(): Promise<void> {
    await Promise.all(this.inFlight);
  }

  private submit(frameTs: number[]): void {
    const batchIndex = this.nextIndex++;
    const request = invoke({ action: 'live_batch', matchId: this.matchId, batchIndex, frameTs: frameTs.sort((a, b) => a - b) })
      .then(() => {
        this.submitted++;
      })
      .catch(() => {
        this.failed++;
      })
      .finally(() => this.inFlight.delete(request));
    this.inFlight.add(request);
  }
}
