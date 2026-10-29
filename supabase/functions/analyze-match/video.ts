/**
 * Publishing uploaded videos.
 *
 * The app checks the whole file on the phone, then uploads it to
 * `{owner}/{match}/upload.{mp4|mov}`, the only names the storage policies let
 * clients write. Before a match is analysed, this function:
 *
 *   1. moves the upload to `checking.*`, out of the client's reach, so it
 *      cannot change while it is read;
 *   2. checks it again with the same checker as the app (container
 *      structure, every chunk inside the media data, nothing hidden; the
 *      frames themselves were read on the phone);
 *   3. publishes it as `video.{mp4|mov}`, the only name viewers can read, or
 *      deletes it.
 *
 * When the check can't run (storage unreachable), the upload stays in
 * `checking.*` and `video_check_unavailable` is thrown; callers mark the
 * match failed, so "Retry analysis" checks it again.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../_shared/http.ts';
import type { Logger } from '../_shared/log.ts';
import { type ByteSource, checkVideoFile } from '../_shared/rules-engine/media/index.ts';

const BUCKET = 'match-videos';
/** Same as the bucket limit. */
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
/** The structure check reads box headers and the movie header only. */
const MAX_FETCH_BYTES = 40 * 1024 * 1024;
const UPLOADED = /^upload\.(mp4|mov)$/;
const CHECKING = /^checking\.(mp4|mov)$/;
const PUBLISHED = new Set(['video.mp4', 'video.mov']);
const CHECK_ATTEMPTS = 3;

type Fetch = typeof fetch;

/** Reads an object through a signed URL with HTTP range requests. */
export async function rangeSource(url: string, fetchFn: Fetch = fetch): Promise<ByteSource> {
  let fetched = 0;
  const get = async (offset: number, length: number) => {
    const response = await fetchFn(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
    if (response.status !== 206) {
      await response.body?.cancel();
      throw new Error(`range request returned ${response.status}`);
    }
    return response;
  };

  const probe = await get(0, 1);
  const total = Number(/\/(\d+)$/.exec(probe.headers.get('Content-Range') ?? '')?.[1]);
  await probe.body?.cancel();
  if (!Number.isSafeInteger(total)) throw new Error('range response without a total size');

  return {
    size: total,
    read: async (offset, length) => {
      const end = Math.min(offset + length, total);
      if (end <= offset) return new Uint8Array(0);
      fetched += end - offset;
      if (fetched > MAX_FETCH_BYTES) throw new Error('video check read budget exceeded');
      return new Uint8Array(await (await get(offset, end - offset)).arrayBuffer());
    },
  };
}

/**
 * Checks and publishes a pending upload. Returns whether the match has a
 * published video afterwards.
 */
export async function publishVideo(
  admin: SupabaseClient,
  ownerId: string,
  matchId: string,
  log: Logger,
  { fetchFn = fetch, retryDelayMs = 1000 }: { fetchFn?: Fetch; retryDelayMs?: number } = {},
): Promise<boolean> {
  const folder = `${ownerId}/${matchId}`;
  const storage = admin.storage.from(BUCKET);
  const { data, error } = await storage.list(folder, { limit: 20 });
  if (error) throw new Error(`listing videos failed: ${error.message}`);
  const names = (data ?? []).map((object) => object.name);
  const published = names.filter((name) => PUBLISHED.has(name));

  // A new upload replaces one left in `checking.*` by an interrupted run.
  let pending = names.find((name) => CHECKING.test(name));
  const upload = names.find((name) => UPLOADED.test(name));
  if (upload) {
    if (pending) await storage.remove([`${folder}/${pending}`]);
    pending = upload.replace('upload.', 'checking.');
    const { error: moveError } = await storage.move(`${folder}/${upload}`, `${folder}/${pending}`);
    if (moveError) throw new Error(`moving the upload failed: ${moveError.message}`);
  }
  if (!pending) return published.length > 0;

  const path = `${folder}/${pending}`;
  let result;
  for (let attempt = 1; !result; attempt++) {
    try {
      const { data: signed, error: signError } = await storage.createSignedUrl(path, 120);
      if (signError || !signed) throw new Error(`signing the upload failed: ${signError?.message ?? 'no url'}`);
      result = await checkVideoFile(await rangeSource(signed.signedUrl, fetchFn), { maxBytes: MAX_VIDEO_BYTES });
    } catch (cause) {
      log.warn('video check could not run', { attempt, error: cause });
      if (attempt >= CHECK_ATTEMPTS) {
        throw new HttpError(503, 'video_check_unavailable', 'The uploaded video could not be checked; try again');
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }

  if (!result.ok) {
    log.warn('uploaded video rejected', { reason: result.reason, detail: result.detail });
    await storage.remove([path]);
    return published.length > 0;
  }

  if (published.length > 0) await storage.remove(published.map((name) => `${folder}/${name}`));
  const { error: publishError } = await storage.move(path, `${folder}/video.${result.container}`);
  if (publishError) throw new Error(`publishing the video failed: ${publishError.message}`);
  return true;
}
