/**
 * JavaScript side of the local `VideoCompressor` native module
 * (android/: AndroidX Media3 Transformer, ios/: AVFoundation): re-encodes a
 * video once with the phone's hardware encoder.
 *
 * The module is missing on the web preview and in builds made before it
 * existed; `encoders()` is then empty and nothing is compressed.
 */

import { type EventSubscription, requireOptionalNativeModule } from 'expo';

export type Codec = 'hevc' | 'h264';

export interface CompressRequest {
  /** file:// URI of the compressed MP4 to write. */
  output: string;
  codec: Codec;
  /** Video bits per second (Android follows it; iOS uses its preset's rate). */
  bitRate: number;
  /** Short side of the output picture. */
  shortSide: number;
}

export interface CompressResult {
  uri: string;
  sizeBytes: number;
  codec: Codec;
}

interface NativeVideoCompressor {
  encoders(): Codec[];
  compress(source: string, options: CompressRequest & { id: string }): Promise<CompressResult>;
  cancel(id: string): Promise<unknown>;
  addListener(event: 'onProgress', listener: (event: { id: string; progress: number }) => void): EventSubscription;
}

const native = requireOptionalNativeModule<NativeVideoCompressor>('VideoCompressor');

let jobs = 0;

/** Codecs this phone can encode, most efficient first (empty: no compression). */
export function encoders(): Codec[] {
  try {
    return native?.encoders() ?? [];
  } catch {
    return [];
  }
}

/** Compresses `source` (a file:// URI). Rejects when aborted or when the phone can't encode it. */
export async function compress(
  source: string,
  request: CompressRequest,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<CompressResult> {
  if (!native) throw new Error('Video compression is not available in this build');
  if (signal?.aborted) throw new DOMException('Video compression cancelled', 'AbortError');
  const id = `compress-${Date.now()}-${++jobs}`;
  const progress = native.addListener('onProgress', (event) => {
    if (event.id === id) onProgress?.(Math.min(Math.max(event.progress, 0), 1));
  });
  const abort = () => void native.cancel(id).catch(() => undefined);
  signal?.addEventListener('abort', abort);
  try {
    const result = await native.compress(source, { ...request, id });
    onProgress?.(1);
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    progress.remove();
  }
}
