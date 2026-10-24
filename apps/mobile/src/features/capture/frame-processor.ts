/**
 * Native frame processing for gallery uploads and post-recording sampling
 * (live recording uses the frame-thread sampler, frame-thread-sampler.ts).
 *
 * All pixel work (resize, raw pixel read, JPEG encode) runs in native code on
 * background threads through react-native-nitro-image's async methods; the JS
 * thread only receives a 16-pixel-wide luminance signature and a file path.
 * Native image buffers are disposed eagerly so memory stays flat.
 */

import type { Image } from 'react-native-nitro-image';
import { type FramePruner, lumaSignature } from './frame-sampling';

/** Longest side of frames sent for analysis (keeps vision tokens low). */
export const FRAME_MAX_SIDE = 640;
export const FRAME_JPEG_QUALITY = 70;
const SIGNATURE_WIDTH = 16;

export interface SampledFrame {
  /** Milliseconds from the start of the recording. */
  t: number;
  /** file:// URI of the JPEG in the app's temporary directory. */
  uri: string;
  motion: number;
}

export function toFileUri(path: string): string {
  'worklet';
  return path.startsWith('file://') ? path : `file://${path}`;
}

export function toFilePath(uri: string): string {
  return uri.startsWith('file://') ? decodeURI(uri.slice('file://'.length)) : uri;
}

/**
 * Downscales `image`, scores it against the previous kept frame and writes a
 * JPEG only if the pruner keeps it. Always disposes `image`.
 */
export async function processFrame(image: Image, t: number, pruner: FramePruner): Promise<SampledFrame | null> {
  let scaled: Image | undefined;
  let tiny: Image | undefined;
  try {
    const scale = Math.min(1, FRAME_MAX_SIDE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    scaled = scale < 1 ? await image.resizeAsync(width, height) : image;

    tiny = await scaled.resizeAsync(SIGNATURE_WIDTH, Math.max(1, Math.round((SIGNATURE_WIDTH * height) / width)));
    const raw = await tiny.toRawPixelDataAsync();
    const signature = lumaSignature(new Uint8Array(raw.buffer), raw.width, raw.height, raw.pixelFormat);

    const { keep, motion } = pruner.shouldKeep(t, signature);
    if (!keep) return null;

    const path = await scaled.saveToTemporaryFileAsync('jpg', FRAME_JPEG_QUALITY);
    return { t: Math.round(t), uri: toFileUri(path), motion };
  } finally {
    tiny?.dispose();
    if (scaled && scaled !== image) scaled.dispose();
    image.dispose();
  }
}
