#!/usr/bin/env node
// Brings a Neon database up to date with MatIQ's schema
// (docs/NEON_CLERK_MIGRATION.md):
//
//   neon/compat.sql             every time (idempotent)
//   supabase/migrations/*.sql   rewritten by scripts/neon-sql.mjs, once each
//   neon/migrations/*.sql       once each
//
// Applied migrations are recorded in app.schema_migrations; each runs in its
// own transaction over Neon's HTTPS SQL endpoint, so this works wherever
// HTTPS does (GitHub Actions, cloud sessions behind a proxy).
//
//   DATABASE_URL=postgresql://... node scripts/neon-db.mjs [--dry-run]
//   node scripts/neon-db.mjs --split file.sql   # prints the statements (checks)

import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toNeon } from './neon-sql.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Splits SQL into statements at top-level semicolons, skipping comments,
 * quoted strings and identifiers, and dollar-quoted bodies.
 */
export function splitSql(sql) {
  const statements = [];
  let start = 0;
  let i = 0;
  const push = (end) => {
    const text = sql.slice(start, end).trim();
    // Comments alone are not a statement.
    if (text.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()) statements.push(text);
  };
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end + 1;
    } else if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) throw new Error('unterminated /* comment');
      i = end + 2;
    } else if (ch === "'" || ch === '"') {
      // '' and "" escape the quote; E'' strings also allow backslash escapes.
      const escapes = ch === "'" && /[eE]/.test(sql[i - 1] ?? '') && !/[\w$]/.test(sql[i - 2] ?? '');
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new Error(`unterminated ${ch} quote`);
        if (escapes && sql[j] === '\\') j += 2;
        else if (sql[j] === ch && sql[j + 1] === ch) j += 2;
        else if (sql[j] === ch) break;
        else j++;
      }
      i = j + 1;
    } else if (ch === '$' && !/[\w$]/.test(sql[i - 1] ?? '')) {
      const tag = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        if (end === -1) throw new Error(`unterminated ${tag[0]} body`);
        i = end + tag[0].length;
      } else {
        i++;
      }
    } else if (ch === ';') {
      push(i);
      i++;
      start = i;
    } else {
      i++;
    }
  }
  push(sql.length);
  return statements;
}

/** The migrations in the order they apply, with the SQL as Neon gets it. */
export function migrations() {
  const list = [];
  const supabase = join(ROOT, 'supabase/migrations');
  for (const file of readdirSync(supabase).filter((f) => f.endsWith('.sql')).sort()) {
    list.push({ name: file, sql: toNeon(readFileSync(join(supabase, file), 'utf8'), file) });
  }
  const neon = join(ROOT, 'neon/migrations');
  for (const file of readdirSync(neon).filter((f) => f.endsWith('.sql')).sort()) {
    list.push({ name: `neon/${file}`, sql: readFileSync(join(neon, file), 'utf8') });
  }
  return list;
}

async function apply({ dryRun }) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Set DATABASE_URL to the Neon connection string.');
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(url);
  const run = (statements) => sql.transaction(statements.map((text) => sql.query(text)));

  console.log('compat.sql');
  if (!dryRun) await run(splitSql(readFileSync(join(ROOT, 'neon/compat.sql'), 'utf8')));
  if (!dryRun) {
    await sql.query('create table if not exists app.schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  }
  const [{ exists }] = await sql.query("select to_regclass('app.schema_migrations') is not null as exists");
  const done = new Set(exists ? (await sql.query('select name from app.schema_migrations')).map((row) => row.name) : []);

  let applied = 0;
  for (const migration of migrations()) {
    if (done.has(migration.name)) continue;
    const statements = splitSql(migration.sql);
    console.log(`${migration.name} (${statements.length} statements)`);
    if (dryRun) continue;
    await run([...statements, `insert into app.schema_migrations (name) values ('${migration.name.replace(/'/g, "''")}')`]);
    applied++;
  }
  console.log(applied === 0 && !dryRun ? 'Up to date.' : `Applied ${applied} migration(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--split') {
      for (const file of args.slice(1)) {
        for (const statement of splitSql(toNeon(readFileSync(file, 'utf8'), basename(file)))) process.stdout.write(`${statement};\n-- @@\n`);
      }
    } else {
      await apply({ dryRun: args.includes('--dry-run') });
    }
  } catch (error) {
    console.error(error.message ?? error);
    process.exit(1);
  }
}
