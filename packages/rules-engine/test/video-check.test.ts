import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { type ByteSource, checkVideoFile, findPersonalMetadata, isJpeg, type MetadataEdit, type VideoCheckResult } from '../src/media/index.ts';

// Fixtures are 1-second ffmpeg test patterns (see test/fixtures/README.md).
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

function source(bytes: Uint8Array): ByteSource & { reads: number } {
  const counted = {
    size: bytes.byteLength,
    reads: 0,
    read: async (offset: number, length: number) => {
      counted.reads++;
      return bytes.subarray(offset, offset + length);
    },
  };
  return counted;
}

const check = (bytes: Uint8Array, deep = true) => checkVideoFile(source(bytes), { maxBytes: 500 * 1024 * 1024, deep });

function rejected(result: VideoCheckResult) {
  assert.equal(result.ok, false);
  return result.ok ? null : result.reason;
}

interface TopBox {
  type: string;
  offset: number;
  size: number;
}

function topLevel(bytes: Uint8Array): TopBox[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes: TopBox[] = [];
  for (let offset = 0; offset < bytes.byteLength; ) {
    const size = view.getUint32(offset);
    boxes.push({ type: String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)), offset, size });
    offset += size;
  }
  return boxes;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
};

describe('checkVideoFile: genuine videos', () => {
  it('accepts H.264 + AAC MP4 and verifies every frame', async () => {
    const result = await check(fixture('h264-aac.mp4'));
    assert.deepEqual(result, { ok: true, container: 'mp4', durationMs: 1000, videoCodec: 'avc1', tracks: 2, framesChecked: 10 });
  });

  it('accepts HEVC QuickTime (iPhone-style .mov)', async () => {
    const result = await check(fixture('hevc-aac.mov'));
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.container, 'mov');
    assert.equal(result.ok && result.videoCodec, 'hvc1');
    assert.equal(result.ok && result.framesChecked, 10);
  });

  it('accepts a fast-start MP4 (moov before mdat)', async () => {
    assert.equal((await check(fixture('faststart.mp4'))).ok, true);
  });

  it('accepts QuickTime with uncompressed audio', async () => {
    assert.equal((await check(fixture('pcm-audio.mov'))).ok, true);
  });

  it('accepts a Samsung metadata trailer box', async () => {
    const trailer = new Uint8Array(64);
    new DataView(trailer.buffer).setUint32(0, 64);
    trailer.set(new TextEncoder().encode('sefd'), 4);
    assert.equal((await check(concat(fixture('h264-aac.mp4'), trailer))).ok, true);
  });

  it('reads only box headers and the movie header without deep', async () => {
    const bytes = fixture('h264-aac.mp4');
    const counted = source(bytes);
    const result = await checkVideoFile(counted, { maxBytes: 1e9 });
    assert.equal(result.ok && result.framesChecked, 0);
    assert.ok(counted.reads <= 8, `${counted.reads} reads`);
  });

  it('reports progress up to 1', async () => {
    const seen: number[] = [];
    await checkVideoFile(source(fixture('h264-aac.mp4')), { maxBytes: 1e9, deep: true, onProgress: (f) => seen.push(f) });
    assert.equal(seen.at(-1), 1);
    assert.ok(seen.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= seen[i - 1]!)));
  });

  it('stops when aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await assert.rejects(
      checkVideoFile(source(fixture('h264-aac.mp4')), { maxBytes: 1e9, deep: true, signal: controller.signal }),
      /cancelled/,
    );
  });
});

describe('checkVideoFile: everything else is refused', () => {
  const text = (value: string) => new TextEncoder().encode(value.padEnd(512, ' '));

  it('refuses other file types renamed to .mp4', async () => {
    for (const bytes of [
      text('%PDF-1.7\n1 0 obj'),
      text('<html><script>alert(1)</script></html>'),
      text('PK\x03\x04 zip archive'),
      text('MZ\x90\x00 windows executable'),
      fixture('frame.jpg'),
    ]) {
      assert.equal(rejected(await check(bytes)), 'not_a_video');
    }
  });

  it('refuses audio-only MP4 (m4a)', async () => {
    assert.equal(rejected(await check(fixture('audio.m4a'))), 'no_video_track');
  });

  it('refuses fragmented MP4', async () => {
    assert.equal(rejected(await check(fixture('fragmented.mp4'))), 'unsupported_format');
  });

  it('refuses empty and oversized files', async () => {
    assert.equal(rejected(await check(new Uint8Array(0))), 'empty');
    assert.equal(rejected(await checkVideoFile(source(fixture('h264-aac.mp4')), { maxBytes: 1000 })), 'too_large');
  });

  it('refuses a file hidden after the video (polyglot)', async () => {
    const zip = new TextEncoder().encode('PK\x03\x04 hidden archive with a payload');
    assert.equal(rejected(await check(concat(fixture('h264-aac.mp4'), zip))), 'hidden_data');
  });

  it('refuses an unknown top-level box', async () => {
    const box = new Uint8Array(64);
    new DataView(box.buffer).setUint32(0, 64);
    box.set(new TextEncoder().encode('junk'), 4);
    assert.equal(rejected(await check(concat(fixture('h264-aac.mp4'), box))), 'hidden_data');
  });

  it('refuses data hidden inside mdat that no track uses', async () => {
    const base = fixture('faststart.mp4');
    const mdat = topLevel(base).find((box) => box.type === 'mdat')!;
    assert.equal(mdat.offset + mdat.size, base.byteLength, 'fixture ends with mdat');
    const extra = 1024 * 1024;
    const grown = concat(base, new Uint8Array(extra).fill(0x41));
    new DataView(grown.buffer).setUint32(mdat.offset, mdat.size + extra);
    assert.equal(rejected(await check(grown)), 'hidden_data');
  });

  it('tolerates a little encoder padding inside mdat', async () => {
    const base = fixture('faststart.mp4');
    const mdat = topLevel(base).find((box) => box.type === 'mdat')!;
    const grown = concat(base, new Uint8Array(1000));
    new DataView(grown.buffer).setUint32(mdat.offset, mdat.size + 1000);
    assert.equal((await check(grown)).ok, true);
  });

  it('refuses a truncated file', async () => {
    const base = fixture('h264-aac.mp4');
    assert.equal(rejected(await check(base.subarray(0, base.byteLength - 100))), 'damaged');
  });

  it('refuses corrupted video frames (deep check)', async () => {
    const base = fixture('faststart.mp4');
    const mdat = topLevel(base).find((box) => box.type === 'mdat')!;
    const badHeader = base.slice();
    badHeader[mdat.offset + 8 + 4] = 0xff;
    assert.equal((await check(badHeader, false)).ok, true, 'structure alone is intact');
    assert.equal(rejected(await check(badHeader)), 'damaged');

    const badLength = base.slice();
    new DataView(badLength.buffer).setUint32(mdat.offset + 8, 0x7fffff);
    assert.equal(rejected(await check(badLength)), 'damaged');
  });

  it('refuses a file that does not start with ftyp', async () => {
    const base = fixture('h264-aac.mp4');
    const free = new Uint8Array(16);
    new DataView(free.buffer).setUint32(0, 16);
    free.set(new TextEncoder().encode('free'), 4);
    assert.equal(rejected(await check(concat(free, base))), 'not_a_video');
  });
});

/** Applies edits the way the app does: blanked boxes become `free`, ranges are zeroed. */
function applyEdits(bytes: Uint8Array, edits: MetadataEdit[]): Uint8Array {
  const out = bytes.slice();
  for (const edit of edits) {
    if (edit.box !== null) out.set(new TextEncoder().encode('free'), edit.box + 4);
    out.fill(0, edit.start, edit.end);
  }
  return out;
}

const contains = (bytes: Uint8Array, text: string | number[]) => {
  const needle = typeof text === 'string' ? new TextEncoder().encode(text) : Uint8Array.from(text);
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
};

describe('findPersonalMetadata', () => {
  it('removes Android-style GPS (3GPP loci) and keeps a valid video', async () => {
    const original = fixture('android-gps.mp4');
    assert.ok(contains(original, 'loci'));
    const edits = await findPersonalMetadata(source(original));
    assert.deepEqual(edits.map((edit) => edit.what), ['moov/udta']);
    const clean = applyEdits(original, edits);
    assert.equal(clean.byteLength, original.byteLength, 'same size, nothing moves');
    assert.ok(!contains(clean, 'loci'), 'no location box left');
    assert.deepEqual(await findPersonalMetadata(source(clean)), [], 'nothing personal left');
    assert.equal((await check(clean)).ok, true, 'still a genuine video, every frame intact');
  });

  it("removes Apple's location, make and model keys", async () => {
    const original = fixture('iphone-gps.mov');
    assert.ok(contains(original, '+51.5072'));
    const clean = applyEdits(original, await findPersonalMetadata(source(original)));
    for (const text of ['+51.5072', 'com.apple.quicktime.location', 'iPhone 17', 'Apple']) assert.ok(!contains(clean, text), text);
    assert.equal((await check(clean)).ok, true);
  });

  it('finds a metadata box directly in moov (the iPhone camera layout)', async () => {
    const bytes = fixture('iphone-gps.mov').slice();
    const udta = bytes.findIndex((_, i) => bytes[i] === 0x75 && bytes[i + 1] === 0x64 && bytes[i + 2] === 0x74 && bytes[i + 3] === 0x61);
    bytes.set(new TextEncoder().encode('meta'), udta);
    assert.deepEqual((await findPersonalMetadata(source(bytes))).map((edit) => edit.what), ['moov/meta']);
  });

  it('zeroes GPS telemetry tracks (GoPro gpmd)', async () => {
    // The fixture's audio track, relabelled as a telemetry track.
    const bytes = fixture('h264-aac.mp4').slice();
    const entry = bytes.findIndex((_, i) => contains(bytes.subarray(i, i + 4), 'mp4a'));
    bytes.set(new TextEncoder().encode('gpmd'), entry);
    const edits = await findPersonalMetadata(source(bytes));
    const telemetry = edits.filter((edit) => edit.what === 'gpmd samples');
    assert.ok(telemetry.length > 0);
    const clean = applyEdits(bytes, edits);
    for (const edit of telemetry) assert.ok(clean.subarray(edit.start, edit.end).every((byte) => byte === 0));
    assert.equal((await check(clean)).ok, true, 'the video track is untouched');
  });

  it('leaves a file without personal metadata alone', async () => {
    const bytes = applyEdits(fixture('faststart.mp4'), await findPersonalMetadata(source(fixture('faststart.mp4'))));
    assert.deepEqual(await findPersonalMetadata(source(bytes)), []);
  });
});

describe('isJpeg', () => {
  it('accepts a JPEG and refuses other bytes', () => {
    const jpeg = fixture('frame.jpg');
    assert.equal(isJpeg(jpeg), true);
    assert.equal(isJpeg(concat(jpeg, new Uint8Array(16))), true, 'zero padding after EOI');
    assert.equal(isJpeg(jpeg.subarray(0, jpeg.byteLength - 10)), false, 'truncated');
    assert.equal(isJpeg(concat(jpeg, new TextEncoder().encode('<script>'))), false, 'trailing data');
    assert.equal(isJpeg(new TextEncoder().encode('<html>'.padEnd(256))), false);
  });
});
