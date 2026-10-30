/**
 * files: the app's storage calls (`backend.storage.from(bucket)` in the app).
 *
 *   POST files/upload?bucket&path&upsert=0|1   body: the bytes (frames, pictures)
 *   POST files/sign-upload   { bucket, path, upsert, size, contentType } -> { signedUrl, path }
 *   POST files/sign-download { bucket, path, expiresIn }                 -> { signedUrl }
 *   POST files/list          { bucket, prefix, limit }                   -> [{ name, id }]
 *   POST files/remove        { bucket, paths }                           -> [{ name }]
 *
 * Every change is made to the file's row in `storage.objects` as the user
 * first, in one transaction with the change to the bytes: the storage
 * policies (own folder, fixed file names, age check, bans) decide, and the
 * bytes only change when the row change is allowed. Sizes and types follow
 * each bucket's limits in `storage.buckets`. Videos are too big to pass
 * through the function: they get a PUT link signed for their exact size and
 * type, and analyze-match checks them before anyone can see them.
 */

import type pg from 'pg';
import { z } from 'zod';
import { asUser, database, type UserRequest } from '../shared/db.ts';
import { HttpError, json, readJson } from '../shared/http.ts';
import { createHandler, type RequestContext } from '../shared/middleware.ts';
import { clampLinkSeconds, deleteObjects, likePrefix, childrenOf, putObject, signDownload, signUpload } from '../shared/storage.ts';

/** Buckets the app may use; the quarantine bucket is service-only. */
const BUCKETS = ['match-videos', 'match-frames', 'avatars'] as const;
type Bucket = (typeof BUCKETS)[number];
/** Uploads through the function are small (frames, pictures). */
const MAX_PASS_THROUGH_BYTES = 5 * 1024 * 1024;

const bucketSchema = z.enum(BUCKETS);
const pathSchema = z
  .string()
  .min(3)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)+$/, 'invalid path')
  .refine((path) => !path.split('/').some((part) => part === '.' || part === '..'), 'invalid path');
const folderSchema = z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*$/, 'invalid folder');

interface BucketLimits {
  fileSizeLimit: number | null;
  allowedTypes: string[] | null;
}

const limitsCache = new Map<string, { limits: BucketLimits; at: number }>();

async function bucketLimits(bucket: Bucket): Promise<BucketLimits> {
  const cached = limitsCache.get(bucket);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.limits;
  const { rows } = await database().query<{ file_size_limit: number | null; allowed_mime_types: string[] | null }>(
    'select file_size_limit, allowed_mime_types from storage.buckets where id = $1',
    [bucket],
  );
  if (!rows[0]) throw new HttpError(404, 'not_found', 'No such bucket');
  const limits = { fileSizeLimit: rows[0].file_size_limit, allowedTypes: rows[0].allowed_mime_types };
  limitsCache.set(bucket, { limits, at: Date.now() });
  return limits;
}

/** Throws 413/415 when a file breaks the bucket's limits. */
export function checkLimits(limits: BucketLimits, size: number, contentType: string, maxBytes = Number.POSITIVE_INFINITY): void {
  const cap = Math.min(limits.fileSizeLimit ?? Number.POSITIVE_INFINITY, maxBytes);
  if (!Number.isInteger(size) || size <= 0 || size > cap) throw new HttpError(413, 'file_too_large', 'The file is too large');
  if (limits.allowedTypes && !limits.allowedTypes.includes(contentType)) throw new HttpError(415, 'unsupported_type', 'This kind of file is not allowed');
}

/** The user's view of the request, for the storage policies. */
function userRequest(ctx: RequestContext, method: 'GET' | 'POST' | 'DELETE'): UserRequest {
  const headers: Record<string, string> = {};
  for (const name of ['cf-connecting-ip', 'x-real-ip', 'x-forwarded-for']) {
    const value = ctx.req.headers.get(name);
    if (value) headers[name] = value;
  }
  return { claims: ctx.user.claims, method, headers };
}

/** Maps a refusal by the storage policies (or a duplicate) to an HTTP error. */
function policyError(error: unknown): never {
  const code = (error as { code?: string }).code;
  const message = (error as { message?: string }).message ?? '';
  if (code === '23505') throw new HttpError(409, 'already_exists', 'The file already exists');
  if (code === '42501') {
    if (/banned/.test(message)) throw new HttpError(403, 'banned', 'This account or network is banned from MatIQ');
    if (/age_check_required/.test(message)) throw new HttpError(403, 'age_check_required', 'Enter your birth month and year first');
    throw new HttpError(403, 'forbidden', 'Not allowed');
  }
  throw error;
}

/** Records (or, with upsert, refreshes) the file's row as the user. */
async function claimRow(client: pg.PoolClient, bucket: Bucket, path: string, metadata: Record<string, unknown>, upsert: boolean): Promise<void> {
  await client.query(
    `insert into storage.objects (bucket_id, name, metadata) values ($1, $2, $3)
     ${upsert ? 'on conflict (bucket_id, name) do update set metadata = excluded.metadata, updated_at = now()' : ''}`,
    [bucket, path, metadata],
  );
}

async function upload(ctx: RequestContext): Promise<Response> {
  const bucket = bucketSchema.safeParse(ctx.url.searchParams.get('bucket'));
  const path = pathSchema.safeParse(ctx.url.searchParams.get('path'));
  if (!bucket.success || !path.success) throw new HttpError(400, 'invalid_request', 'Invalid bucket or path');
  if (bucket.data === 'match-videos') throw new HttpError(400, 'use_signed_upload', 'Videos are uploaded with a signed link');
  const upsert = ctx.url.searchParams.get('upsert') === '1';
  const contentType = (ctx.req.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase();
  const limits = await bucketLimits(bucket.data);

  const declared = Number(ctx.req.headers.get('Content-Length') ?? '0');
  if (declared > MAX_PASS_THROUGH_BYTES) throw new HttpError(413, 'file_too_large', 'The file is too large');
  const bytes = new Uint8Array(await ctx.req.arrayBuffer());
  checkLimits(limits, bytes.byteLength, contentType, MAX_PASS_THROUGH_BYTES);

  await asUser(userRequest(ctx, 'POST'), async (client) => {
    await claimRow(client, bucket.data, path.data, { size: bytes.byteLength, mimetype: contentType }, upsert);
    await putObject(bucket.data, path.data, bytes, contentType);
  }).catch(policyError);
  return json({ path: path.data });
}

const signUploadSchema = z
  .object({
    bucket: z.literal('match-videos'),
    path: pathSchema,
    upsert: z.boolean().default(false),
    size: z.number().int().positive(),
    contentType: z.string().min(1).max(100),
  })
  .strict();

async function signUploadLink(ctx: RequestContext): Promise<Response> {
  const body = await readJson(ctx.req, signUploadSchema, 2048);
  checkLimits(await bucketLimits(body.bucket), body.size, body.contentType);
  const signedUrl = await asUser(userRequest(ctx, 'POST'), async (client) => {
    // The row says what may be uploaded; analyze-match checks what actually was.
    await claimRow(client, body.bucket, body.path, { size: body.size, mimetype: body.contentType, pending: true }, body.upsert);
    return signUpload(body.bucket, body.path, { size: body.size, contentType: body.contentType });
  }).catch(policyError);
  return json({ signedUrl, path: body.path });
}

const signDownloadSchema = z
  .object({ bucket: bucketSchema, path: pathSchema, expiresIn: z.number().int().positive().max(7 * 24 * 3600) })
  .strict();

async function signDownloadLink(ctx: RequestContext): Promise<Response> {
  const body = await readJson(ctx.req, signDownloadSchema, 2048);
  const visible = await asUser(userRequest(ctx, 'GET'), async (client) => {
    const { rowCount } = await client.query('select 1 from storage.objects where bucket_id = $1 and name = $2', [body.bucket, body.path]);
    return (rowCount ?? 0) > 0;
  }).catch(policyError);
  // Missing and not allowed look the same, as with Supabase Storage.
  if (!visible) throw new HttpError(404, 'not_found', 'Object not found');
  return json({ signedUrl: await signDownload(body.bucket, body.path, clampLinkSeconds(body.expiresIn)) });
}

const listSchema = z
  .object({ bucket: bucketSchema, prefix: folderSchema, limit: z.number().int().min(1).max(1000).default(100) })
  .strict();

async function list(ctx: RequestContext): Promise<Response> {
  const body = await readJson(ctx.req, listSchema, 2048);
  const rows = await asUser(userRequest(ctx, 'GET'), async (client) => {
    const result = await client.query<{ id: string; name: string }>(
      'select id::text, name from storage.objects where bucket_id = $1 and name like $2 order by name limit 20000',
      [body.bucket, likePrefix(body.prefix)],
    );
    return result.rows;
  }).catch(policyError);
  return json(childrenOf(body.prefix, rows, 0, body.limit));
}

const removeSchema = z.object({ bucket: bucketSchema, paths: z.array(pathSchema).min(1).max(1000) }).strict();

async function remove(ctx: RequestContext): Promise<Response> {
  const body = await readJson(ctx.req, removeSchema, 128 * 1024);
  const removed = await asUser(userRequest(ctx, 'DELETE'), async (client) => {
    // Only the rows the user may delete come back; their bytes go with them.
    const { rows } = await client.query<{ name: string }>(
      'delete from storage.objects where bucket_id = $1 and name = any($2::text[]) returning name',
      [body.bucket, body.paths],
    );
    await deleteObjects(body.bucket, rows.map((row) => row.name));
    return rows;
  }).catch(policyError);
  return json(removed);
}

const ROUTES: Record<string, (ctx: RequestContext) => Promise<Response>> = {
  upload,
  'sign-upload': signUploadLink,
  'sign-download': signDownloadLink,
  list,
  remove,
};

const route = (ctx: RequestContext) => {
  const action = ctx.url.pathname.split('/').pop() ?? '';
  const handler = ROUTES[action];
  if (!handler) throw new HttpError(404, 'not_found', 'No such route');
  return handler(ctx);
};

/** Adding files needs the age check; reading and deleting your own don't (as before). */
export const filesWrite = createHandler({ name: 'files', methods: ['POST'], rateLimit: { max: 3000, windowSeconds: 3600 } }, route);
export const filesRead = createHandler(
  { name: 'files-read', methods: ['POST'], rateLimit: { max: 3000, windowSeconds: 3600 }, allowBeforeAgeCheck: true },
  route,
);
