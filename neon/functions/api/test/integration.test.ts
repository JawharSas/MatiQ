// The function against a database with the Neon schema: the RPC and query
// adapter, the request pipeline (Clerk token, bans, rate limits, age check)
// and the `files` routes, whose permissions come from the storage policies.
// S3 is a recorder (presigning works offline); Clerk keys are local.
//
//   DATABASE_URL=postgresql:///<db with the schema> node --test --experimental-strip-types test/integration.test.ts
//
// scripts/test-db-neon.sh runs it with NEON_API_TESTS=1.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { S3Client } from '@aws-sdk/client-s3';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

const ISSUER = 'https://clerk.matiq.test';
process.env.CLERK_ISSUER = ISSUER;

const { useClerkKeys } = await import('../src/shared/auth.ts');
const { database, from, rpc } = await import('../src/shared/db.ts');
const { adminBucket, useS3Client, S3_CONFIG } = await import('../src/shared/storage.ts');
const { default: app } = await import('../src/index.ts');

const skip = !process.env.DATABASE_URL && 'DATABASE_URL is not set';

const sent: { name: string; input: Record<string, unknown> }[] = [];
const s3 = new S3Client({
  ...S3_CONFIG,
  region: 'eu-central-1',
  endpoint: 'https://storage.matiq.test',
  credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
});
s3.send = (async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
  sent.push({ name: command.constructor.name, input: command.input });
  return {};
}) as unknown as S3Client['send'];

let sign: (sub: string) => Promise<string>;

interface Person {
  id: string;
  clerkId: string;
  token: string;
}

async function person(options: { ageChecked: boolean }): Promise<Person> {
  const id = randomUUID();
  const clerkId = `user_${id.replaceAll('-', '').slice(0, 20)}`;
  await database().query('insert into app.users (id, clerk_id, email) values ($1, $2, $3)', [id, clerkId, `${clerkId}@example.test`]);
  if (options.ageChecked) {
    const { data, error } = await rpc('svc_record_age', { p_user_id: id, p_year: 1990, p_month: 5 });
    assert.equal(error, null);
    assert.equal(data, 'ok');
  }
  return { id, clerkId, token: await sign(clerkId) };
}

async function newMatch(owner: Person): Promise<string> {
  const id = randomUUID();
  await database().query(
    `insert into public.matches (id, owner_id, discipline, variant, source, duration_ms) values ($1, $2, 'bjj', 'ibjjf', 'upload', 60000)`,
    [id, owner.id],
  );
  return id;
}

const call = (who: Person, route: string, init: { body?: BodyInit; json?: unknown; headers?: Record<string, string> } = {}) =>
  app.request(`https://api.matiq.test/${route}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${who.token}`,
      'X-Forwarded-For': '203.0.113.7',
      ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0xff, 0xd9]);

describe('api on the Neon schema', { skip }, () => {
  let alex: Person;
  let sam: Person;
  let newcomer: Person;
  let match: string;

  before(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'test', alg: 'RS256' };
    useClerkKeys(ISSUER, createLocalJWKSet({ keys: [jwk] }));
    sign = (sub) =>
      new SignJWT({ sid: 'sess_test' }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).setSubject(sub).setIssuer(ISSUER).setIssuedAt().setExpirationTime('5m').sign(privateKey);
    useS3Client(s3);
    alex = await person({ ageChecked: true });
    sam = await person({ ageChecked: true });
    newcomer = await person({ ageChecked: false });
    match = await newMatch(alex);
  });

  after(async () => {
    await database().query('delete from app.users where id = any($1::uuid[])', [[alex.id, sam.id, newcomer.id]]);
    await database().end();
  });

  test('rpc returns values, rows and lists the way PostgREST did', async () => {
    assert.deepEqual(await rpc('svc_user_for_clerk', { p_clerk_id: alex.clerkId }), { data: alex.id, error: null });
    assert.deepEqual(await rpc('svc_user_for_clerk', { p_clerk_id: 'user_nobody' }), { data: null, error: null });
    assert.deepEqual(await rpc('svc_record_address', { p_user: alex.id, p_ip: '203.0.113.7' }), { data: null, error: null });
    const next = await rpc('svc_next_clerk_sync', { p_limit: 5 });
    assert.equal(next.error, null);
    assert.ok(Array.isArray(next.data));
    const failed = await rpc('svc_record_age', { p_user_id: alex.id, p_year: 1990, p_month: 13 });
    assert.equal(failed.data, null);
    assert.equal(failed.error?.code, '22023');
  });

  test('from() selects, filters and returns one row or none', async () => {
    const one = await from('user_entitlements').select('role, is_suspended').eq('user_id', alex.id).maybeSingle();
    assert.equal(one.error, null);
    assert.equal(one.data?.role, 'user');
    assert.deepEqual(await from('user_entitlements').select('role').eq('user_id', randomUUID()).maybeSingle(), { data: null, error: null });
    const missing = await from('user_entitlements').select('role').eq('user_id', randomUUID()).single();
    assert.equal(missing.error?.code, 'PGRST116');
    const list = await from('matches').select('id, owner_id').eq('owner_id', alex.id).order('id');
    assert.deepEqual(list.data, [{ id: match, owner_id: alex.id }]);
  });

  test('an unknown token, or a Clerk user without an account, is refused', async () => {
    const stranger = { id: randomUUID(), clerkId: 'user_stranger', token: await sign('user_stranger') };
    assert.equal((await call(stranger, 'files/list', { json: { bucket: 'match-frames', prefix: 'x' } })).status, 403);
    const forged = { ...alex, token: `${alex.token.slice(0, -4)}AAAA` };
    assert.equal((await call(forged, 'files/list', { json: { bucket: 'match-frames', prefix: 'x' } })).status, 401);
  });

  test('frames upload into your own match folder only, once', async () => {
    const path = `${alex.id}/${match}/1000.jpg`;
    const upload = (who: Person, at: string, type = 'image/jpeg', body: Uint8Array = JPEG) =>
      call(who, `files/upload?bucket=match-frames&path=${encodeURIComponent(at)}&upsert=0`, { body, headers: { 'Content-Type': type } });

    sent.length = 0;
    const first = await upload(alex, path);
    assert.equal(first.status, 200, await first.clone().text());
    assert.deepEqual(sent.map((c) => [c.name, c.input.Bucket, c.input.Key]), [['PutObjectCommand', 'match-frames', path]]);
    const { rows } = await database().query('select owner from storage.objects where bucket_id = $1 and name = $2', ['match-frames', path]);
    assert.equal(rows[0]?.owner, alex.id);

    assert.equal((await upload(alex, path)).status, 409);
    sent.length = 0;
    assert.equal((await upload(sam, `${alex.id}/${match}/2000.jpg`)).status, 403);
    assert.equal((await upload(alex, `${alex.id}/${match}/notes.txt`)).status, 403);
    assert.equal((await upload(alex, `${alex.id}/${match}/3000.jpg`, 'image/png')).status, 415);
    assert.equal((await upload(alex, `${alex.id}/${match}/4000.jpg`, 'image/jpeg', new Uint8Array(2 * 1024 * 1024))).status, 413);
    assert.equal((await upload(newcomer, `${newcomer.id}/${match}/1000.jpg`)).status, 403);
    assert.equal(sent.length, 0, 'nothing refused reaches storage');
  });

  test('downloads, lists and deletes follow the storage rules', async () => {
    const path = `${alex.id}/${match}/1000.jpg`;
    const link = await call(alex, 'files/sign-download', { json: { bucket: 'match-frames', path, expiresIn: 600 } });
    assert.equal(link.status, 200);
    assert.match(((await link.json()) as { signedUrl: string }).signedUrl, /X-Amz-Signature=/);
    assert.equal((await call(sam, 'files/sign-download', { json: { bucket: 'match-frames', path, expiresIn: 600 } })).status, 404);

    const listed = await call(alex, 'files/list', { json: { bucket: 'match-frames', prefix: `${alex.id}/${match}` } });
    assert.deepEqual(((await listed.json()) as { name: string }[]).map((entry) => entry.name), ['1000.jpg']);
    const hidden = await call(sam, 'files/list', { json: { bucket: 'match-frames', prefix: `${alex.id}/${match}` } });
    assert.deepEqual(await hidden.json(), []);
    const folders = await adminBucket('match-frames').list(alex.id);
    assert.deepEqual(folders.data, [{ name: match, id: null }]);

    sent.length = 0;
    assert.deepEqual(await (await call(sam, 'files/remove', { json: { bucket: 'match-frames', paths: [path] } })).json(), []);
    assert.equal(sent.length, 0);
    assert.deepEqual(await (await call(alex, 'files/remove', { json: { bucket: 'match-frames', paths: [path] } })).json(), [{ name: path }]);
    assert.deepEqual(sent.map((c) => [c.name, c.input.Key]), [['DeleteObjectCommand', path]]);
  });

  test('a video gets a link signed for its exact size and type', async () => {
    const path = `${alex.id}/${match}/upload.mp4`;
    const sign = (who: Person, body: Record<string, unknown>) =>
      call(who, 'files/sign-upload', { json: { bucket: 'match-videos', path, upsert: true, size: 1_000_000, contentType: 'video/mp4', ...body } });

    const ok = await sign(alex, {});
    assert.equal(ok.status, 200, await ok.clone().text());
    const url = new URL(((await ok.json()) as { signedUrl: string }).signedUrl);
    assert.equal(url.pathname, `/match-videos/${path}`);
    assert.deepEqual(url.searchParams.get('X-Amz-SignedHeaders')?.split(';'), ['content-length', 'content-type', 'host']);
    assert.equal((await sign(alex, {})).status, 200, 'upsert replaces an unfinished upload');
    assert.equal((await sign(alex, { size: 10 * 1024 * 1024 * 1024 })).status, 413);
    assert.equal((await sign(alex, { contentType: 'video/x-matroska' })).status, 415);
    assert.equal((await sign(alex, { path: `${alex.id}/${match}/video.mp4` })).status, 403);
    assert.equal((await sign(sam, {})).status, 403);
  });

  test('the service side moves files with their rows', async () => {
    const pending = `${alex.id}/pending.jpg`;
    const upload = await call(alex, `files/upload?bucket=avatars&path=${encodeURIComponent(pending)}&upsert=1`, {
      body: JPEG,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    assert.equal(upload.status, 200, await upload.clone().text());
    sent.length = 0;
    const moved = await adminBucket('avatars').move(pending, `${alex.id}/case/avatars/pending.jpg`, { destinationBucket: 'moderation-quarantine' });
    assert.equal(moved.error, null);
    assert.deepEqual(sent.map((c) => c.name), ['CopyObjectCommand', 'DeleteObjectCommand']);
    const { rows } = await database().query('select bucket_id, owner from storage.objects where name = $1', [`${alex.id}/case/avatars/pending.jpg`]);
    assert.deepEqual(rows, [{ bucket_id: 'moderation-quarantine', owner: alex.id }]);
    await adminBucket('moderation-quarantine').remove([`${alex.id}/case/avatars/pending.jpg`]);
  });

  test('a banned account is refused everywhere', async () => {
    const { error } = await rpc('svc_ban_user', { p_user_id: sam.id, p_reason: 'test', p_category: 'other' });
    assert.equal(error, null);
    const refused = await call(sam, 'files/list', { json: { bucket: 'match-frames', prefix: sam.id } });
    assert.equal(refused.status, 403);
    assert.equal(((await refused.json()) as { error: { code: string } }).error.code, 'banned');
  });

  test('deleting an account queues the Clerk deletion', async () => {
    const leaving = await person({ ageChecked: true });
    await database().query('delete from app.users where id = $1', [leaving.id]);
    const { rows } = await database().query('select action from private.clerk_sync where clerk_id = $1', [leaving.clerkId]);
    assert.deepEqual(rows, [{ action: 'delete' }]);
    await database().query('delete from private.clerk_sync where clerk_id = $1', [leaving.clerkId]);
  });
});
