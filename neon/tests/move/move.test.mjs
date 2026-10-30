// scripts/move-to-neon.mjs against local databases (scripts/test-move-to-neon.sh
// builds them) with fakes for Clerk, Supabase Storage and Neon's S3.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const pg = require('pg');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const run = promisify(execFile);

const ALEX = 'aaaaaaaa-0000-4000-8000-000000000001';
const SAM = 'aaaaaaaa-0000-4000-8000-000000000002';
const KIM = 'aaaaaaaa-0000-4000-8000-000000000003';
const BO = 'aaaaaaaa-0000-4000-8000-000000000004';
const SERVICE_KEY = 'sb_secret_test_only';

const listen = (handler) =>
  new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
const body = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

// Clerk's Backend API, as far as the move uses it.
const clerk = { users: [], calls: [] };
const fakeClerk = async (req, res) => {
  const url = new URL(req.url, 'http://clerk');
  const send = (status, data) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  if (req.headers.authorization !== 'Bearer sk_test_fake') return send(401, { errors: [{ code: 'authentication_invalid' }] });
  const input = req.method === 'GET' ? null : JSON.parse((await body(req)).toString() || 'null');
  clerk.calls.push({ method: req.method, path: url.pathname, input });
  if (req.method === 'GET' && url.pathname === '/users') {
    const externalId = url.searchParams.get('external_id');
    const email = url.searchParams.get('email_address');
    return send(200, clerk.users.filter((u) => (externalId ? u.external_id === externalId : u.email_address.includes(email))));
  }
  if (req.method === 'POST' && url.pathname === '/users') {
    if (clerk.users.some((u) => u.email_address.includes(input.email_address[0]))) return send(422, { errors: [{ code: 'form_identifier_exists' }] });
    const user = { id: `user_${clerk.users.length + 1}`, ...input, banned: false };
    clerk.users.push(user);
    return send(200, user);
  }
  const match = /^\/users\/([^/]+)(\/ban)?$/.exec(url.pathname);
  const user = clerk.users.find((u) => u.id === match?.[1]);
  if (!user) return send(404, { errors: [{ code: 'resource_not_found' }] });
  if (req.method === 'PATCH') return send(200, Object.assign(user, input));
  if (req.method === 'POST' && match[2]) return send(200, Object.assign(user, { banned: true }));
  return send(405, {});
};

// Supabase Storage: the files the source's storage.objects rows point at (the video is missing).
const files = {
  [`avatars/${ALEX}/avatar.jpg`]: Buffer.from('jpeg'),
  [`match-frames/${ALEX}/bbbbbbbb-0000-4000-8000-000000000001/1000.jpg`]: Buffer.from('jpg'),
};
const fakeStorage = (req, res) => {
  if (req.headers.apikey !== SERVICE_KEY) return res.writeHead(401).end();
  const key = decodeURIComponent(req.url.replace('/storage/v1/object/', ''));
  const bytes = files[key];
  if (!bytes) return res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"not_found"}');
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length }).end(bytes);
};

// Neon's S3 (path style): HEAD and PUT.
const s3 = { objects: new Map(), puts: 0 };
const fakeS3 = async (req, res) => {
  const key = decodeURIComponent(new URL(req.url, 'http://s3').pathname.slice(1));
  if (req.method === 'HEAD') {
    const bytes = s3.objects.get(key);
    return bytes ? res.writeHead(200, { 'Content-Length': bytes.length }).end() : res.writeHead(404).end();
  }
  if (req.method === 'PUT') {
    s3.objects.set(key, await body(req));
    s3.puts++;
    return res.writeHead(200, { ETag: '"etag"' }).end();
  }
  res.writeHead(405).end();
};

let servers = [];
let target;
let env;

const move = (...flags) =>
  run(process.execPath, [join(ROOT, 'scripts/move-to-neon.mjs'), ...flags], { env, cwd: ROOT }).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }),
  );
const one = async (sql, params = []) => (await target.query(sql, params)).rows[0];

before(async () => {
  servers = await Promise.all([listen(fakeClerk), listen(fakeStorage), listen(fakeS3)]);
  const [clerkServer, storageServer, s3Server] = servers;
  env = {
    PATH: process.env.PATH,
    SUPABASE_DB_URL: process.env.SOURCE_URL,
    SUPABASE_URL: storageServer.url,
    SUPABASE_SERVICE_KEY: SERVICE_KEY,
    DATABASE_URL: process.env.TARGET_URL,
    CLERK_API_URL: clerkServer.url,
    CLERK_SECRET_KEY: 'sk_test_fake',
    AWS_ENDPOINT_URL_S3: s3Server.url,
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_REGION: 'eu-central-1',
  };
  target = new pg.Client({ connectionString: process.env.TARGET_URL });
  await target.connect();
});

after(async () => {
  await target?.end();
  for (const { server } of servers) server.close();
});

test('a dry run checks everything and writes nothing', async () => {
  const result = await move('--dry-run');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Dry run: the table copy was rolled back/);
  assert.equal((await one('select count(*)::int as n from app.users')).n, 0);
  assert.equal(clerk.calls.filter((c) => c.method !== 'GET').length, 0);
  assert.equal(s3.puts, 0);
});

test('the move copies tables, accounts and files', async () => {
  const result = await move();
  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout + result.stderr, /example\.test|\$2a\$|sb_secret/, 'no emails, hashes or keys in the logs');

  // Tables, with Supabase Auth's users as MatIQ accounts.
  assert.equal((await one('select count(*)::int as n from app.users')).n, 4);
  assert.equal((await one('select count(*)::int as n from public.profiles')).n, 4);
  assert.equal((await one('select count(*)::int as n from public.posts')).n, 1);
  assert.equal((await one('select count(*)::int as n from app.sessions')).n, 1);
  assert.equal((await one(`select count(*)::int as n from storage.objects`)).n, 3);
  assert.equal((await one('select count(*)::int as n from private.user_api_keys')).n, 0, 'stored AI keys stay behind');
  assert.equal((await one('select count(*)::int as n from private.rate_limits')).n, 0);

  // Identity sequences continue after the copied IDs; triggers are back on.
  const next = await one(
    `insert into public.rating_history (user_id, discipline, outcome, rating_before, rating_after, delta)
     values ($1, 'bjj', 'draw', 1016, 1016, 0) returning id`,
    [ALEX],
  );
  assert.equal(Number(next.id), 3);
  await target.query(`insert into app.users (id, email) values ('cccccccc-0000-4000-8000-000000000001', 'new@example.test')`);
  assert.equal((await one(`select count(*)::int as n from public.profiles where id = 'cccccccc-0000-4000-8000-000000000001'`)).n, 1);
  await target.query(`delete from app.users where id = 'cccccccc-0000-4000-8000-000000000001'`);
  await target.query('delete from private.clerk_sync');

  // Accounts: passwords keep working, two-factor comes along, the banned one is banned.
  const created = (id) => clerk.users.find((u) => u.external_id === id);
  assert.equal(created(ALEX).password_hasher, 'bcrypt');
  assert.match(created(ALEX).password_digest, /^\$2a\$10\$/);
  assert.equal(created(ALEX).totp_secret, 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
  assert.equal(created(SAM).skip_password_requirement, true);
  assert.equal(created(SAM).password_digest, undefined);
  assert.equal(created(KIM), undefined, 'never confirmed: not imported');
  assert.equal(created(BO).banned, true);
  const links = await target.query('select id, clerk_id from app.users order by id');
  assert.deepEqual(
    Object.fromEntries(links.rows.map((r) => [r.id, r.clerk_id])),
    { [ALEX]: created(ALEX).id, [SAM]: created(SAM).id, [KIM]: null, [BO]: created(BO).id },
  );

  // Files: copied, and the row without a file is reported.
  assert.equal(s3.puts, 2);
  assert.deepEqual(s3.objects.get(`avatars/${ALEX}/avatar.jpg`), Buffer.from('jpeg'));
  assert.match(result.stdout + result.stderr, /not on Supabase \(row without a file\): match-videos\//);
});

test('running it again finds what is already there', async () => {
  const postsBefore = clerk.calls.filter((c) => c.method === 'POST' && c.path === '/users').length;
  const result = await move();
  assert.equal(result.code, 0, result.stderr);
  assert.equal(clerk.calls.filter((c) => c.method === 'POST' && c.path === '/users').length, postsBefore, 'no Clerk user created twice');
  assert.equal(s3.puts, 2, 'no file copied twice');
  assert.equal((await one('select count(*)::int as n from app.users')).n, 4);
  assert.equal((await one('select count(*)::int as n from app.users where clerk_id is not null')).n, 3);
});

test('the real move turns Supabase read-only first; a dry run never does', async () => {
  const source = new pg.Client({ connectionString: process.env.SOURCE_URL });
  await source.connect();
  try {
    const readOnly = async () => (await source.query(`select private.read_only() as on`)).rows[0].on;
    assert.equal((await move('--dry-run', '--freeze-source', '--skip-clerk', '--skip-files')).code, 0);
    assert.equal(await readOnly(), false);
    const result = await move('--freeze-source', '--skip-clerk', '--skip-files');
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Supabase read-only/);
    assert.equal(await readOnly(), true);
    // A second run (it is safe to repeat) still works with Supabase read-only.
    assert.equal((await move('--freeze-source', '--skip-clerk', '--skip-files')).code, 0);
    // The switch itself never reaches Neon, where it would refuse every write.
    assert.equal((await one(`select count(*)::int as n from private.settings where key = 'read_only'`)).n, 0);
    assert.equal((await one(`select min_version from app.release_policy`)).min_version, '1.7.0', 'Neon keeps its own minimum version');
    await source.query(`delete from private.settings where key = 'read_only'`);
  } finally {
    await source.end();
  }
});

test('someone who already signed up in Clerk with the same email keeps that user', async () => {
  // As if Sam had tried the new app before the move: a Clerk user without an external ID.
  const sam = clerk.users.find((u) => u.external_id === SAM);
  delete sam.external_id;
  const result = await move('--skip-files');
  assert.equal(result.code, 0, result.stderr);
  assert.equal(sam.external_id, SAM);
  assert.equal((await one('select clerk_id from app.users where id = $1', [SAM])).clerk_id, sam.id);
});
