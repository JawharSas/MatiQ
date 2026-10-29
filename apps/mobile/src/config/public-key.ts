/**
 * Which Supabase API keys may be built into the app. Only the public one:
 * a publishable key (`sb_publishable_...`) or a legacy JWT whose role is
 * `anon`. Secret keys (`sb_secret_...`) and `service_role` JWTs bypass Row
 * Level Security and must stay on the server.
 */
export function isPublicSupabaseKey(key: string): boolean {
  // Anything else, secret keys included, is refused.
  if (key.startsWith('sb_publishable_')) return true;
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return (JSON.parse(atob(base64)) as { role?: unknown }).role === 'anon';
  } catch {
    return false;
  }
}
