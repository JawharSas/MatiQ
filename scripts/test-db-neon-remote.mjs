#!/usr/bin/env node
// Runs the database tests against a real Neon database
// (docs/NEON_CLERK_MIGRATION.md), for rehearsals before a cutover:
//
//   DATABASE_URL=postgresql://... node scripts/test-db-neon-remote.mjs
//
// Each test file runs in one transaction over Neon's HTTPS SQL endpoint and
// always ends in a deliberate error, so the transaction rolls back and the
// database is left exactly as it was. The schema must already be applied
// (scripts/neon-db.mjs).

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSql } from './neon-db.mjs';
import { toNeon } from './neon-sql.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROLLBACK = "select 'rolled back on purpose'::integer";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to the Neon connection string.');
  process.exit(2);
}
const { neon } = await import('@neondatabase/serverless');
const sql = neon(url);

// pg_session_jwt loads on first use, and loading it mid-transaction drops a
// `request.jwt.claims` set before (the tests set it the way PostgREST does;
// the Data API itself hands the extension the token). Load it first.
const LOAD_EXTENSION = 'select auth.session()';
const shim = [LOAD_EXTENSION, ...splitSql(readFileSync(join(ROOT, 'supabase/tests/local/01_pgtap_shim.sql'), 'utf8'))];
const files = ['supabase/tests/database', 'neon/tests/database'].flatMap((dir) =>
  readdirSync(join(ROOT, dir))
    .filter((file) => file.endsWith('.test.sql'))
    .sort()
    .map((file) => join(ROOT, dir, file)),
);

let failed = 0;
for (const file of files) {
  const name = file.slice(ROOT.length + 1);
  const body = toNeon(readFileSync(file, 'utf8'), name)
    .split('\n')
    .filter((line) => !/^\s*(begin|rollback);\s*$/.test(line) && !/create extension if not exists pgtap/.test(line))
    .join('\n');
  const planned = body.match(/select plan\((\d+)\)/)?.[1] ?? '?';
  try {
    await sql.transaction([...shim, ...splitSql(body), ROLLBACK].map((text) => sql.query(text)));
    // Never reached: the last statement always fails.
    console.log(`${name}: did not roll back`);
    failed++;
  } catch (error) {
    if (String(error.message).includes('rolled back on purpose')) {
      console.log(`${name}: all ${planned} tests passed`);
    } else {
      console.log(`${name}: FAILED: ${error.message}`);
      failed++;
    }
  }
}
process.exit(failed > 0 ? 1 : 0);
