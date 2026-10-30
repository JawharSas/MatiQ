/**
 * Two-factor authentication with an authenticator app (TOTP), kept by Clerk.
 *
 * Once it is on, Clerk asks for a code (or a backup code) after the password
 * or Google sign-in and only then starts a session, so there is no
 * half-signed-in state for the app or the database to guard.
 */

import type { useUser } from '@clerk/expo';
import { AppError } from '@/lib/errors';
import { clerkErrorCode } from './clerk-errors';
import { normalizeTotpCode } from './totp';

type ClerkUser = NonNullable<ReturnType<typeof useUser>['user']>;

export interface TotpEnrollment {
  /** Base32 secret for manual entry. Never log or persist it. */
  secret: string;
  /** otpauth:// URI that authenticator apps register when opened. */
  uri: string;
}

function mfaError(error: unknown, code: string, message: string): unknown {
  switch (clerkErrorCode(error)) {
    case 'session_reverification_required':
      // Left as Clerk's error: the screen asks the person to confirm it's them and retries.
      return error;
    case 'form_code_incorrect':
    case 'verification_expired':
      return new AppError('mfa_code_invalid', 'That code is incorrect or expired. Try the current code.');
  }
  return new AppError(code, message);
}

export async function startTotpEnrollment(user: ClerkUser): Promise<TotpEnrollment> {
  try {
    const totp = await user.createTOTP();
    if (totp.secret && totp.uri) return { secret: totp.secret, uri: totp.uri };
  } catch (error) {
    throw mfaError(error, 'mfa_enroll_failed', 'Could not start two-factor setup. Try again.');
  }
  throw new AppError('mfa_enroll_failed', 'Could not start two-factor setup. Try again.');
}

/** Turns two-factor on. Returns the backup codes, to show once. */
export async function verifyTotp(user: ClerkUser, input: string): Promise<string[]> {
  const code = normalizeTotpCode(input);
  if (!code) throw new AppError('mfa_code_format', 'Enter the 6-digit code from your authenticator app.');
  try {
    const totp = await user.verifyTOTP({ code });
    await user.reload();
    return totp.backupCodes ?? [];
  } catch (error) {
    throw mfaError(error, 'mfa_verify_failed', 'Verification failed. Try again.');
  }
}

/** A fresh set of backup codes; the old ones stop working. */
export async function newBackupCodes(user: ClerkUser): Promise<string[]> {
  try {
    return (await user.createBackupCode()).codes;
  } catch (error) {
    throw mfaError(error, 'mfa_backup_failed', 'Could not make new backup codes. Try again.');
  }
}

export async function removeTotp(user: ClerkUser): Promise<void> {
  try {
    await user.disableTOTP();
    await user.reload();
  } catch (error) {
    throw mfaError(error, 'mfa_remove_failed', 'Could not turn off two-factor authentication.');
  }
}
