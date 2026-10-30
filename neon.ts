/**
 * MatIQ's backend on Neon, as code (docs/NEON_CLERK_MIGRATION.md): the
 * Data API (checking Clerk session tokens), the storage buckets, the `api`
 * function with its settings, and its schedule. The "Deploy Neon backend"
 * workflow applies it to the production branch with `neon deploy`.
 *
 * Function settings come from the environment (GitHub secrets and
 * variables in the workflow). Required ones stop the deploy when missing;
 * optional ones are only sent when set, so an unset one never blanks a
 * live value.
 */

import { defineConfig } from '@neon/config/v1';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set to deploy (docs/NEON_CLERK_MIGRATION.md, "What the deploy needs")`);
  return value;
}

/** Sent to the function only when set. */
const OPTIONAL = [
  'CLERK_SECRET_KEY',
  'CLERK_AUTHORIZED_PARTIES',
  'ANTHROPIC_API_KEY',
  'AI_PROVIDER',
  'AI_API_KEY',
  'AI_MODEL',
  'AI_BASE_URL',
  'ANALYSIS_MODEL',
  'ANALYSIS_EFFORT',
  'ANALYSIS_MAX_FRAMES',
  'ANALYSIS_FRAMES_PER_REQUEST',
  'ANALYSIS_CONCURRENCY',
  'ALLOWED_ORIGINS',
] as const;

const present = (names: readonly string[]) =>
  Object.fromEntries(names.flatMap((name) => (process.env[name]?.trim() ? [[name, process.env[name]!.trim()]] : [])));

const clerkIssuer = required('CLERK_ISSUER').replace(/\/+$/, '');
const kekCurrent = process.env.MATIQ_KEK_CURRENT?.trim() || '1';
// Every key-encryption key that is set: older ones still open records not yet rotated.
const keks = present(Object.keys(process.env).filter((name) => /^MATIQ_KEK_V\d+$/.test(name)));
required(`MATIQ_KEK_V${kekCurrent}`);

export default defineConfig({
  dataApi: {
    authProvider: 'external',
    providerName: 'clerk',
    jwksUrl: `${clerkIssuer}/.well-known/jwks.json`,
    settings: { dbSchemas: ['public'], dbAnonRole: 'anonymous', dbMaxRows: 1000 },
  },
  buckets: {
    'match-videos': { access: 'private' },
    'match-frames': { access: 'private' },
    avatars: { access: 'private' },
    'moderation-quarantine': { access: 'private' },
  },
  functions: {
    api: {
      name: 'MatIQ API',
      source: 'neon/functions/api/src/index.ts',
      env: { CLERK_ISSUER: clerkIssuer, MATIQ_KEK_CURRENT: kekCurrent, ...keks, ...present(OPTIONAL) },
    },
  },
  triggers: {
    // Bans, unbans and deletions decided in MatIQ reach Clerk within minutes.
    'clerk-sync': { type: 'schedule', function: 'api', cron: '*/5 * * * *', functionPath: '/jobs/clerk-sync' },
  },
});
