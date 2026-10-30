/**
 * Public runtime configuration.
 *
 * Only EXPO_PUBLIC_* variables are read here and they are inlined into the
 * bundle at build time, so they must never contain secrets. The Clerk
 * publishable key and the Neon Data API / function addresses are public:
 * every request is authorized by the user's own token and Row Level Security.
 * Validation fails fast with a readable message instead of a broken app.
 */

import { z } from 'zod';
import { isPublishableClerkKey } from './public-key';

const pinSchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, 'TLS pins must be base64 SHA-256 hashes');

const httpsUrl = (what: string) =>
  z
    .string()
    .url()
    .refine((url) => url.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?(\/|$)/.test(url), {
      message: `${what} must use HTTPS (plain HTTP is only allowed for a local dev server)`,
    })
    .transform((url) => url.replace(/\/+$/, ''));

const schema = z.object({
  /** Neon Data API, e.g. https://ep-....apirest....neon.tech/neondb/rest/v1 */
  dataApiUrl: httpsUrl('The Data API URL'),
  /** The `api` Neon Function (its routes: account, analyze-match, files, ...). */
  functionsUrl: httpsUrl('The functions URL'),
  clerkPublishableKey: z.string().refine(isPublishableClerkKey, {
    message: 'Use the Clerk publishable key (pk_test_... or pk_live_...). A secret key must never be built into the app.',
  }),
  tlsPins: z.array(pinSchema),
  tlsPinsExpire: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
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
  dataApiUrl: process.env.EXPO_PUBLIC_DATA_API_URL,
  functionsUrl: process.env.EXPO_PUBLIC_FUNCTIONS_URL,
  clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  tlsPins: splitList(process.env.EXPO_PUBLIC_TLS_PINS),
  tlsPinsExpire: process.env.EXPO_PUBLIC_TLS_PINS_EXPIRE || undefined,
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
      dataApiUrl: 'https://invalid.localhost',
      functionsUrl: 'https://invalid.localhost',
      clerkPublishableKey: 'pk_test_aW52YWxpZC5sb2NhbGhvc3Qk',
      tlsPins: [],
      legalEntity: 'MatIQ',
      dmcaAgent: { name: 'MatIQ', address: '', phone: '' },
    };

/** The Data API host (certificate pinning applies to it). */
export const dataApiHost = (() => {
  try {
    return new URL(env.dataApiUrl).hostname;
  } catch {
    return '';
  }
})();
