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
  byok_key_missing: 'Add your own AI key in Settings → AI provider first, or analyse with the MatIQ quota.',
  key_rejected: 'The provider rejected that API key. Check it was copied completely and is active.',
  invalid_key_format: "That doesn't look like a key for this AI. Check you chose the right one.",
  model_not_found: "That provider doesn't have this model. Pick one from the list.",
  model_no_vision: "This model can't read images, so it can't analyse matches. Pick one that can.",
  model_rejected: 'The provider would not run this model with your key. Try another model.',
  base_url_rejected: 'Use the public https address of the AI service, e.g. https://api.example.com/v1.',
  provider_rate_limited: 'The provider is limiting requests right now. Try again in a minute.',
  provider_unavailable: "The provider couldn't be reached. Try again in a moment.",
  ai_not_configured: "MatIQ's own AI isn't set up yet. Add your own AI key in Settings → AI provider.",
  ai_key_rejected: 'Your AI provider rejected the key. Add it again in Settings → AI provider.',
  ai_model_not_found: 'Your AI provider no longer has the chosen model. Pick another in Settings → AI provider.',
  ai_model_no_vision: "The chosen model can't read images. Pick another in Settings → AI provider.",
  ai_rate_limited: 'Your AI provider is limiting requests. Open the match and tap Retry analysis in a minute.',
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
  banned: 'This account is banned from MatIQ for breaking the community rules.',
  content_not_allowed: "That includes words MatIQ doesn't allow. Please change it.",
  avatar_requires_review: 'Profile pictures are checked before anyone sees them. Pick the picture again.',
  image_rejected: "This picture can't be used. Pick a different one.",
  moderation_unavailable: "Profile pictures can't be checked right now, so they can't be changed yet.",
  content_removed: 'This recording broke the community rules and was removed.',
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

const SPECIFIC_MESSAGES = new Set(['mfa_required', 'age_check_required', 'banned', 'content_not_allowed', 'avatar_requires_review']);

/** True for the error every request gets once an account (or its network) is banned. */
export function isBannedError(error: unknown): boolean {
  return (error instanceof AppError && error.code === 'banned') || (error instanceof Error && error.message === 'banned');
}

/** Normalises a PostgREST error ({ code, message }) into an AppError. */
export function fromPostgrest(error: { code?: string; message: string } | null): AppError | null {
  if (!error) return null;
  // The server's guards and filters raise a Postgres code with a specific message.
  const code = SPECIFIC_MESSAGES.has(error.message) ? error.message : (error.code ?? 'unknown');
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
