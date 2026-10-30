/**
 * Files in Neon Object Storage, with a row per file in `storage.objects`.
 *
 * The bytes live in the branch's S3-compatible buckets (credentials, endpoint
 * and region are injected as AWS_* variables). The rows carry the storage
 * rules from the Supabase days: the `files` routes insert, read and delete
 * them as the user, so the same Row Level Security policies decide who may
 * do what, and the bytes change only when the row change is allowed.
 *
 * `adminBucket()` is the service-side view the handlers used through
 * supabase-js (`list`, `download`, `remove`, `move`, `createSignedUrl`),
 * keeping rows and bytes in step.
 */

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type pg from 'pg';
import { database, toDbError, type DbError } from './db.ts';

let client: S3Client | null = null;

export const S3_CONFIG: S3ClientConfig = {
  // Neon uses path-style addressing.
  forcePathStyle: true,
  // Only send checksums S3 requires: a presigned upload must not ask the
  // app for a checksum header it doesn't send.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
};

export function s3(): S3Client {
  client ??= new S3Client(S3_CONFIG);
  return client;
}

/** Tests: use this client (e.g. one whose `send` is recorded). */
export function useS3Client(next: S3Client | null): void {
  client = next;
}

/** Shortest and longest life of a presigned link. */
const MIN_LINK_SECONDS = 60;
const MAX_LINK_SECONDS = 24 * 60 * 60;
export const clampLinkSeconds = (seconds: number) =>
  Math.min(MAX_LINK_SECONDS, Math.max(MIN_LINK_SECONDS, Number.isFinite(seconds) ? Math.round(seconds) : 3600));

export function signDownload(bucket: string, key: string, seconds: number, s3Client = s3()): Promise<string> {
  return getSignedUrl(s3Client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: clampLinkSeconds(seconds) });
}

/** A PUT link for exactly this size and type: S3 refuses anything else sent to it. */
export function signUpload(
  bucket: string,
  key: string,
  file: { size: number; contentType: string },
  seconds = 3600,
  s3Client = s3(),
): Promise<string> {
  return getSignedUrl(s3Client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: file.contentType, ContentLength: file.size }), {
    expiresIn: clampLinkSeconds(seconds),
    signableHeaders: new Set(['content-type', 'content-length']),
  });
}

export async function putObject(bucket: string, key: string, body: Uint8Array, contentType: string): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.byteLength }));
}

export async function deleteObjects(bucket: string, keys: readonly string[]): Promise<void> {
  // One request per file, since S3-compatible stores differ on batch deletes' checksums.
  for (let i = 0; i < keys.length; i += 8) {
    await Promise.all(keys.slice(i, i + 8).map((key) => s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))));
  }
}

const copySource = (bucket: string, key: string) => `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

/** Escapes LIKE wildcards in a folder name. */
export const likePrefix = (folder: string) => `${folder.replace(/[\\%_]/g, (ch) => `\\${ch}`)}/%`;

export interface ListEntry {
  name: string;
  /** null for a folder, as Supabase Storage listed them. */
  id: string | null;
}

/** Files and folders directly inside `folder`, from rows `name` (full paths) under it. */
export function childrenOf(folder: string, rows: readonly { id: string; name: string }[], offset = 0, limit = 100): ListEntry[] {
  const seen = new Set<string>();
  const entries: ListEntry[] = [];
  for (const row of rows) {
    const rest = row.name.slice(folder.length + 1);
    const slash = rest.indexOf('/');
    const name = slash === -1 ? rest : rest.slice(0, slash);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    entries.push({ name, id: slash === -1 ? row.id : null });
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return entries.slice(offset, offset + limit);
}

type Result<T> = { data: T; error: null } | { data: null; error: DbError | Error };

async function attempt<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { data: await work(), error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error && !('code' in error) ? error : toDbError(error) };
  }
}

/** Lists rows under a folder through `query` (the owner, or the user inside `asUser`). */
export async function listFolder(
  query: Pick<pg.Pool, 'query'> | pg.PoolClient,
  bucket: string,
  folder: string,
  options: { limit?: number; offset?: number } = {},
): Promise<ListEntry[]> {
  const { rows } = await query.query<{ id: string; name: string }>(
    `select id::text, name from storage.objects where bucket_id = $1 and name like $2 order by name limit 20000`,
    [bucket, likePrefix(folder)],
  );
  return childrenOf(folder, rows, options.offset ?? 0, options.limit ?? 100);
}

/** The service-side bucket, as the handlers used it through supabase-js. */
export function adminBucket(bucket: string) {
  const db = () => database();
  return {
    list(folder: string, options: { limit?: number; offset?: number } = {}) {
      return attempt(() => listFolder(db(), bucket, folder, options));
    },

    download(key: string) {
      return attempt(async () => {
        const response = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const bytes = await response.Body?.transformToByteArray();
        if (!bytes) throw new Error('Object not found');
        return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: response.ContentType ?? 'application/octet-stream' });
      });
    },

    remove(keys: readonly string[]) {
      return attempt(async () => {
        if (keys.length === 0) return [];
        await deleteObjects(bucket, keys);
        await db().query('delete from storage.objects where bucket_id = $1 and name = any($2::text[])', [bucket, keys]);
        return keys.map((name) => ({ name }));
      });
    },

    /** Moves a file (into another bucket with `destinationBucket`), replacing what was there. */
    move(from: string, to: string, options: { destinationBucket?: string } = {}) {
      return attempt(async () => {
        const target = options.destinationBucket ?? bucket;
        try {
          await s3().send(new CopyObjectCommand({ Bucket: target, Key: to, CopySource: copySource(bucket, from) }));
        } catch (error) {
          if ((error as { name?: string }).name !== 'NoSuchKey') throw error;
          // A video upload link that was never used leaves a row without bytes.
          await db().query('delete from storage.objects where bucket_id = $1 and name = $2', [bucket, from]);
          throw new Error('Object not found');
        }
        await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: from }));
        await db().query(
          `with moved as (
             delete from storage.objects where bucket_id = $1 and name = $2
             returning owner, metadata
           )
           insert into storage.objects (bucket_id, name, owner, metadata)
           select $3, $4, owner, metadata from moved
           on conflict (bucket_id, name) do update
             set owner = excluded.owner, metadata = excluded.metadata, updated_at = now()`,
          [bucket, from, target, to],
        );
        return { message: 'Successfully moved' };
      });
    },

    createSignedUrl(key: string, seconds: number) {
      return attempt(async () => ({ signedUrl: await signDownload(bucket, key, seconds) }));
    },
  };
}

export type AdminBucket = ReturnType<typeof adminBucket>;
