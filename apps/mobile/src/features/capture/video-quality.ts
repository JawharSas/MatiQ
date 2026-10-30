/**
 * How small an uploaded video can be without looking any different.
 *
 * Phones record sparring with generous bit rates (often 15-25 Mbit/s for
 * 1080p in H.264). Before upload the app re-encodes the video once with HEVC
 * (H.265), which needs about half the bits of H.264 for the same picture, at
 * a bit rate chosen from the picture size and frame rate. The frame rate and
 * the picture size up to 1080p stay as they were; audio is copied as is.
 *
 * The rates follow what phone cameras themselves use for HEVC (1080p30
 * about 5.5 Mbit/s, 1080p60 about 8.5), with a little headroom for fast
 * movement. Pure module so it is unit-testable in Node.
 */

export type VideoCodec = 'hevc' | 'h264';

/** Upload limit: the size limit of the `match-videos` bucket. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
/** Longest video anyone can analyse: 8 minutes. */
export const MAX_VIDEO_SECONDS = 480;
/** Largest video picked to compress (8 minutes of 4K60 is about 3 GB). */
export const MAX_SOURCE_BYTES = 4 * 1024 * 1024 * 1024;
/** Uploads are at most 1080p (short side): the size the app plays and the AI sees. */
export const MAX_SHORT_SIDE = 1080;

/** Bits per pixel per frame for 1080p HEVC at 30 FPS. */
const BITS_PER_PIXEL = 0.09;
const REFERENCE_PIXELS = 1920 * 1080;
/** H.264 needs about 1.5x the bits of HEVC for the same picture. */
const H264_FACTOR = 1.5;
/** Room left for the audio track, which is copied as is. */
export const AUDIO_ALLOWANCE = 192_000;
/** Encoders overshoot their target a little; stay this far under the limit. */
const SIZE_MARGIN = 0.85;
/** A file within this much of the target is already compact. */
const ALREADY_SMALL = 1.15;

/**
 * Video bit rate that keeps a picture of this size and frame rate
 * visually the same. Smaller pictures need a little more per pixel, and
 * each extra frame adds less than the one before (consecutive frames are
 * more alike at 60 FPS than at 30).
 */
export function qualityBitRate({ width, height, fps, codec }: { width: number; height: number; fps: number; codec: VideoCodec }): number {
  const pixels = Math.max(width * height, 1);
  const bitsPerPixel = BITS_PER_PIXEL * (REFERENCE_PIXELS / pixels) ** 0.25;
  const frames = 30 * (Math.min(Math.max(fps, 1), 240) / 30) ** 0.6;
  const rate = pixels * bitsPerPixel * frames * (codec === 'h264' ? H264_FACTOR : 1);
  return Math.round(rate / 1000) * 1000;
}

/** Highest video bit rate that keeps a video of this length under the upload limit. */
export function budgetBitRate(durationMs: number, maxBytes = MAX_VIDEO_BYTES): number {
  const seconds = Math.max(durationMs / 1000, 1);
  return Math.floor(((maxBytes * 8 * SIZE_MARGIN) / seconds - AUDIO_ALLOWANCE) / 1000) * 1000;
}

export interface SourceVideo {
  /** Coded picture size (either orientation). */
  width: number;
  height: number;
  fps: number | null;
  durationMs: number;
  sizeBytes: number;
}

export type CompressionPlan =
  | { compress: false }
  | {
      compress: true;
      codec: VideoCodec;
      /** Video bits per second. */
      bitRate: number;
      /** Short side of the output picture (the long side keeps the aspect ratio). */
      shortSide: number;
    };

/**
 * Whether a video should be re-encoded before upload, and how. A video that
 * is already about as compact as the target (an iPhone's own HEVC, or one
 * compressed before) is uploaded as it is: encoding it again would only
 * lose detail.
 */
export function planCompression(source: SourceVideo, { codec, maxBytes = MAX_VIDEO_BYTES }: { codec: VideoCodec; maxBytes?: number }): CompressionPlan {
  const sourceShort = Math.min(source.width, source.height);
  const known = sourceShort > 0;
  const shortSide = known ? Math.min(sourceShort, MAX_SHORT_SIDE) : MAX_SHORT_SIDE;
  const scale = known ? shortSide / sourceShort : 1;
  const width = known ? source.width * scale : 1920;
  const height = known ? source.height * scale : 1080;
  const fps = source.fps && source.fps > 0 ? source.fps : 30;

  const bitRate = Math.min(qualityBitRate({ width, height, fps, codec }), budgetBitRate(source.durationMs, maxBytes));
  const sourceBitRate = (source.sizeBytes * 8) / Math.max(source.durationMs / 1000, 1);
  if (source.sizeBytes <= maxBytes && sourceBitRate <= (bitRate + AUDIO_ALLOWANCE) * ALREADY_SMALL) return { compress: false };
  // Even sizes: video encoders work in 2x2 blocks.
  return { compress: true, codec, bitRate, shortSide: shortSide - (shortSide % 2) };
}

/**
 * Bit rate for recording in the app. iOS records HEVC straight away, so it
 * records at the upload rate (within the size limit for the longest
 * recording) and nothing is encoded twice. Android records H.264, so it
 * records a high-quality copy that is compressed to HEVC once, before upload.
 */
export function recordingBitRate({ fps, maxDurationMs, recordsHevc }: { fps: number; maxDurationMs: number; recordsHevc: boolean }): number {
  if (recordsHevc) {
    return Math.min(qualityBitRate({ width: 1920, height: 1080, fps, codec: 'hevc' }), budgetBitRate(maxDurationMs));
  }
  return Math.round(qualityBitRate({ width: 1920, height: 1080, fps, codec: 'h264' }) * 1.5);
}

/** Whether a compressed copy is worth uploading instead of the original. */
export function keepCompressed({ originalBytes, compressedBytes, maxBytes = MAX_VIDEO_BYTES }: { originalBytes: number; compressedBytes: number; maxBytes?: number }): boolean {
  if (originalBytes > maxBytes) return true;
  return compressedBytes < originalBytes * 0.9;
}
