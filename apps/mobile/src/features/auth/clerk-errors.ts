/**
 * Clerk's error codes as MatIQ messages. Unknown email and wrong password
 * get the same message, so nobody can find out whether an account exists.
 */

import { messageFor } from '@/lib/errors';

/** The first error code Clerk gave (API errors carry a list), or ''. */
export function clerkErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const list = (error as { errors?: { code?: unknown }[] }).errors;
  const first = Array.isArray(list) ? list[0]?.code : undefined;
  const code = typeof first === 'string' ? first : (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : '';
}

export function clerkErrorMessage(error: unknown): string {
  const code = clerkErrorCode(error);
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 429 || code === 'too_many_requests') return messageFor('rate_limited');
  if (/banned/.test(code)) return messageFor('banned');
  switch (code) {
    case 'form_identifier_not_found':
    case 'form_password_incorrect':
    case 'form_password_or_identifier_incorrect':
      return 'Incorrect email or password.';
    case 'user_locked':
      return 'Too many attempts. This account is locked for a while; try again later.';
    case 'form_password_pwned':
      return 'This password has appeared in a data breach elsewhere. Choose a different one.';
    case 'form_identifier_exists':
      return 'An account with this email already exists. Sign in instead.';
    case 'form_code_incorrect':
      return "That code isn't right. Check it and try again.";
    case 'verification_expired':
      return 'That code has expired. Ask for a new one.';
    case 'session_exists':
      return 'You are already signed in.';
    case 'external_account_exists':
    case 'identifier_already_signed_in':
      return 'This Google account already belongs to another MatIQ account.';
    case 'form_password_validation_failed':
      return 'Your current password is incorrect.';
    case 'session_reverification_required':
      return 'For your security, sign out and sign back in, then try again.';
  }
  if (code.startsWith('form_password')) return 'Choose a password with 12+ characters, upper and lower case, a number and a symbol.';
  return 'Something went wrong. Please try again.';
}
