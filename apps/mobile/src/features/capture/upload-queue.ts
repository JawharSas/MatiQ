/**
 * Bounded, progressive frame uploader.
 *
 * Frames are uploaded in small batches *while* recording continues, so most
 * of the work is done by the time the user taps Stop. The pending queue is a
 * ring buffer: if the network falls far behind, the oldest pending frame is
 * dropped (and its temp file deleted) instead of letting disk and memory grow
 * without bound. `pressure` lets the sampler slow down before that happens.
 */

import { type SampledFrame } from './frame-processor';
import { RingBuffer } from './frame-sampling';
import { deleteLocalFile } from './match-session';

export interface UploadQueueStats {
  uploaded: number;
  pending: number;
  dropped: number;
  failed: number;
}

export class FrameUploadQueue {
  private readonly buffer: RingBuffer<SampledFrame>;
  private readonly upload: (frame: SampledFrame) => Promise<void>;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private failed: SampledFrame[] = [];
  private pumping: Promise<void> | null = null;
  private uploaded = 0;
  private dropped = 0;

  constructor(upload: (frame: SampledFrame) => Promise<void>, { capacity = 120, batchSize = 8, concurrency = 3 } = {}) {
    this.upload = upload;
    this.buffer = new RingBuffer<SampledFrame>(capacity);
    this.batchSize = batchSize;
    this.concurrency = concurrency;
  }

  /** 0 (idle) .. 1 (full). */
  get pressure(): number {
    return this.buffer.length / this.buffer.capacity;
  }

  get stats(): UploadQueueStats {
    return { uploaded: this.uploaded, pending: this.buffer.length, dropped: this.dropped, failed: this.failed.length };
  }

  enqueue(frame: SampledFrame): void {
    const evicted = this.buffer.push(frame);
    if (evicted) {
      this.dropped++;
      deleteLocalFile(evicted.uri);
    }
    this.pump();
  }

  /** Uploads everything pending, retrying failed frames once. */
  async flush(): Promise<UploadQueueStats> {
    await this.pump();
    if (this.failed.length > 0) {
      const retry = this.failed;
      this.failed = [];
      for (const frame of retry) this.buffer.push(frame);
      await this.pump();
    }
    return this.stats;
  }

  /** Drops everything pending and deletes the temp files. */
  clear(): void {
    for (const frame of [...this.buffer.drain(), ...this.failed]) deleteLocalFile(frame.uri);
    this.failed = [];
  }

  private pump(): Promise<void> {
    this.pumping ??= (async () => {
      try {
        while (this.buffer.length > 0) {
          const batch = this.buffer.drain(this.batchSize);
          let next = 0;
          const workers = Array.from({ length: Math.min(this.concurrency, batch.length) }, async () => {
            while (next < batch.length) {
              const frame = batch[next++] as SampledFrame;
              try {
                await this.upload(frame);
                this.uploaded++;
              } catch {
                this.failed.push(frame);
              }
            }
          });
          await Promise.all(workers);
        }
      } finally {
        this.pumping = null;
      }
    })();
    return this.pumping;
  }
}
