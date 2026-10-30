#!/usr/bin/env node
// Moves MatIQ's data from Supabase to a Neon branch
// (docs/NEON_CLERK_MIGRATION.md, "Moving the data"). Run by the "Move data
// to Neon" workflow; nothing on Supabase is changed.
//
//   node scripts/move-to-neon.mjs [--dry-run] [--skip-clerk] [--skip-files]
//
// --dry-run writes nothing anywhere: the table copy is rolled back after
// its counts are checked, Clerk is only searched, and files are only
// looked up.
//
// Source (read only): SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF (SQL and
// the service key through the Management API), or SUPABASE_DB_URL with
// SUPABASE_URL + SUPABASE_SERVICE_KEY (local tests).
// Target: DATABASE_URL (the Neon branch, owner role), the branch's storage
// (AWS_* variables), and Clerk (CLERK_SECRET_KEY).
//
// 1. Tables, in one transaction on Neon: user triggers off, the rows already
//    there deleted, Supabase's rows inserted in foreign-key order, identity
//    sequences moved past the copied IDs, triggers back on, and every
//    table's row count compared with Supabase's. Any difference rolls it all
//    back. Supabase Auth's users, sessions and sign-in log go to app.users,
//    app.sessions and app.audit_log_entries. Not copied: the AI keys people
//    stored (Supabase's key-encryption key can't be read back, so the app
//    asks for them again), rate-limit counters, two-factor factors (Clerk's
//    now) and Neon's own Clerk queue.
// 2. Accounts into Clerk: found by external ID (the MatIQ UUID) or created
//    with the account's bcrypt password hash, so passwords keep working;
//    authenticator-app secrets come along when Supabase has them. Banned
//    accounts are banned in Clerk. Each is then linked to its MatIQ account.
// 3. Files: every storage.objects row's bytes copied into the Neon bucket
//    (skipped when already there with the same size).
// Re-running is safe: tables are replaced, Clerk users are found again, and
// files already copied are skipped.
//
// Logs carry counts and account IDs only, never emails, hashes or keys.

import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { HeadObjectCommand, PutObjectCommand, S3Client } = require('@aws-sdk/client-s3');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SKIP_CLERK = args.has('--skip-clerk');
const SKIP_FILES = args.has('--skip-files');

const BUCKETS = ['match-videos', 'match-frames', 'avatars', 'moderation-quarantine'];
/** Tables that stay as they are on Neon. */
const NOT_COPIED = new Set(['private.user_api_keys', 'private.rate_limits', 'private.clerk_sync', 'app.mfa_factors', 'storage.buckets']);
/** Neon table -> where its rows are on Supabase, and which of them move. */
const SOURCES = {
  'app.users': { table: 'auth.users', where: 'deleted_at is null and coalesce(is_anonymous, false) = false' },
  'app.sessions': { table: 'auth.sessions', where: 'user_id in (select id from auth.users where deleted_at is null)' },
  'app.audit_log_entries': { table: 'auth.audit_log_entries' },
  'storage.objects': { table: 'storage.objects', where: `bucket_id in (${BUCKETS.map((b) => `'${b}'`).join(', ')})` },
};
/** Rows per read: analyses carry large scorecards. */
const PAGE = 200;

const log = (...parts) => console.log(...parts);
const fail = (message) => {
  console.error(`::error::${message}`);
  process.exit(1);
};
const need = (name) => process.env[name]?.trim() || fail(`${name} is not set`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Supabase (read only) --------------------------------------------------------------

const MANAGEMENT_API = 'https://api.supabase.com/v1';

function supabaseSource() {
  if (process.env.SUPABASE_DB_URL) {
    const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
    const ready = client.connect();
    return {
      async query(sql) {
        await ready;
        return (await client.query(sql)).rows;
      },
      close: () => client.end(),
    };
  }
  const token = need('SUPABASE_ACCESS_TOKEN');
  const ref = need('SUPABASE_PROJECT_REF');
  return {
    async query(sql) {
      for (let attempt = 1; ; attempt++) {
        const response = await fetch(`${MANAGEMENT_API}/projects/${ref}/database/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql }),
        });
        if (response.ok) return response.json();
        if ((response.status === 429 || response.status >= 500) && attempt < 5) {
          await sleep(2000 * attempt);
          continue;
        }
        throw new Error(`Supabase SQL failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
      }
    },
    close: async () => undefined,
  };
}

/** Storage URL and a key that reads every bucket (the service key). */
async function supabaseStorage() {
  if (process.env.SUPABASE_SERVICE_KEY) return { url: need('SUPABASE_URL'), key: process.env.SUPABASE_SERVICE_KEY };
  const token = need('SUPABASE_ACCESS_TOKEN');
  const ref = need('SUPABASE_PROJECT_REF');
  const response = await fetch(`${MANAGEMENT_API}/projects/${ref}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`reading the project's keys failed (${response.status})`);
  const keys = await response.json();
  const key = keys.find((k) => k.type === 'secret')?.api_key ?? keys.find((k) => k.name === 'service_role')?.api_key;
  if (!key) throw new Error('no service key found for the Supabase project');
  console.log(`::add-mask::${key}`);
  return { url: `https://${ref}.supabase.co`, key };
}

// Neon ------------------------------------------------------------------------------

const quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;
const qualified = (name) => name.split('.').map(quoteIdent).join('.');
const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;

/** The Neon tables to fill, in foreign-key order, with their columns. */
async function plan(neon) {
  const { rows: tables } = await neon.query(`
    select c.oid, n.nspname || '.' || c.relname as name
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind = 'r' and n.nspname in ('public', 'private', 'app', 'storage')`);
  const copied = tables.filter((t) => !NOT_COPIED.has(t.name));
  const byOid = new Map(copied.map((t) => [t.oid, t]));
  const { rows: edges } = await neon.query(`select conrelid as child, confrelid as parent from pg_constraint where contype = 'f'`);
  const { rows: columns } = await neon.query(`
    select a.attrelid as oid, a.attname as name, a.attidentity <> '' as identity
      from pg_attribute a
     where a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     order by a.attrelid, a.attnum`);

  // Kahn's algorithm: parents before children.
  const parents = new Map(copied.map((t) => [t.oid, new Set()]));
  for (const { child, parent } of edges) {
    if (byOid.has(child) && byOid.has(parent) && child !== parent) parents.get(child).add(parent);
  }
  const ordered = [];
  const done = new Set();
  while (ordered.length < copied.length) {
    const ready = copied.filter((t) => !done.has(t.oid) && [...parents.get(t.oid)].every((p) => done.has(p)));
    if (ready.length === 0) throw new Error('foreign keys form a cycle; the copy order is undefined');
    for (const t of ready.sort((a, b) => a.name.localeCompare(b.name))) {
      ordered.push(t);
      done.add(t.oid);
    }
  }
  return ordered.map((t) => ({
    name: t.name,
    columns: columns.filter((c) => c.oid === t.oid).map((c) => ({ name: c.name, identity: c.identity })),
    source: SOURCES[t.name] ?? { table: t.name },
  }));
}

async function sourceColumns(source, table) {
  const [schema, name] = table.split('.');
  const rows = await source.query(
    `select column_name from information_schema.columns where table_schema = ${literal(schema)} and table_name = ${literal(name)}`,
  );
  return new Set(rows.map((r) => r.column_name));
}

async function copyTables(source, neon, tables) {
  const counts = [];
  await neon.query('begin');
  try {
    for (const t of tables) await neon.query(`alter table ${qualified(t.name)} disable trigger user`);
    for (const t of [...tables].reverse()) await neon.query(`delete from ${qualified(t.name)}`);

    for (const t of tables) {
      const available = await sourceColumns(source, t.source.table);
      if (available.size === 0) throw new Error(`${t.source.table} not found on Supabase`);
      const cols = t.columns.filter((c) => available.has(c.name));
      const list = cols.map((c) => quoteIdent(c.name)).join(', ');
      const where = t.source.where ? ` where ${t.source.where}` : '';
      const [{ count: expected }] = await source.query(`select count(*)::int as count from ${qualified(t.source.table)}${where}`);
      const overriding = cols.some((c) => c.identity) ? ' overriding system value' : '';
      for (let offset = 0; offset < expected; offset += PAGE) {
        // ctid order is stable while Supabase is read-only for the move.
        const rows = await source.query(
          `select to_jsonb(s) as row from (select ${list} from ${qualified(t.source.table)}${where} order by ctid limit ${PAGE} offset ${offset}) s`,
        );
        if (rows.length === 0) break;
        await neon.query(
          `insert into ${qualified(t.name)} (${list})${overriding} select ${list} from jsonb_populate_recordset(null::${qualified(t.name)}, $1::jsonb)`,
          [JSON.stringify(rows.map((r) => r.row))],
        );
      }
      for (const c of t.columns.filter((col) => col.identity)) {
        await neon.query(
          `select setval(pg_get_serial_sequence($1, $2), coalesce((select max(${quoteIdent(c.name)}) from ${qualified(t.name)}), 0) + 1, false)`,
          [t.name, c.name],
        );
      }
      const [{ count: copied }] = (await neon.query(`select count(*)::int as count from ${qualified(t.name)}`)).rows;
      counts.push({ table: t.name, supabase: expected, neon: copied });
      log(`  ${t.name}: ${copied} of ${expected}`);
    }

    for (const t of tables) await neon.query(`alter table ${qualified(t.name)} enable trigger user`);
    const wrong = counts.filter((c) => c.supabase !== c.neon);
    if (wrong.length > 0) throw new Error(`row counts differ: ${wrong.map((c) => `${c.table} ${c.neon}/${c.supabase}`).join(', ')}`);
    if (DRY_RUN) {
      await neon.query('rollback');
      log('Dry run: the table copy was rolled back.');
    } else {
      await neon.query('commit');
    }
  } catch (error) {
    await neon.query('rollback').catch(() => undefined);
    throw error;
  }
  return counts;
}

// Clerk -----------------------------------------------------------------------------

const CLERK_API = process.env.CLERK_API_URL || 'https://api.clerk.com/v1';

async function clerk(method, path, body) {
  const secret = need('CLERK_SECRET_KEY');
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`${CLERK_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 429 && attempt < 8) {
      await sleep(1000 * Number(response.headers.get('retry-after') ?? attempt));
      continue;
    }
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (a proxy error page): the status says enough.
    }
    return { status: response.status, data };
  }
}

const errorCode = (data) => data?.errors?.[0]?.code ?? '';
const isBase32 = (value) => typeof value === 'string' && /^[A-Z2-7]{16,}=*$/.test(value);

async function importAccounts(source, neon) {
  const users = await source.query(`
    select u.id, u.email, u.encrypted_password, u.email_confirmed_at, u.banned_until, u.created_at,
           (select f.secret from auth.mfa_factors f
             where f.user_id = u.id and f.factor_type = 'totp' and f.status = 'verified'
             order by f.created_at limit 1) as totp_secret
      from auth.users u
     where u.deleted_at is null and coalesce(u.is_anonymous, false) = false
     order by u.created_at`);
  const result = { linked: 0, created: 0, banned: 0, totp: 0, totpLost: 0, skipped: [], failed: [] };
  for (const user of users) {
    if (!user.email || !user.email_confirmed_at) {
      // Never finished signing up (or has no email): nothing to sign in to.
      result.skipped.push(user.id);
      continue;
    }
    try {
      let clerkId = (await clerk('GET', `/users?external_id=${encodeURIComponent(user.id)}&limit=1`)).data?.[0]?.id;
      if (!clerkId && DRY_RUN) {
        result.created++;
        continue;
      }
      if (!clerkId) {
        const hash = typeof user.encrypted_password === 'string' && user.encrypted_password.startsWith('$2') ? user.encrypted_password : null;
        const created = await clerk('POST', '/users', {
          external_id: user.id,
          email_address: [user.email],
          created_at: new Date(user.created_at).toISOString(),
          ...(hash
            ? { password_digest: hash, password_hasher: 'bcrypt', skip_password_checks: true }
            : { skip_password_requirement: true }),
          ...(isBase32(user.totp_secret) ? { totp_secret: user.totp_secret } : {}),
        });
        if (created.status === 200 || created.status === 201) {
          clerkId = created.data.id;
          result.created++;
          // A secret Supabase keeps encrypted can't come along: two-factor is off until they set it up again.
          if (isBase32(user.totp_secret)) result.totp++;
          else if (user.totp_secret) result.totpLost++;
        } else if (errorCode(created.data) === 'form_identifier_exists') {
          // Someone already signed up with this email in Clerk: the same person.
          const found = (await clerk('GET', `/users?email_address=${encodeURIComponent(user.email)}&limit=2`)).data ?? [];
          if (found.length !== 1 || (found[0].external_id && found[0].external_id !== user.id)) {
            throw new Error('the email belongs to a different Clerk user');
          }
          clerkId = found[0].id;
          const patched = await clerk('PATCH', `/users/${clerkId}`, { external_id: user.id });
          if (patched.status !== 200) throw new Error(`Clerk answered ${patched.status} (${errorCode(patched.data)})`);
        } else {
          throw new Error(`Clerk answered ${created.status} (${errorCode(created.data)})`);
        }
      }
      if (DRY_RUN) {
        result.linked++;
        continue;
      }
      if (user.banned_until && new Date(user.banned_until) > new Date()) {
        const banned = await clerk('POST', `/users/${clerkId}/ban`);
        if (banned.status !== 200) throw new Error(`banning in Clerk failed (${banned.status})`);
        result.banned++;
      }
      await neon.query('select public.svc_link_clerk_user($1, $2, $3)', [user.id, clerkId, user.email]);
      result.linked++;
    } catch (error) {
      result.failed.push({ id: user.id, error: error.message });
    }
    await sleep(120);
  }
  return result;
}

// Files -----------------------------------------------------------------------------

async function copyFiles(source) {
  const storage = await supabaseStorage();
  const s3 = new S3Client({ forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' });
  const rows = await source.query(
    `select bucket_id, name, coalesce((metadata->>'size')::bigint, -1) as size from storage.objects where ${SOURCES['storage.objects'].where} order by bucket_id, name`,
  );
  const result = { copied: 0, present: 0, missing: [], failed: [] };
  const headers = storage.key.startsWith('eyJ') ? { apikey: storage.key, Authorization: `Bearer ${storage.key}` } : { apikey: storage.key };
  const copyOne = async (row) => {
    const label = `${row.bucket_id}/${row.name}`;
    try {
      const existing = await s3.send(new HeadObjectCommand({ Bucket: row.bucket_id, Key: row.name })).catch(() => null);
      if (existing && (Number(row.size) < 0 || existing.ContentLength === Number(row.size))) {
        result.present++;
        return;
      }
      if (DRY_RUN) {
        result.copied++;
        return;
      }
      const path = row.name.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(`${storage.url}/storage/v1/object/${row.bucket_id}/${path}`, { headers });
      if (response.status === 404 || response.status === 400) {
        result.missing.push(label);
        return;
      }
      if (!response.ok || !response.body) throw new Error(`Supabase answered ${response.status}`);
      await s3.send(
        new PutObjectCommand({
          Bucket: row.bucket_id,
          Key: row.name,
          Body: Readable.fromWeb(response.body),
          ContentLength: Number(response.headers.get('content-length')),
          ContentType: response.headers.get('content-type') ?? 'application/octet-stream',
        }),
      );
      result.copied++;
    } catch (error) {
      result.failed.push(`${label}: ${error.message}`);
    }
  };
  for (let i = 0; i < rows.length; i += 4) await Promise.all(rows.slice(i, i + 4).map(copyOne));
  return { total: rows.length, ...result };
}

// Run -------------------------------------------------------------------------------

const source = supabaseSource();
const neon = new pg.Client({ connectionString: need('DATABASE_URL') });
await neon.connect();
let failed = false;
try {
  log(`==> Tables${DRY_RUN ? ' (dry run)' : ''}`);
  const tables = await plan(neon);
  await copyTables(source, neon, tables);

  if (SKIP_CLERK) log('==> Accounts into Clerk: skipped');
  else {
    log('==> Accounts into Clerk');
    const accounts = await importAccounts(source, neon);
    log(
      `  ${DRY_RUN ? 'would link' : 'linked'} ${accounts.linked + (DRY_RUN ? accounts.created : 0)} (${DRY_RUN ? 'to create' : 'created'} ${accounts.created}, banned ${accounts.banned}); not imported (no confirmed email) ${accounts.skipped.length}`,
    );
    if (accounts.totp + accounts.totpLost > 0) {
      log(`  two-factor brought along for ${accounts.totp}; ${accounts.totpLost} must set it up again`);
    }
    if (accounts.totpLost > 0) console.warn(`::warning::${accounts.totpLost} accounts had two-factor that could not be brought along`);
    for (const f of accounts.failed) console.error(`::error::account ${f.id}: ${f.error}`);
    if (accounts.failed.length > 0) failed = true;
  }

  if (SKIP_FILES) log('==> Files: skipped');
  else {
    log('==> Files');
    const files = await copyFiles(source);
    log(`  ${files.total} files: ${DRY_RUN ? 'to copy' : 'copied'} ${files.copied}, already there ${files.present}, missing on Supabase ${files.missing.length}`);
    for (const m of files.missing) console.warn(`::warning::not on Supabase (row without a file): ${m}`);
    for (const f of files.failed) console.error(`::error::${f}`);
    if (files.failed.length > 0) failed = true;
  }
} catch (error) {
  console.error(`::error::${error.message}`);
  failed = true;
} finally {
  await neon.end();
  await source.close();
}
if (failed) process.exit(1);
log('==> Done');
