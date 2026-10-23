/**
 * Public runtime configuration.
 *
 * Only EXPO_PUBLIC_* variables are read here and they are inlined into the
 * bundle at build time, so they must never contain secrets. The Supabase
 * anon key is safe to ship: every table is protected by Row Level Security.
 * Validation fails fast with a readable message instead of a broken app.
 */

import { z } from 'zod';

const pinSchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'TLS pins must be base64 SHA-256 hashes');

const schema = z.object({
  supabaseUrl: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/.test(url), {
      message: 'Supabase URL must use HTTPS (plain HTTP is only allowed for a local dev stack)',
    }),
  supabaseAnonKey: z.string().min(20),
  tlsPins: z.array(pinSchema),
  tlsPinsExpire: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  legalEntity: z.string().min(1).max(80),
  supportEmail: z.string().email(),
});

export type AppEnv = z.infer<typeof schema>;

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const parsed = schema.safeParse({
  // Direct property access is required so Metro can inline the values.
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  tlsPins: splitList(process.env.EXPO_PUBLIC_TLS_PINS),
  tlsPinsExpire: process.env.EXPO_PUBLIC_TLS_PINS_EXPIRE || undefined,
  legalEntity: process.env.EXPO_PUBLIC_LEGAL_ENTITY || 'MatIQ',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || 'privacy@example.com',
});

export const envError: string | null = parsed.success
  ? null
  : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');

export const env: AppEnv = parsed.success
  ? parsed.data
  : {
      supabaseUrl: 'https://invalid.localhost',
      supabaseAnonKey: 'invalid-configuration',
      tlsPins: [],
      legalEntity: 'MatIQ',
      supportEmail: 'privacy@example.com',
    };

export const supabaseHost = (() => {
  try {
    return new URL(env.supabaseUrl).hostname;
  } catch {
    return '';
  }
})();
