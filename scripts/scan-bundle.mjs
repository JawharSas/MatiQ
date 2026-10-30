#!/usr/bin/env node
// Scans a built app bundle (expo export output) for credentials that must
// never ship in the app: Clerk secret keys, database connection strings,
// Supabase secret or service-role keys, AI provider keys, OAuth client
// secrets and private keys. Publishable keys are expected and allowed.
//
//   node scripts/scan-bundle.mjs <bundle-dir>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Hermes bytecode stores strings back to back, so a pattern can run into
// the next string: random-looking values must also mix upper case, lower case
// and digits (real keys do; identifiers and icon names don't).
const random = (value) => /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value);
const PATTERNS = [
  ['Supabase secret key', /sb_secret_([A-Za-z0-9_-]{20,})/g, random],
  ['Clerk secret key', /(?<![A-Za-z0-9])sk_(?:test|live)_([A-Za-z0-9]{30,})/g, random],
  ['Database connection string', /postgres(?:ql)?:\/\/[^\s:@/'"]+:([^\s@/'"]{8,})@/g, () => true],
  ['Anthropic API key', /(?<![A-Za-z0-9])sk-ant-([A-Za-z0-9_-]{20,})/g, random],
  ['OpenAI API key', /(?<![A-Za-z0-9-])sk-(?:proj-)?([A-Za-z0-9_-]{40,})/g, random],
  ['Google OAuth client secret', /GOCSPX-([A-Za-z0-9_-]{20,})/g, random],
  ['AWS access key', /\bAKIA([0-9A-Z]{16})\b/g, () => true],
  ['Private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g, () => true],
];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;
const PRIVILEGED_ROLES = new Set(['service_role', 'supabase_admin', 'postgres']);

const dir = process.argv[2];
if (!dir) {
  console.error('usage: scan-bundle.mjs <bundle-dir>');
  process.exit(2);
}

const files = [];
const walk = (path) => {
  for (const entry of readdirSync(path)) {
    const full = join(path, entry);
    if (statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
};
walk(dir);

const problems = [];
for (const file of files) {
  // latin1 keeps every byte, so Hermes bytecode string tables are searchable too.
  const text = readFileSync(file).toString('latin1');
  for (const [name, pattern, plausible] of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      if (plausible(match[1] ?? match[0])) problems.push(`${name} in ${relative(dir, file)}: ${match[0].slice(0, 12)}…`);
    }
  }
  for (const match of text.matchAll(JWT)) {
    try {
      const claims = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
      if (PRIVILEGED_ROLES.has(claims.role)) problems.push(`JWT with role ${claims.role} in ${relative(dir, file)}`);
    } catch {
      // Not a JWT after all.
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.log(`::error::${problem}`);
  console.log('The app bundle contains secrets. Remove them from EXPO_PUBLIC_* variables and rotate them.');
  process.exit(1);
}
console.log(`No secrets in ${files.length} bundle files.`);
