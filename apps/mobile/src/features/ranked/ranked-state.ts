/**
 * What a ranked match means for the signed-in fighter right now: its stage,
 * the status line to show and which actions are allowed. Mirrors the server
 * rules (supabase/migrations/20261028000100_ranked.sql); the server still
 * checks every action.
 */

import type { Discipline } from '@matiq/rules-engine';

export type RankedStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'cancelled'
  | 'expired'
  | 'awaiting_confirmation'
  | 'disputed'
  | 'confirmed'
  | 'voided';

export interface RankedMatchRow {
  id: string;
  discipline: Discipline;
  variant: string;
  challenger_id: string;
  opponent_id: string;
  message: string | null;
  status: RankedStatus;
  match_id: string | null;
  fighter_a_id: string | null;
  fighter_b_id: string | null;
  winner_id: string | null;
  result_method: string | null;
  confirmed_a_at: string | null;
  confirmed_b_at: string | null;
  confirm_by: string | null;
  recorded_at: string | null;
  dispute_reason: string | null;
  rating_a_before: number | null;
  rating_a_after: number | null;
  rating_b_before: number | null;
  rating_b_after: number | null;
  expires_at: string;
  created_at: string;
  settled_at: string | null;
}

export type RankedStage =
  | 'incoming'
  | 'outgoing'
  | 'to_record'
  | 'analysing'
  | 'confirm'
  | 'waiting'
  | 'ready'
  | 'disputed'
  | 'confirmed'
  | 'closed';

export interface RankedView {
  stage: RankedStage;
  opponentId: string;
  /** Something is waiting on this user. */
  actionNeeded: boolean;
  label: string;
  /** This user's result once the analysis proposed one. */
  myResult: 'win' | 'loss' | 'draw' | null;
  /** Rating change once settled. */
  myDelta: number | null;
  canAccept: boolean;
  canCancel: boolean;
  canRecord: boolean;
  canConfirm: boolean;
  canDispute: boolean;
  /** Ready to settle: the app settles it automatically. */
  canSettle: boolean;
}

/** A recorder's own win must be confirmed by Fighter 2 within this time. */
export const RECORDER_WIN_CONFIRM_MS = 7 * 24 * 60 * 60 * 1000;

const CLOSED_LABELS: Partial<Record<RankedStatus, string>> = {
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
  voided: 'Voided, no rating change',
};

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function describeRanked(row: RankedMatchRow, me: string, now = Date.now()): RankedView {
  const opponentId = row.challenger_id === me ? row.opponent_id : row.challenger_id;
  const isA = row.fighter_a_id === me;
  const myResult: RankedView['myResult'] =
    row.status === 'awaiting_confirmation' || row.status === 'disputed' || row.status === 'confirmed'
      ? row.winner_id === null
        ? 'draw'
        : row.winner_id === me
          ? 'win'
          : 'loss'
      : null;
  const myDelta =
    row.status === 'confirmed'
      ? isA
        ? (row.rating_a_after ?? 0) - (row.rating_a_before ?? 0)
        : (row.rating_b_after ?? 0) - (row.rating_b_before ?? 0)
      : null;
  const base: RankedView = {
    stage: 'closed',
    opponentId,
    actionNeeded: false,
    label: CLOSED_LABELS[row.status] ?? row.status,
    myResult,
    myDelta,
    canAccept: false,
    canCancel: false,
    canRecord: false,
    canConfirm: false,
    canDispute: false,
    canSettle: false,
  };

  const unrecorded = row.match_id === null;
  const expired = (row.status === 'pending' || row.status === 'accepted') && unrecorded && Date.parse(row.expires_at) <= now;
  if (expired) return { ...base, label: 'Expired' };

  switch (row.status) {
    case 'pending':
      return row.opponent_id === me
        ? { ...base, stage: 'incoming', actionNeeded: true, label: 'Challenged you', canAccept: true }
        : { ...base, stage: 'outgoing', label: 'Waiting for them to accept', canCancel: true };
    case 'accepted':
      return unrecorded
        ? { ...base, stage: 'to_record', actionNeeded: true, label: `Accepted: record it by ${shortDate(row.expires_at)}`, canRecord: true, canCancel: true }
        : { ...base, stage: 'analysing', label: 'Recorded, waiting for the analysis (open it to check or retry)' };
    case 'awaiting_confirmation': {
      const mine = isA ? row.confirmed_a_at : row.confirmed_b_at;
      const theirs = isA ? row.confirmed_b_at : row.confirmed_a_at;
      const windowOver = row.confirm_by !== null && Date.parse(row.confirm_by) <= now;
      // The recorder's own win only counts once Fighter 2 confirms it.
      const recorderWon = row.winner_id !== null && row.winner_id === row.fighter_a_id;
      const recorderWinDeadline = row.recorded_at ? Date.parse(row.recorded_at) + RECORDER_WIN_CONFIRM_MS : null;
      if (recorderWon && !row.confirmed_b_at && recorderWinDeadline !== null && recorderWinDeadline <= now) {
        return { ...base, stage: 'closed', label: 'Not confirmed in time, no rating change' };
      }
      if ((mine && theirs) || (windowOver && !recorderWon)) {
        return { ...base, stage: 'ready', actionNeeded: true, label: 'Confirmed, updating ratings', canSettle: true };
      }
      const deadline = recorderWon && recorderWinDeadline !== null ? new Date(recorderWinDeadline).toISOString() : row.confirm_by;
      if (!mine) {
        return {
          ...base,
          stage: 'confirm',
          actionNeeded: true,
          label: `Check the result and confirm${deadline ? ` by ${shortDate(deadline)}` : ''}`,
          canConfirm: true,
          canDispute: true,
        };
      }
      return {
        ...base,
        stage: 'waiting',
        label: recorderWon
          ? `Waiting for your opponent to confirm${deadline ? ` by ${shortDate(deadline)}` : ''}`
          : `Waiting for your opponent${row.confirm_by ? ` (auto-confirms ${shortDate(row.confirm_by)})` : ''}`,
        canDispute: true,
      };
    }
    case 'disputed':
      return { ...base, stage: 'disputed', label: 'Disputed: under review' };
    case 'confirmed': {
      const outcome = myResult === 'win' ? 'Won' : myResult === 'loss' ? 'Lost' : 'Draw';
      const delta = myDelta === null ? '' : ` · ${myDelta >= 0 ? '+' : ''}${myDelta}`;
      return { ...base, stage: 'confirmed', label: `${outcome}${delta}` };
    }
    default:
      return base;
  }
}
