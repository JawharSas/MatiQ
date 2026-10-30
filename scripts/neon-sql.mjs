#!/usr/bin/env node
// Rewrites MatIQ's Supabase migrations (and pgTAP tests) for Neon: the
// Supabase Auth names they use move to the `app` schema that
// neon/compat.sql provides, because on Neon the `auth` schema belongs to
// pg_session_jwt (see docs/NEON_CLERK_MIGRATION.md). Supabase's request
// hook isn't installed: Neon's Data API has its own `authenticator` role,
// which the project can't change, and app.uid() does the hook's checks.
//
//   node scripts/neon-sql.mjs file.sql [...]   # prints the rewritten SQL
//
// Any other `auth.` name, or another change to the `authenticator` role, is
// an error, so a migration that starts using another Supabase Auth object
// can't slip through unnoticed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RENAMES = [
  [/\bauth\.(uid|jwt|role)\(\)/g, 'app.$1()'],
  [/\bauth\.(users|sessions|audit_log_entries|mfa_factors)\b/g, 'app.$1'],
  [/^(\s*)alter role authenticator set pgrst\.db_pre_request\b.*$/gm, '$1null; -- Neon: no request hook (app.uid() does its checks)'],
  [/^(\s*)notify pgrst, 'reload config';$/gm, '$1null;'],
];

// pg_session_jwt's own functions may be used as they are.
const ALLOWED = /\bauth\.(user_id|session)\(\)/g;

export function toNeon(sql, name = 'sql') {
  let out = sql;
  for (const [pattern, replacement] of RENAMES) out = out.replace(pattern, replacement);
  const lines = out.split('\n');
  const unknown = [];
  lines.forEach((line, index) => {
    const code = line.replace(/--.*$/, '').replace(ALLOWED, '');
    const match = code.match(/\bauth\.[A-Za-z_]+|\balter role authenticator\b/i);
    if (match) unknown.push(`${name}:${index + 1}: ${match[0]}`);
  });
  if (unknown.length > 0) {
    throw new Error(`Supabase Auth names with no Neon equivalent:\n${unknown.join('\n')}`);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node scripts/neon-sql.mjs file.sql [...]');
    process.exit(2);
  }
  try {
    for (const file of files) process.stdout.write(toNeon(readFileSync(file, 'utf8'), file));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
