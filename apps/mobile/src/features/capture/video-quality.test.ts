import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  budgetBitRate,
  fallbackPlan,
  keepCompressed,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  planCompression,
  qualityBitRate,
  recordingBitRate,
} from './video-quality.ts';

const MBIT = 1_000_000;
const minutes = (n: number) => n * 60_000;
/** File size of a video at a total bit rate. */
const sized = (bitRate: number, durationMs: number) => Math.round((bitRate * durationMs) / 1000 / 8);

describe('qualityBitRate', () => {
  it('matches what phone cameras use for HEVC', () => {
    const p30 = qualityBitRate({ width: 1920, height: 1080, fps: 30, codec: 'hevc' });
    const p60 = qualityBitRate({ width: 1920, height: 1080, fps: 60, codec: 'hevc' });
    assert.ok(p30 >= 5 * MBIT && p30 <= 6 * MBIT, `${p30}`);
    assert.ok(p60 >= 8 * MBIT && p60 <= 9 * MBIT, `${p60}`);
  });

  it('is the same for portrait and landscape', () => {
    assert.equal(
      qualityBitRate({ width: 1080, height: 1920, fps: 30, codec: 'hevc' }),
      qualityBitRate({ width: 1920, height: 1080, fps: 30, codec: 'hevc' }),
    );
  });

  it('gives H.264 half as much again', () => {
    const hevc = qualityBitRate({ width: 1920, height: 1080, fps: 30, codec: 'hevc' });
    const h264 = qualityBitRate({ width: 1920, height: 1080, fps: 30, codec: 'h264' });
    assert.ok(Math.abs(h264 - hevc * 1.5) <= 1000);
  });

  it('gives smaller pictures a little more per pixel', () => {
    const p1080 = qualityBitRate({ width: 1920, height: 1080, fps: 30, codec: 'hevc' }) / (1920 * 1080);
    const p720 = qualityBitRate({ width: 1280, height: 720, fps: 30, codec: 'hevc' }) / (1280 * 720);
    assert.ok(p720 > p1080);
  });
});

describe('budgetBitRate', () => {
  it('keeps 8 minutes under the upload limit, audio included', () => {
    const video = budgetBitRate(minutes(8));
    const bytes = sized(video + 192_000, minutes(8));
    assert.ok(bytes < MAX_VIDEO_BYTES * 0.9, `${bytes}`);
    assert.ok(video > 7 * MBIT, `${video}`);
  });
});

describe('planCompression', () => {
  const phone1080p30 = { width: 1920, height: 1080, fps: 30, durationMs: minutes(5), sizeBytes: sized(17 * MBIT, minutes(5)) };

  it('compresses a typical Android recording to HEVC and keeps size and frame rate', () => {
    const plan = planCompression(phone1080p30, { codec: 'hevc' });
    assert.ok(plan.compress);
    assert.equal(plan.codec, 'hevc');
    assert.equal(plan.shortSide, 1080);
    assert.ok(plan.bitRate < 6 * MBIT, `${plan.bitRate}`);
  });

  it('makes it about three times smaller', () => {
    const plan = planCompression(phone1080p30, { codec: 'hevc' });
    assert.ok(plan.compress);
    const after = sized(plan.bitRate + 192_000, phone1080p30.durationMs);
    assert.ok(after < phone1080p30.sizeBytes / 2.5, `${after} vs ${phone1080p30.sizeBytes}`);
  });

  it('leaves a video that is already compact alone (an iPhone HEVC clip)', () => {
    const iphone = { width: 1920, height: 1080, fps: 30, durationMs: minutes(3), sizeBytes: sized(6 * MBIT, minutes(3)) };
    assert.deepEqual(planCompression(iphone, { codec: 'hevc' }), { compress: false });
  });

  it('brings 4K down to 1080p and keeps 60 FPS within the limit for 8 minutes', () => {
    const uhd = { width: 3840, height: 2160, fps: 60, durationMs: minutes(8), sizeBytes: 3 * 1024 ** 3 };
    const plan = planCompression(uhd, { codec: 'hevc' });
    assert.ok(plan.compress);
    assert.equal(plan.shortSide, 1080);
    assert.ok(sized(plan.bitRate + 192_000, uhd.durationMs) < MAX_VIDEO_BYTES);
  });

  it('keeps portrait video portrait (only the short side is given)', () => {
    const portrait = { ...phone1080p30, width: 2160, height: 3840 };
    const plan = planCompression(portrait, { codec: 'hevc' });
    assert.ok(plan.compress);
    assert.equal(plan.shortSide, 1080);
  });

  it('uses a higher rate when the phone has no HEVC encoder', () => {
    const hevc = planCompression(phone1080p30, { codec: 'hevc' });
    const h264 = planCompression(phone1080p30, { codec: 'h264' });
    assert.ok(hevc.compress && h264.compress);
    assert.equal(h264.codec, 'h264');
    assert.ok(h264.bitRate > hevc.bitRate);
  });

  it('compresses anything over the upload limit, however efficient', () => {
    const big = { width: 1920, height: 1080, fps: 30, durationMs: minutes(8), sizeBytes: MAX_VIDEO_BYTES + 1 };
    assert.equal(planCompression(big, { codec: 'hevc' }).compress, true);
  });

  it('assumes 1080p30 when the file does not say', () => {
    const plan = planCompression({ width: 0, height: 0, fps: null, durationMs: minutes(2), sizeBytes: sized(20 * MBIT, minutes(2)) }, { codec: 'hevc' });
    assert.ok(plan.compress);
    assert.equal(plan.shortSide, 1080);
    assert.equal(plan.bitRate, qualityBitRate({ width: 1920, height: 1080, fps: 30, codec: 'hevc' }));
  });

  it('keeps sizes even', () => {
    const odd = { ...phone1080p30, width: 1279, height: 719 };
    const plan = planCompression(odd, { codec: 'hevc' });
    assert.ok(plan.compress);
    assert.equal(plan.shortSide % 2, 0);
  });
});

describe('recordingBitRate', () => {
  const longest = MAX_VIDEO_SECONDS * 1000;

  it('records HEVC at the upload rate, so the file is uploaded as recorded', () => {
    for (const fps of [30, 60]) {
      const rate = recordingBitRate({ fps, maxDurationMs: longest, recordsHevc: true });
      const recorded = { width: 1920, height: 1080, fps, durationMs: longest, sizeBytes: sized(rate + 128_000, longest) };
      assert.deepEqual(planCompression(recorded, { codec: 'hevc' }), { compress: false }, `${fps} FPS`);
    }
  });

  it('records H.264 well above the upload rate, so the one HEVC encode starts from a clean copy', () => {
    const rate = recordingBitRate({ fps: 60, maxDurationMs: longest, recordsHevc: false });
    assert.ok(rate > qualityBitRate({ width: 1920, height: 1080, fps: 60, codec: 'h264' }));
  });
});

describe('keepCompressed', () => {
  it('keeps the compressed copy only when it saves something', () => {
    assert.equal(keepCompressed({ originalBytes: 100, compressedBytes: 50 }), true);
    assert.equal(keepCompressed({ originalBytes: 100, compressedBytes: 95 }), false);
  });

  it('always keeps it when the original is over the limit', () => {
    assert.equal(keepCompressed({ originalBytes: MAX_VIDEO_BYTES + 1, compressedBytes: MAX_VIDEO_BYTES }), true);
  });

  it('never keeps a copy that is still over the limit', () => {
    assert.equal(keepCompressed({ originalBytes: 3 * MAX_VIDEO_BYTES, compressedBytes: MAX_VIDEO_BYTES + 1 }), false);
  });
});

describe('fallbackPlan', () => {
  const eight = minutes(8);

  it('drops to 720p within the size budget', () => {
    const first = planCompression({ width: 3840, height: 2160, fps: 60, durationMs: eight, sizeBytes: 3 * 1024 ** 3 }, { codec: 'hevc' });
    assert.ok(first.compress);
    const fallback = fallbackPlan(first, { codec: 'h264', durationMs: eight });
    assert.ok(fallback);
    assert.equal(fallback.shortSide, 720);
    assert.equal(fallback.codec, 'h264');
    assert.ok(sized(fallback.bitRate + 192_000, eight) < MAX_VIDEO_BYTES);
  });

  it('has nothing smaller to offer for a 720p plan', () => {
    const first = planCompression({ width: 1280, height: 720, fps: 30, durationMs: eight, sizeBytes: MAX_VIDEO_BYTES + 1 }, { codec: 'hevc' });
    assert.ok(first.compress);
    assert.equal(fallbackPlan(first, { codec: 'hevc', durationMs: eight }), null);
  });
});
