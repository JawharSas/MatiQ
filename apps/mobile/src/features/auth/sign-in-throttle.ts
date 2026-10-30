/**
 * Slows down password guessing on this device: after 5 wrong sign-ins in a
 * row, each further attempt waits 30 seconds, doubling up to 15 minutes. A
 * successful sign-in clears it. The server's own limits (Clerk's per-account
 * lockout and rate limits) apply on top; this only stops a phone from being used to
 * hammer them.
 */

export interface ThrottleState {
  failures: number;
  /** Epoch ms before which no attempt is sent. */
  lockedUntil: number;
}

export const FREE_ATTEMPTS = 5;
export const BASE_LOCK_MS = 30_000;
export const MAX_LOCK_MS = 15 * 60_000;
export const THROTTLE_KEY = 'auth:sign-in-throttle';

export const noThrottle: ThrottleState = { failures: 0, lockedUntil: 0 };

export function afterFailure(state: ThrottleState, now: number): ThrottleState {
  const failures = state.failures + 1;
  if (failures < FREE_ATTEMPTS) return { failures, lockedUntil: 0 };
  return { failures, lockedUntil: now + Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (failures - FREE_ATTEMPTS)) };
}

export function remainingMs(state: ThrottleState, now: number): number {
  return Math.max(0, state.lockedUntil - now);
}

export function parseThrottle(raw: string | undefined): ThrottleState {
  try {
    const value = JSON.parse(raw ?? '') as Partial<ThrottleState>;
    const failures = Number(value.failures);
    const lockedUntil = Number(value.lockedUntil);
    if (Number.isInteger(failures) && failures >= 0 && Number.isFinite(lockedUntil)) return { failures, lockedUntil };
  } catch {
    // Missing or unreadable: start over.
  }
  return noThrottle;
}

export function waitMessage(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  const wait = seconds < 90 ? `${seconds} seconds` : `${Math.ceil(seconds / 60)} minutes`;
  return `Too many sign-in attempts. Try again in ${wait}.`;
}
