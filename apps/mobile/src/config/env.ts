/**
 * Public runtime configuration.
 *
 * Only EXPO_PUBLIC_* variables are read here and they are inlined into the
 * bundle at build time, so they must never contain secrets. The Supabase
 * anon key is safe to ship: every table is protected by Row Level Security.
 * Validation fails fast with a readable message instead of a broken app.
 */

import { z } from 'zod';
import { isPublicSupabaseKey } from './public-key';

const pinSchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'TLS pins must be base64 SHA-256 hashes');

const schema = z.object({
  supabaseUrl: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/.test(url), {
      message: 'Supabase URL must use HTTPS (plain HTTP is only allowed for a local dev stack)',
    }),
  supabaseAnonKey: z.string().min(20).refine(isPublicSupabaseKey, {
    message: 'Use the publishable (anon) key. A secret or service_role key must never be built into the app.',
  }),
  tlsPins: z.array(pinSchema),
  tlsPinsExpire: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  /** Cloudflare Turnstile site key (public). Set together with CAPTCHA protection in Supabase Auth. */
  turnstileSiteKey: z
    .string()
    .regex(/^[0-3]x[A-Za-z0-9_-]{10,64}$/, 'Turnstile site keys look like 0x4AAAA...')
    .optional(),
  legalEntity: z.string().min(1).max(80),
  /** Unset until the owner configures it; see features/legal/contact.ts. */
  supportEmail: z.string().email().optional(),
  /**
   * Designated agent for copyright (DMCA) notices, exactly as registered with
   * the U.S. Copyright Office (dmca.copyright.gov). Public by law.
   */
  dmcaAgent: z.object({
    name: z.string().min(1).max(120),
    address: z.string().max(300),
    email: z.string().email().optional(),
    phone: z.string().max(40),
  }),
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
  turnstileSiteKey: process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY || undefined,
  legalEntity: process.env.EXPO_PUBLIC_LEGAL_ENTITY || 'MatIQ',
  supportEmail: process.env.EXPO_PUBLIC_SUPPORT_EMAIL || undefined,
  dmcaAgent: {
    name: process.env.EXPO_PUBLIC_DMCA_AGENT_NAME || process.env.EXPO_PUBLIC_LEGAL_ENTITY || 'MatIQ',
    address: process.env.EXPO_PUBLIC_DMCA_AGENT_ADDRESS || '',
    email: process.env.EXPO_PUBLIC_DMCA_AGENT_EMAIL || process.env.EXPO_PUBLIC_SUPPORT_EMAIL || undefined,
    phone: process.env.EXPO_PUBLIC_DMCA_AGENT_PHONE || '',
  },
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
      dmcaAgent: { name: 'MatIQ', address: '', phone: '' },
    };

export const supabaseHost = (() => {
  try {
    return new URL(env.supabaseUrl).hostname;
  } catch {
    return '';
  }
})();
