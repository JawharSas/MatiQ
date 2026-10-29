/**
 * Full check of a video file before it leaves the phone: reads the whole
 * file (container structure and every video frame) with the shared checker
 * in @matiq/rules-engine/media, and removes location and device metadata.
 * The server checks the uploaded copy again before anyone can watch it.
 */

import { type ByteSource, checkVideoFile, findPersonalMetadata, type VideoCheckPassed, type VideoCheckRejected } from '@matiq/rules-engine/media';
import * as Crypto from 'expo-crypto';
import { File, FileMode, Paths } from 'expo-file-system';
import { AppError } from '@/lib/errors';

/** Same as the `match-videos` bucket limit. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

/** Runs `fn` with a read-only byte source over the file at `uri`. */
async function withSource<T>(uri: string, fn: (source: ByteSource) => Promise<T>): Promise<T> {
  const handle = new File(uri).open(FileMode.ReadOnly);
  try {
    return await fn({
      size: handle.size ?? 0,
      read: (offset, length) => {
        handle.offset = offset;
        return handle.readBytes(length);
      },
    });
  } finally {
    handle.close();
  }
}

export function scanVideo(
  uri: string,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<VideoCheckPassed | VideoCheckRejected> {
  return withSource(uri, (source) => checkVideoFile(source, { maxBytes: MAX_VIDEO_BYTES, deep: true, ...options }));
}

const FREE = Uint8Array.of(0x66, 0x72, 0x65, 0x65); // 'free'
const ZEROS = new Uint8Array(1024 * 1024);

/**
 * Phone cameras write where a video was recorded (GPS) and the phone's make
 * and model into the file, and anyone a match is shared with could read
 * them. Before upload, a copy of the video is made with those boxes blanked
 * (same sizes, so the video itself is untouched). Returns the file to upload
 * and whether it is a temporary copy to delete afterwards.
 */
export async function removePersonalMetadata(uri: string, container: 'mp4' | 'mov'): Promise<{ uri: string; temporary: boolean }> {
  const edits = await withSource(uri, findPersonalMetadata);
  if (edits.length === 0) return { uri, temporary: false };

  const copy = new File(Paths.cache, `matiq-upload-${Crypto.randomUUID()}.${container}`);
  try {
    await new File(uri).copy(copy);
  } catch {
    throw new AppError('upload_failed', "There isn't enough free space on your phone to prepare the video. Free some space, or turn off Upload video.");
  }
  const handle = copy.open(FileMode.ReadWrite);
  try {
    for (const edit of edits) {
      if (edit.box !== null) {
        handle.offset = edit.box + 4;
        await handle.writeBytes(FREE);
      }
      for (let at = edit.start; at < edit.end; at += ZEROS.byteLength) {
        handle.offset = at;
        await handle.writeBytes(ZEROS.subarray(0, Math.min(ZEROS.byteLength, edit.end - at)));
      }
    }
  } catch (error) {
    handle.close();
    copy.delete();
    throw error;
  }
  handle.close();
  return { uri: copy.uri, temporary: true };
}

export function videoRejectedMessage(result: VideoCheckRejected): string {
  switch (result.reason) {
    case 'empty':
    case 'not_a_video':
      return 'This file is not a video. Choose an MP4 or MOV video.';
    case 'too_large':
      return 'Videos must be smaller than 500 MB.';
    case 'no_video_track':
      return 'This file has no video picture. Choose a video recorded with a camera.';
    case 'encrypted':
      return 'This video is copy-protected, so it can’t be analysed.';
    case 'unsupported_format':
      return 'This video format isn’t supported. Choose a video recorded with your phone’s camera.';
    case 'damaged':
      return 'This video file is damaged or incomplete. Try another video.';
    case 'hidden_data':
      return 'This video file contains extra data that isn’t video, so it can’t be uploaded.';
  }
}

/** Throws when the file at `uri` is not a genuine video. */
export async function requireVideo(uri: string, options: Parameters<typeof scanVideo>[1] = {}): Promise<VideoCheckPassed> {
  const result = await scanVideo(uri, options);
  if (!result.ok) throw new AppError('invalid_video', videoRejectedMessage(result));
  return result;
}
