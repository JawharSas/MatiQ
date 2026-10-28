/** Input helpers for authenticator-app (TOTP) codes and secrets. */

/** Accepts "123 456", "123-456" or "123456"; returns the 6 digits or null. */
export function normalizeTotpCode(input: string): string | null {
  const digits = input.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** Splits a base32 secret into groups of four for manual entry. */
export function groupSecret(secret: string): string {
  return (secret.replace(/\s/g, '').match(/.{1,4}/g) ?? []).join(' ');
}
