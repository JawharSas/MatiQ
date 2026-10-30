/**
 * Usage-limit enforcement.
 *
 * `withAnalysisQuota` is the only way analysis work is started:
 *
 *   1. Reserve one unit atomically in Postgres (svc_reserve_analysis locks the
 *      user's entitlements row, so concurrent requests cannot both pass).
 *      `is_unlimited = true` accounts bypass the monthly cap; suspended
 *      accounts are rejected.
 *   2. Run the work.
 *   3. Commit the reservation on success, refund it on failure. Reservations
 *      abandoned by a crashed worker are refunded automatically after 30 min.
 */

import { waitUntil } from '@neon/functions';
import type { Admin } from './admin.ts';
import { HttpError } from './http.ts';
import type { Logger } from './log.ts';

export type KeySource = 'platform' | 'byok';

export interface Reservation {
  id: string;
  used: number;
  monthlyLimit: number;
  isUnlimited: boolean;
}

interface ReserveRow {
  allowed: boolean;
  reservation_id: string | null;
  used: number;
  monthly_limit: number;
  is_unlimited: boolean;
  reason: string | null;
}

const DENIALS: Record<string, HttpError> = {
  quota_exceeded: new HttpError(429, 'quota_exceeded', 'Monthly analysis limit reached'),
  suspended: new HttpError(403, 'account_suspended', 'This account is suspended'),
  already_processing: new HttpError(409, 'already_processing', 'This match is already being analysed'),
  no_entitlements: new HttpError(403, 'forbidden'),
};

export async function reserveAnalysis(
  admin: Admin,
  userId: string,
  matchId: string,
  keySource: KeySource,
): Promise<Reservation> {
  const { data, error } = await admin.rpc('svc_reserve_analysis', {
    p_user_id: userId,
    p_match_id: matchId,
    p_key_source: keySource,
  });
  if (error) throw new Error(`quota reservation failed: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as ReserveRow | undefined;
  if (!row) throw new Error('quota reservation returned no row');
  if (!row.allowed || !row.reservation_id) {
    throw DENIALS[row.reason ?? ''] ?? new HttpError(403, 'forbidden');
  }
  return { id: row.reservation_id, used: row.used, monthlyLimit: row.monthly_limit, isUnlimited: row.is_unlimited };
}

export async function settleUsage(admin: Admin, reservationId: string, success: boolean): Promise<void> {
  const { error } = await admin.rpc('svc_settle_usage', { p_reservation_id: reservationId, p_success: success });
  if (error) throw new Error(`settling usage failed: ${error.message}`);
}

/**
 * Reserves quota, then runs `work` in the background (after the HTTP response
 * is sent) and settles the reservation based on its outcome. `onReserved`
 * runs (awaited) before the background work starts; if it throws, the
 * reservation is refunded. Returns the reservation so the caller can report
 * remaining usage immediately.
 */
export async function withAnalysisQuota(
  params: { admin: Admin; userId: string; matchId: string; keySource: KeySource; log: Logger },
  work: (reservation: Reservation) => Promise<void>,
  onReserved?: (reservation: Reservation) => Promise<void>,
): Promise<Reservation> {
  const reservation = await reserveAnalysis(params.admin, params.userId, params.matchId, params.keySource);

  if (onReserved) {
    try {
      await onReserved(reservation);
    } catch (error) {
      await settleUsage(params.admin, reservation.id, false).catch(() => undefined);
      throw error;
    }
  }

  const task = (async () => {
    let success = false;
    try {
      await work(reservation);
      success = true;
    } catch (error) {
      params.log.error('analysis failed', { error, matchId: params.matchId });
    } finally {
      await settleUsage(params.admin, reservation.id, success).catch((error) =>
        params.log.error('failed to settle usage', { error, reservationId: reservation.id }),
      );
    }
  })();

  runInBackground(task);
  return reservation;
}

/**
 * Keeps the function alive after the response until `promise` settles
 * (Neon allows 15 minutes). Off Neon (tests) it just runs.
 */
export function runInBackground(promise: Promise<unknown>): void {
  // Never an unhandled rejection: the work logs its own failures.
  const settled = promise.catch(() => undefined);
  waitUntil(settled);
}
