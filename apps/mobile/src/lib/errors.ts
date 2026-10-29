/**
 * Turns Supabase / Edge Function errors into short user-facing messages.
 * Raw server messages are never shown verbatim for unknown errors.
 */

import { FunctionsHttpError } from '@supabase/supabase-js';

export class AppError extends Error {
  override name = 'AppError';
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const MESSAGES: Record<string, string> = {
  quota_exceeded: "You've used all of this month's analyses. Your quota resets on the 1st.",
  account_suspended: 'This account is suspended. Contact support if you think this is a mistake.',
  rate_limited: 'Too many requests. Please wait a moment and try again.',
  video_too_long: 'This video is longer than your plan allows.',
  frames_missing: 'The recording has no frames to analyse. Please try again.',
  already_processing: 'This match is already being analysed.',
  invalid_state: 'This match has already been analysed.',
  byok_key_missing: 'Add your API key in Settings first, or analyse with the MatIQ quota.',
  key_rejected: 'The provider rejected that API key.',
  invalid_key_format: "That doesn't look like a valid API key.",
  unauthorized: 'Your session expired. Please sign in again.',
  not_found: 'Not found.',
  validation_failed: 'Some of the details are invalid.',
  owner_account: 'Transfer the owner role before deleting this account.',
  mfa_required: 'Verify this sign-in with your authenticator app first.',
  not_ready: 'This result is still waiting for confirmation.',
  busy: 'Ratings are being updated. Try again in a moment.',
  invalid_scorecard: 'This recording has no usable scorecard.',
  invalid_birth_month: 'Enter a real birth month and year.',
  age_check_required: 'Enter your birth month and year first.',
  video_check_unavailable: "Your video couldn't be checked just now. Open the match and tap Retry analysis.",
  '22023': "That isn't possible right now. Refresh and try again.",
  // Postgres error codes surfaced by the Data API.
  '42501': "You don't have permission to do that.",
  P0429: 'Too many requests. Please wait a moment and try again.',
  P0002: 'Not found.',
  '23505': 'That is already taken.',
  '23514': 'Some of the details are invalid.',
};

export function messageFor(code: string | undefined, fallback = 'Something went wrong. Please try again.'): string {
  return (code && MESSAGES[code]) || fallback;
}

/** Normalises a PostgREST error ({ code, message }) into an AppError. */
export function fromPostgrest(error: { code?: string; message: string } | null): AppError | null {
  if (!error) return null;
  // The two-factor and age guards raise 42501 with a specific message.
  const code = error.message === 'mfa_required' || error.message === 'age_check_required' ? error.message : (error.code ?? 'unknown');
  return new AppError(code, messageFor(code));
}

/** Reads the `{ error: { code } }` body returned by MatIQ Edge Functions. */
export async function fromFunctionError(error: unknown): Promise<AppError> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: { code?: string } };
      const code = body.error?.code ?? 'unknown';
      return new AppError(code, messageFor(code));
    } catch {
      return new AppError('unknown', messageFor(undefined));
    }
  }
  return new AppError('network', 'Network error. Check your connection and try again.');
}

export function errorMessage(error: unknown): string {
  if (error instanceof AppError) return error.message;
  return messageFor(undefined);
}
