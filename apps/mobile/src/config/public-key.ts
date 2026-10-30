/**
 * Which Clerk key may be built into the app: only the publishable key
 * (`pk_test_...` / `pk_live_...`, the base64 of the instance's Frontend API
 * host followed by `$`). Secret keys (`sk_...`) act as the backend and must
 * stay on the server.
 */
export function isPublishableClerkKey(key: string): boolean {
  const match = /^pk_(test|live)_([A-Za-z0-9+/=_-]+)$/.exec(key);
  if (!match) return false;
  try {
    const host = atob(match[2]!.replace(/-/g, '+').replace(/_/g, '/'));
    return /^[a-z0-9.-]+\.[a-z]{2,}\$$/i.test(host);
  } catch {
    return false;
  }
}
