/**
 * Two-factor rule for Edge Functions, mirroring `private.mfa_satisfied()` in
 * the database: once a user has a verified factor, only aal2 sessions may
 * act. Functions use the service-role client (RLS does not apply), so the
 * check has to happen here too.
 */

interface FactorLike {
  status?: string;
}

/** Reads the `aal` claim of a JWT the Auth server has already validated. */
export function jwtAal(token: string): string {
  const payload = token.split('.')[1];
  if (!payload) return 'aal1';
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const claims = JSON.parse(atob(base64)) as { aal?: unknown };
    return typeof claims.aal === 'string' ? claims.aal : 'aal1';
  } catch {
    return 'aal1';
  }
}

export function requiresStepUp(factors: readonly FactorLike[] | undefined, aal: string): boolean {
  return aal !== 'aal2' && (factors ?? []).some((factor) => factor.status === 'verified');
}
