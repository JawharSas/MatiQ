/**
 * Typed, validated access to Edge Function secrets.
 *
 * Secrets are set with `supabase secrets set` (never committed). Values are
 * read lazily so a function that does not need, e.g., the AI key can still
 * boot when that secret is absent.
 */

export class ConfigError extends Error {
  override name = 'ConfigError';
}

function read(name: string): string | undefined {
  const value = Deno.env.get(name);
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function requireEnv(name: string): string {
  const value = read(name);
  if (!value) throw new ConfigError(`Missing required secret: ${name}`);
  return value;
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = read(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export const env = {
  supabaseUrl: () => requireEnv('SUPABASE_URL'),
  supabaseAnonKey: () => requireEnv('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: () => requireEnv('SUPABASE_SERVICE_ROLE_KEY'),

  /** Platform AI key (used when the user has not stored their own key). */
  anthropicApiKey: () => requireEnv('ANTHROPIC_API_KEY'),
  analysisModel: () => read('ANALYSIS_MODEL') ?? 'claude-opus-5-5',
  analysisEffort: (): 'low' | 'medium' | 'high' => {
    const value = read('ANALYSIS_EFFORT') ?? 'medium';
    if (value !== 'low' && value !== 'medium' && value !== 'high') {
      throw new ConfigError('ANALYSIS_EFFORT must be low, medium or high');
    }
    return value;
  },
  analysisMaxFrames: () => intEnv('ANALYSIS_MAX_FRAMES', 240, 8, 2000),
  analysisFramesPerRequest: () => intEnv('ANALYSIS_FRAMES_PER_REQUEST', 20, 2, 100),
  analysisConcurrency: () => intEnv('ANALYSIS_CONCURRENCY', 3, 1, 8),

  /** Current key-encryption-key version, e.g. "1" -> MATIQ_KEK_V1. */
  kekCurrentVersion: () => intEnv('MATIQ_KEK_CURRENT', 1, 1, 32767),
  kek: (version: number) => requireEnv(`MATIQ_KEK_V${version}`),

  /** Comma-separated browser origins allowed by CORS (empty = native app only). */
  allowedOrigins: (): string[] =>
    (read('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
};
