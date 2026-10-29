/**
 * Full check of a video file before it leaves the phone: reads the whole
 * file (container structure and every video frame) with the shared checker
 * in @matiq/rules-engine/media. The server checks the uploaded copy again
 * before anyone can watch it.
 */

import { checkVideoFile, type VideoCheckPassed, type VideoCheckRejected } from '@matiq/rules-engine/media';
import { File, FileMode } from 'expo-file-system';
import { AppError } from '@/lib/errors';

/** Same as the `match-videos` bucket limit. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export async function scanVideo(
  uri: string,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<VideoCheckPassed | VideoCheckRejected> {
  const handle = new File(uri).open(FileMode.ReadOnly);
  try {
    const size = handle.size ?? 0;
    return await checkVideoFile(
      {
        size,
        read: (offset, length) => {
          handle.offset = offset;
          return handle.readBytes(length);
        },
      },
      { maxBytes: MAX_VIDEO_BYTES, deep: true, ...options },
    );
  } finally {
    handle.close();
  }
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
