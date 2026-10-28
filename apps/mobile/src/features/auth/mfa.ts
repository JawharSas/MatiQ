/**
 * Two-factor authentication with an authenticator app (TOTP).
 *
 * Supabase Auth issues an aal1 session after the password; verifying a TOTP
 * code upgrades it to aal2. Once a factor is verified the database, Storage,
 * Realtime and Edge Functions refuse aal1 sessions for this user, so the
 * challenge screen is a convenience, not the enforcement point.
 */

import type { Factor } from '@supabase/supabase-js';
import { useQuery } from '@tanstack/react-query';
import { AppError } from '@/lib/errors';
import { supabase } from '@/lib/supabase';
import { normalizeTotpCode } from './totp';

export interface TotpEnrollment {
  factorId: string;
  /** Base32 secret for manual entry. Never log or persist it. */
  secret: string;
  /** otpauth:// URI that authenticator apps register when opened. */
  uri: string;
}

function authError(code: string, message: string, error: { message?: string } | null): AppError {
  if (error && /invalid|expired|code/i.test(error.message ?? '')) {
    return new AppError('mfa_code_invalid', 'That code is incorrect or expired. Try the current code.');
  }
  return new AppError(code, message);
}

export async function listVerifiedFactors(): Promise<Factor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw new AppError('unknown', 'Could not load two-factor settings.');
  return data.totp;
}

export function useVerifiedFactors() {
  return useQuery({ queryKey: ['mfa-factors'], queryFn: listVerifiedFactors });
}

export async function startTotpEnrollment(): Promise<TotpEnrollment> {
  // Abandoned enrollments count against the factor limit: clear them first.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === 'totp' && factor.status === 'unverified') {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'MatIQ',
    friendlyName: `Authenticator ${new Date().toISOString().slice(0, 16)}`,
  });
  if (error || !data) throw new AppError('mfa_enroll_failed', 'Could not start two-factor setup. Try again.');
  return { factorId: data.id, secret: data.totp.secret, uri: data.totp.uri };
}

/** Verifies a code for `factorId`; on success the session becomes aal2. */
export async function verifyTotp(factorId: string, input: string): Promise<void> {
  const code = normalizeTotpCode(input);
  if (!code) throw new AppError('mfa_code_format', 'Enter the 6-digit code from your authenticator app.');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw authError('mfa_verify_failed', 'Verification failed. Try again.', error);
}

/** Removing a verified factor requires an aal2 session (Supabase enforces it). */
export async function removeFactor(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new AppError('mfa_remove_failed', 'Could not turn off two-factor authentication.');
  // Re-issue the session so its claims no longer list the removed factor.
  await supabase.auth.refreshSession();
}

/** True when this session must complete a TOTP challenge before using the app. */
export async function needsMfaChallenge(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // Fail open here only: the server still refuses aal1 sessions of 2FA users.
  if (error || !data) return false;
  return data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
}
