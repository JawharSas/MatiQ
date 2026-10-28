/**
 * Pure (platform-independent) parts of the frame pipeline, unit-tested with
 * `node --test`. Functions marked 'worklet' also run on the camera's frame
 * thread (react-native-worklets); in Node the directive is a no-op string.
 *
 *  - adaptive sampling interval (1-2 FPS, capped by a frame budget)
 *  - a tiny luminance signature per frame and a motion score between frames
 *  - a keep/prune policy that drops near-identical frames but guarantees a
 *    keyframe every few seconds
 *  - a bounded ring buffer so memory use stays flat during long rounds
 */

export interface SamplingPlan {
  /** Milliseconds between sampled frames. */
  intervalMs: number;
  /** Upper bound on frames this recording will produce. */
  maxFrames: number;
}

/**
 * Samples at `preferredFps` (1-2 FPS) unless the recording is long enough to
 * exceed the frame budget, in which case the interval is stretched evenly.
 */
export function planSampling(durationMs: number, maxFrames: number, preferredFps = 1): SamplingPlan {
  const fps = Math.min(2, Math.max(0.2, preferredFps));
  const baseInterval = 1000 / fps;
  const budgetInterval = durationMs > 0 ? durationMs / Math.max(1, maxFrames) : baseInterval;
  return { intervalMs: Math.ceil(Math.max(baseInterval, budgetInterval)), maxFrames };
}

const CHANNEL_OFFSETS: Record<string, { bytes: number; r: number; g: number; b: number }> = {
  RGBA: { bytes: 4, r: 0, g: 1, b: 2 },
  RGBX: { bytes: 4, r: 0, g: 1, b: 2 },
  BGRA: { bytes: 4, r: 2, g: 1, b: 0 },
  BGRX: { bytes: 4, r: 2, g: 1, b: 0 },
  ARGB: { bytes: 4, r: 1, g: 2, b: 3 },
  XRGB: { bytes: 4, r: 1, g: 2, b: 3 },
  ABGR: { bytes: 4, r: 3, g: 2, b: 1 },
  XBGR: { bytes: 4, r: 3, g: 2, b: 1 },
  RGB: { bytes: 3, r: 0, g: 1, b: 2 },
  BGR: { bytes: 3, r: 2, g: 1, b: 0 },
};

/**
 * Converts a tiny raw image (e.g. 16x9) into one luminance byte per pixel.
 * Row stride is derived from the buffer so padded rows are handled.
 */
export function lumaSignature(pixels: Uint8Array, width: number, height: number, pixelFormat: string): Uint8Array {
  'worklet';
  const layout = CHANNEL_OFFSETS[pixelFormat] ?? CHANNEL_OFFSETS.RGBA!;
  const stride = height > 0 ? Math.floor(pixels.byteLength / height) : 0;
  const signature = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * stride + x * layout.bytes;
      const r = pixels[i + layout.r] ?? 0;
      const g = pixels[i + layout.g] ?? 0;
      const b = pixels[i + layout.b] ?? 0;
      // Rec. 601 luma, integer math.
      signature[y * width + x] = (r * 299 + g * 587 + b * 114) / 1000;
    }
  }
  return signature;
}

/** Mean absolute luminance difference in [0, 1]. */
export function motionScore(previous: Uint8Array | null, next: Uint8Array): number {
  'worklet';
  if (!previous || previous.length !== next.length || next.length === 0) return 1;
  let total = 0;
  for (let i = 0; i < next.length; i++) total += Math.abs((next[i] ?? 0) - (previous[i] ?? 0));
  return total / (next.length * 255);
}

export interface PruneOptions {
  /** Frames whose motion score is below this are dropped... */
  motionThreshold: number;
  /** ...unless this much time has passed since the last kept frame. */
  keyframeIntervalMs: number;
}

export const DEFAULT_PRUNE: PruneOptions = { motionThreshold: 0.015, keyframeIntervalMs: 4000 };

/** Mutable pruning state; a plain object so it can live on a worklet runtime. */
export interface PruneState {
  lastSignature: Uint8Array | null;
  lastKeptT: number;
  kept: number;
  pruned: number;
}

export function createPruneState(): PruneState {
  'worklet';
  return { lastSignature: null, lastKeptT: Number.NEGATIVE_INFINITY, kept: 0, pruned: 0 };
}

/**
 * Keeps a frame when it differs enough from the last kept frame, or when no
 * frame was kept for `keyframeIntervalMs` (so static stretches still get
 * periodic coverage). Updates `state` in place.
 */
export function decidePrune(
  state: PruneState,
  t: number,
  signature: Uint8Array,
  options: PruneOptions,
): { keep: boolean; motion: number } {
  'worklet';
  const motion = motionScore(state.lastSignature, signature);
  const keep = motion >= options.motionThreshold || t - state.lastKeptT >= options.keyframeIntervalMs;
  if (keep) {
    state.lastSignature = signature;
    state.lastKeptT = t;
    state.kept++;
  } else {
    state.pruned++;
  }
  return { keep, motion };
}

/** JS-thread wrapper around decidePrune (used for gallery / post-recording sampling). */
export class FramePruner {
  private readonly options: PruneOptions;
  private readonly state: PruneState = createPruneState();

  constructor(options: PruneOptions = DEFAULT_PRUNE) {
    this.options = options;
  }

  get kept(): number {
    return this.state.kept;
  }

  get pruned(): number {
    return this.state.pruned;
  }

  shouldKeep(t: number, signature: Uint8Array): { keep: boolean; motion: number } {
    return decidePrune(this.state, t, signature, this.options);
  }
}

/**
 * Fixed-capacity FIFO. `push` returns the evicted item (if any) so callers can
 * release its resources (temp files) immediately.
 */
export class RingBuffer<T> {
  readonly capacity: number;
  private readonly items: (T | undefined)[];
  private head = 0;
  private size = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error('capacity must be a positive integer');
    this.capacity = capacity;
    this.items = new Array<T | undefined>(capacity);
  }

  get length(): number {
    return this.size;
  }

  push(item: T): T | undefined {
    const index = (this.head + this.size) % this.capacity;
    let evicted: T | undefined;
    if (this.size === this.capacity) {
      evicted = this.items[this.head];
      this.head = (this.head + 1) % this.capacity;
    } else {
      this.size++;
    }
    this.items[index] = item;
    return evicted;
  }

  /** Removes and returns up to `count` of the oldest items. */
  drain(count = this.size): T[] {
    const drained: T[] = [];
    while (drained.length < count && this.size > 0) {
      drained.push(this.items[this.head] as T);
      this.items[this.head] = undefined;
      this.head = (this.head + 1) % this.capacity;
      this.size--;
    }
    return drained;
  }
}
