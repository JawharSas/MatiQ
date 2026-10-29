/**
 * Video file check, shared by the app (before a video is uploaded) and the
 * analyze-match function (before an uploaded video is published).
 *
 * MP4 and QuickTime files are trees of "boxes" (ISO/IEC 14496-12, QuickTime
 * File Format). A file passes only when:
 *
 *   - it starts with an `ftyp` box naming an MP4 or QuickTime brand;
 *   - its top-level boxes are known container boxes that tile the file
 *     exactly: nothing before, between or after them;
 *   - `moov` describes at least one video track with a known codec, no
 *     encrypted tracks and no media stored in other files;
 *   - every chunk of every track lies inside `mdat`, chunks don't overlap,
 *     and almost every byte of `mdat` belongs to a chunk, so nothing can be
 *     hidden inside the media data;
 *   - with `deep`, every H.264 / HEVC frame is read and its NAL units add up
 *     exactly to the frame's size (this reads the whole video stream).
 *
 * Fragmented MP4 (streaming segments) is not accepted; phone cameras and
 * gallery exports don't produce it.
 */

/** Random-access reader over the file being checked. */
export interface ByteSource {
  readonly size: number;
  /** Reads `length` bytes at `offset` (fewer only at the end of the file). */
  read(offset: number, length: number): Promise<Uint8Array>;
}

export type VideoCheckFailure =
  | 'empty'
  | 'too_large'
  | 'not_a_video'
  | 'unsupported_format'
  | 'no_video_track'
  | 'encrypted'
  | 'damaged'
  | 'hidden_data';

export interface VideoCheckPassed {
  ok: true;
  container: 'mp4' | 'mov';
  /** `moov` duration, when the file states one. */
  durationMs: number | null;
  videoCodec: string;
  tracks: number;
  /** Video frames whose NAL structure was verified (deep checks only). */
  framesChecked: number;
}

export interface VideoCheckRejected {
  ok: false;
  reason: VideoCheckFailure;
  detail: string;
}

export type VideoCheckResult = VideoCheckPassed | VideoCheckRejected;

export interface VideoCheckOptions {
  maxBytes: number;
  /** Read and verify every video frame, not just the file structure. */
  deep?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const MAX_TOP_LEVEL_BOXES = 64;
const MAX_MOOV_BYTES = 32 * 1024 * 1024;
/** Padding and metadata boxes (`free`, `skip`, `wide`, `uuid`, `meta`, ...) in total. */
const MAX_SIDE_BYTES = 16 * 1024 * 1024;
const MAX_TRACKS = 16;
const MAX_CHUNKS = 2_000_000;
/** Bytes of `mdat` no chunk refers to (encoder alignment padding). */
const MAX_UNREFERENCED_BYTES = (mdatBytes: number) => Math.min(4 * 1024 * 1024, Math.max(256 * 1024, mdatBytes / 100));
const READ_WINDOW = 4 * 1024 * 1024;

const MP4_BRANDS = new Set([
  'isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'iso7', 'iso8', 'iso9', 'mp41', 'mp42', 'mp71', 'avc1', 'hvc1', 'hev1',
  'M4V ', 'M4VH', 'M4VP', 'MSNV', 'XAVC', 'mmp4', '3gp4', '3gp5', '3gp6', '3gp7', '3gp9', '3g2a', '3g2b', '3g2c', 'f4v ',
  'av01', 'dby1', 'MiPr', 'CAEP', 'caqv', 'NDAS', 'ndas',
]);
/** Padding and metadata boxes; `sefd` is the trailer Samsung phones add. */
const SIDE_BOXES = new Set(['free', 'skip', 'wide', 'uuid', 'meta', 'pnot', 'PICT', 'sefd']);
const TOP_LEVEL_BOXES = new Set(['ftyp', 'moov', 'mdat', ...SIDE_BOXES]);
const FRAGMENT_BOXES = new Set(['moof', 'mfra', 'sidx', 'ssix', 'styp', 'emsg', 'prft']);
const HANDLERS = new Set(['vide', 'soun', 'meta', 'mdta', 'tmcd', 'text', 'sbtl', 'subt', 'clcp', 'hint', 'auxv', 'sdsm', 'odsm']);
const VIDEO_CODECS = new Set([
  'avc1', 'avc3', 'hvc1', 'hev1', 'dvh1', 'dvhe', 'dva1', 'dvav', 'mp4v', 'vp08', 'vp09', 'av01', 'apch', 'apcn', 'apcs',
  'apco', 'ap4h', 'ap4x', 'jpeg', 'mjpa', 'mjpb', 's263', 'h263',
]);
const ENCRYPTED_ENTRIES = new Set(['encv', 'enca', 'enct', 'encs', 'drms', 'drmi', 'drac']);
/** Codecs whose frames are length-prefixed NAL units, with their config box. */
const NAL_CODECS: Record<string, 'avcC' | 'hvcC'> = {
  avc1: 'avcC', avc3: 'avcC', dva1: 'avcC', dvav: 'avcC',
  hvc1: 'hvcC', hev1: 'hvcC', dvh1: 'hvcC', dvhe: 'hvcC',
};

class Reject extends Error {
  readonly reason: VideoCheckFailure;

  constructor(reason: VideoCheckFailure, detail: string) {
    super(detail);
    this.reason = reason;
  }
}

const fourcc = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
const u16 = (view: DataView, at: number) => view.getUint16(at);
const u32 = (view: DataView, at: number) => view.getUint32(at);
const u64 = (view: DataView, at: number) => view.getUint32(at) * 2 ** 32 + view.getUint32(at + 4);
const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

interface Box {
  type: string;
  /** Absolute offset of the box (header included). */
  start: number;
  /** Absolute offset of the payload. */
  body: number;
  end: number;
}

/** Child boxes of an in-memory payload `[from, to)` of `bytes`, which starts at absolute offset `base`. */
function childBoxes(bytes: Uint8Array, from: number, to: number, base: number): Box[] {
  const view = viewOf(bytes);
  const boxes: Box[] = [];
  let at = from;
  while (at < to) {
    if (to - at < 8) throw new Reject('damaged', 'truncated box header');
    let size = u32(view, at);
    const type = fourcc(bytes, at + 4);
    let header = 8;
    if (size === 1) {
      if (to - at < 16) throw new Reject('damaged', 'truncated box header');
      size = u64(view, at + 8);
      header = 16;
    } else if (size === 0) {
      size = to - at;
    }
    if (type === 'uuid') header += 16;
    if (size < header || at + size > to) throw new Reject('damaged', `box ${JSON.stringify(type)} overruns its parent`);
    boxes.push({ type, start: base + at, body: base + at + header, end: base + at + size });
    at += size;
  }
  return boxes;
}

interface Track {
  handler: string;
  codec: string;
  /** Length of a NAL unit's size prefix, for H.264 / HEVC tracks. */
  nalLengthSize: number | null;
  /** Byte ranges of the track's chunks, in file order. */
  chunks: { start: number; end: number }[];
  /** Per-sample sizes, kept only for NAL tracks with a deep check. */
  sampleSizes: Uint32Array | null;
  samplesPerChunk: Uint32Array | null;
}

/** Parses `moov` (held in memory) into tracks with absolute chunk ranges. */
function parseMoov(moov: Uint8Array, moovBody: number, keepSamples: boolean): { tracks: Track[]; durationMs: number | null } {
  const view = viewOf(moov);
  const rel = (box: Box) => ({ from: box.body - moovBody, to: box.end - moovBody });
  const children = (box: Box) => {
    const { from, to } = rel(box);
    return childBoxes(moov, from, to, moovBody);
  };
  const find = (boxes: Box[], type: string) => boxes.find((box) => box.type === type);
  const need = (boxes: Box[], type: string, where: string) => {
    const box = find(boxes, type);
    if (!box) throw new Reject('damaged', `${where} has no ${type}`);
    return box;
  };

  const top = childBoxes(moov, 0, moov.byteLength, moovBody);
  if (find(top, 'mvex')) throw new Reject('unsupported_format', 'fragmented MP4');
  if (find(top, 'cmov')) throw new Reject('unsupported_format', 'compressed movie header');

  let durationMs: number | null = null;
  const mvhd = find(top, 'mvhd');
  if (mvhd) {
    const at = rel(mvhd).from;
    const version = moov[at]!;
    const timescale = version === 1 ? u32(view, at + 20) : u32(view, at + 12);
    const duration = version === 1 ? u64(view, at + 24) : u32(view, at + 16);
    if (timescale > 0 && duration > 0 && duration !== 0xffffffff) durationMs = Math.round((duration / timescale) * 1000);
  }

  const traks = top.filter((box) => box.type === 'trak');
  if (traks.length > MAX_TRACKS) throw new Reject('unsupported_format', 'too many tracks');
  const tracks: Track[] = [];
  let totalChunks = 0;

  for (const trak of traks) {
    const mdia = need(children(trak), 'mdia', 'trak');
    const mdiaChildren = children(mdia);
    const hdlr = rel(need(mdiaChildren, 'hdlr', 'mdia'));
    if (hdlr.to - hdlr.from < 12) throw new Reject('damaged', 'short hdlr');
    const handler = fourcc(moov, hdlr.from + 8);
    if (!HANDLERS.has(handler)) throw new Reject('unsupported_format', `track type ${JSON.stringify(handler)}`);
    const minf = need(mdiaChildren, 'minf', 'mdia');
    const minfChildren = children(minf);

    // Media must be inside this file (self-contained data references).
    const dinf = find(minfChildren, 'dinf');
    const dref = dinf ? find(children(dinf), 'dref') : undefined;
    if (dref) {
      const { from } = rel(dref);
      for (const entry of childBoxes(moov, from + 8, rel(dref).to, moovBody)) {
        const flags = u32(view, entry.body - moovBody) & 0xffffff;
        if ((flags & 1) === 0) throw new Reject('unsupported_format', 'media stored in another file');
      }
    }

    const stbl = children(need(minfChildren, 'stbl', 'minf'));
    const stsd = rel(need(stbl, 'stsd', 'stbl'));
    const entries = childBoxes(moov, stsd.from + 8, stsd.to, moovBody);
    const entry = entries[0];
    if (!entry) throw new Reject('damaged', 'track without a sample description');
    for (const candidate of entries) {
      if (ENCRYPTED_ENTRIES.has(candidate.type)) throw new Reject('encrypted', 'encrypted track');
    }
    const codec = entry.type;

    let nalLengthSize: number | null = null;
    const configType = handler === 'vide' ? NAL_CODECS[codec] : undefined;
    if (configType) {
      // VisualSampleEntry: 78 bytes of fields before its child boxes.
      const fieldsEnd = entry.body - moovBody + 78;
      if (fieldsEnd > entry.end - moovBody) throw new Reject('damaged', 'short video sample description');
      const config = find(childBoxes(moov, fieldsEnd, entry.end - moovBody, moovBody), configType);
      if (!config) throw new Reject('damaged', `${codec} without ${configType}`);
      const at = config.body - moovBody;
      const byteIndex = configType === 'avcC' ? 4 : 21;
      if (config.end - config.body <= byteIndex) throw new Reject('damaged', `short ${configType}`);
      nalLengthSize = (moov[at + byteIndex]! & 0x03) + 1;
      if (nalLengthSize === 3) throw new Reject('damaged', 'invalid NAL length size');
    }

    // Sample sizes.
    let constantSize = 0;
    let sampleCount = 0;
    let sizes: Uint32Array | null = null;
    const stsz = find(stbl, 'stsz');
    const stz2 = find(stbl, 'stz2');
    if (stsz) {
      const at = rel(stsz).from;
      constantSize = u32(view, at + 4);
      sampleCount = u32(view, at + 8);
      if (constantSize === 0) {
        if (rel(stsz).to - (at + 12) < sampleCount * 4) throw new Reject('damaged', 'short stsz');
        sizes = new Uint32Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) sizes[i] = u32(view, at + 12 + i * 4);
      }
    } else if (stz2) {
      const at = rel(stz2).from;
      const fieldSize = moov[at + 7]!;
      sampleCount = u32(view, at + 8);
      if (![4, 8, 16].includes(fieldSize)) throw new Reject('damaged', 'invalid stz2 field size');
      if ((rel(stz2).to - (at + 12)) * 8 < sampleCount * fieldSize) throw new Reject('damaged', 'short stz2');
      sizes = new Uint32Array(sampleCount);
      for (let i = 0; i < sampleCount; i++) {
        if (fieldSize === 16) sizes[i] = u16(view, at + 12 + i * 2);
        else if (fieldSize === 8) sizes[i] = moov[at + 12 + i]!;
        else sizes[i] = (moov[at + 12 + (i >> 1)]! >> (i % 2 === 0 ? 4 : 0)) & 0x0f;
      }
    } else {
      throw new Reject('damaged', 'track without sample sizes');
    }

    // Chunk offsets.
    const stco = find(stbl, 'stco');
    const co64 = find(stbl, 'co64');
    const offsetsBox = stco ?? co64;
    if (!offsetsBox) throw new Reject('damaged', 'track without chunk offsets');
    const offsetsAt = rel(offsetsBox).from;
    const chunkCount = u32(view, offsetsAt + 4);
    const width = stco ? 4 : 8;
    if (rel(offsetsBox).to - (offsetsAt + 8) < chunkCount * width) throw new Reject('damaged', 'short chunk offset table');
    totalChunks += chunkCount;
    if (totalChunks > MAX_CHUNKS) throw new Reject('unsupported_format', 'too many chunks');

    // Samples per chunk (runs).
    const stscBox = rel(need(stbl, 'stsc', 'stbl'));
    const runCount = u32(view, stscBox.from + 4);
    if (stscBox.to - (stscBox.from + 8) < runCount * 12) throw new Reject('damaged', 'short stsc');
    const perChunk = new Uint32Array(chunkCount);
    for (let run = 0; run < runCount; run++) {
      const first = u32(view, stscBox.from + 8 + run * 12);
      const count = u32(view, stscBox.from + 12 + run * 12);
      const next = run + 1 < runCount ? u32(view, stscBox.from + 8 + (run + 1) * 12) : chunkCount + 1;
      if (first < 1 || next <= first) throw new Reject('damaged', 'invalid stsc');
      for (let chunk = first; chunk < next && chunk <= chunkCount; chunk++) perChunk[chunk - 1] = count;
      if (next > chunkCount) break;
    }

    // Uncompressed QuickTime audio can state a size of 1 per sample (legacy
    // "sample = one frame" tables); the real chunk length then depends on the
    // sound description, so such chunks only have to start inside mdat.
    const openEnded = handler === 'soun' && constantSize === 1;
    const chunks: { start: number; end: number }[] = new Array(chunkCount);
    let sample = 0;
    for (let chunk = 0; chunk < chunkCount; chunk++) {
      const offset = width === 4 ? u32(view, offsetsAt + 8 + chunk * 4) : u64(view, offsetsAt + 8 + chunk * 8);
      const count = perChunk[chunk]!;
      let bytes = 0;
      if (sizes) {
        if (sample + count > sizes.length) throw new Reject('damaged', 'chunk table lists more samples than the track has');
        for (let i = 0; i < count; i++) bytes += sizes[sample + i]!;
      } else if (!openEnded) {
        bytes = count * constantSize;
      }
      sample += count;
      chunks[chunk] = { start: offset, end: openEnded ? -1 : offset + bytes };
    }
    if (sample !== sampleCount) throw new Reject('damaged', 'chunk table and sample count disagree');

    const deepNal = keepSamples && nalLengthSize !== null;
    tracks.push({
      handler,
      codec,
      nalLengthSize,
      chunks,
      sampleSizes: deepNal ? (sizes ?? new Uint32Array(sampleCount).fill(constantSize)) : null,
      samplesPerChunk: deepNal ? perChunk : null,
    });
  }

  return { tracks, durationMs };
}

function checkAbort(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw signal.reason ?? new Error('aborted');
}

async function readExactly(source: ByteSource, offset: number, length: number): Promise<Uint8Array> {
  const bytes = await source.read(offset, length);
  if (bytes.byteLength !== length) throw new Reject('damaged', 'file ends early');
  return bytes;
}

/** Sequential read-ahead window used by the deep frame check. */
class Window {
  private readonly source: ByteSource;
  private start = 0;
  private bytes: Uint8Array = new Uint8Array(0);

  constructor(source: ByteSource) {
    this.source = source;
  }

  has(offset: number, length: number) {
    return offset >= this.start && offset + length <= this.start + this.bytes.byteLength;
  }

  async load(offset: number, length: number) {
    this.bytes = await readExactly(this.source, offset, Math.min(Math.max(length, READ_WINDOW), this.source.size - offset));
    this.start = offset;
  }

  byte(offset: number) {
    return this.bytes[offset - this.start]!;
  }
}

/** Verifies the NAL units of every frame of an H.264 / HEVC track. */
async function checkFrames(track: Track, window: Window, onChunk: () => void, signal?: AbortSignal): Promise<number> {
  const lengthSize = track.nalLengthSize!;
  const sizes = track.sampleSizes!;
  const perChunk = track.samplesPerChunk!;
  let sample = 0;
  for (let chunk = 0; chunk < track.chunks.length; chunk++) {
    checkAbort(signal);
    let offset = track.chunks[chunk]!.start;
    onChunk();
    for (let i = 0; i < perChunk[chunk]!; i++, sample++) {
      const size = sizes[sample]!;
      if (size === 0) throw new Reject('damaged', 'empty video frame');
      let at = 0;
      while (at < size) {
        if (size - at < lengthSize + 1) throw new Reject('damaged', 'video frame ends inside a NAL header');
        if (!window.has(offset + at, lengthSize + 1)) await window.load(offset + at, lengthSize + 1);
        let length = 0;
        for (let b = 0; b < lengthSize; b++) length = length * 256 + window.byte(offset + at + b);
        if (length === 0) throw new Reject('damaged', 'empty NAL unit');
        if ((window.byte(offset + at + lengthSize) & 0x80) !== 0) throw new Reject('damaged', 'invalid NAL header');
        at += lengthSize + length;
      }
      if (at !== size) throw new Reject('damaged', 'NAL units overrun the video frame');
      offset += size;
    }
  }
  return sample;
}

/** Checks that `source` is a genuine, self-contained MP4 / QuickTime video. */
export async function checkVideoFile(source: ByteSource, options: VideoCheckOptions): Promise<VideoCheckResult> {
  try {
    return await check(source, options);
  } catch (error) {
    if (error instanceof Reject) return { ok: false, reason: error.reason, detail: error.message };
    throw error;
  }
}

async function check(source: ByteSource, { maxBytes, deep = false, onProgress, signal }: VideoCheckOptions): Promise<VideoCheckPassed> {
  const size = source.size;
  if (!Number.isSafeInteger(size) || size <= 0) throw new Reject('empty', 'empty file');
  if (size > maxBytes) throw new Reject('too_large', 'file is larger than the limit');
  if (size < 16) throw new Reject('not_a_video', 'file is too small');

  // 1. Top-level boxes tile the file.
  const boxes: Box[] = [];
  let offset = 0;
  while (offset < size) {
    checkAbort(signal);
    if (boxes.length >= MAX_TOP_LEVEL_BOXES) throw new Reject('unsupported_format', 'too many top-level boxes');
    if (size - offset < 8) throw new Reject('hidden_data', 'trailing bytes after the last box');
    const header = await readExactly(source, offset, Math.min(32, size - offset));
    const view = viewOf(header);
    let boxSize = u32(view, 0);
    const type = fourcc(header, 4);
    let headerSize = 8;
    if (boxes.length === 0 && type !== 'ftyp') throw new Reject('not_a_video', 'file does not start with ftyp');
    if (boxSize === 1) {
      if (header.byteLength < 16) throw new Reject('damaged', 'truncated box header');
      boxSize = u64(view, 8);
      headerSize = 16;
    } else if (boxSize === 0) {
      boxSize = size - offset;
    }
    if (type === 'uuid') headerSize += 16;
    if (FRAGMENT_BOXES.has(type)) throw new Reject('unsupported_format', 'fragmented MP4');
    if (!TOP_LEVEL_BOXES.has(type)) {
      throw new Reject(boxes.length === 0 ? 'not_a_video' : 'hidden_data', `unexpected box ${JSON.stringify(type)}`);
    }
    if (boxSize < headerSize || offset + boxSize > size) throw new Reject('damaged', `box ${JSON.stringify(type)} overruns the file`);
    boxes.push({ type, start: offset, body: offset + headerSize, end: offset + boxSize });
    offset += boxSize;
  }

  // 2. File type.
  const ftyp = boxes[0]!;
  if (ftyp.end - ftyp.body < 8 || ftyp.end - ftyp.start > 4096) throw new Reject('not_a_video', 'invalid ftyp');
  const ftypBytes = await readExactly(source, ftyp.body, ftyp.end - ftyp.body);
  const brands = [fourcc(ftypBytes, 0)];
  for (let at = 8; at + 4 <= ftypBytes.byteLength; at += 4) brands.push(fourcc(ftypBytes, at));
  const container = brands[0] === 'qt  ' ? 'mov' : 'mp4';
  if (!brands.some((brand) => brand === 'qt  ' || MP4_BRANDS.has(brand))) throw new Reject('not_a_video', `brand ${JSON.stringify(brands[0])}`);

  if (boxes.filter((box) => box.type === 'ftyp').length > 1) throw new Reject('damaged', 'more than one ftyp');
  const moovs = boxes.filter((box) => box.type === 'moov');
  if (moovs.length !== 1) throw new Reject(moovs.length === 0 ? 'not_a_video' : 'damaged', 'expected exactly one moov');
  const mdats = boxes.filter((box) => box.type === 'mdat');
  if (mdats.length === 0) throw new Reject('not_a_video', 'no media data');
  const sideBytes = boxes.filter((box) => SIDE_BOXES.has(box.type)).reduce((total, box) => total + (box.end - box.start), 0);
  if (sideBytes > MAX_SIDE_BYTES) throw new Reject('hidden_data', 'too much non-media data');

  // 3. Tracks.
  const moov = moovs[0]!;
  if (moov.end - moov.body > MAX_MOOV_BYTES) throw new Reject('unsupported_format', 'movie header is too large');
  const moovBytes = await readExactly(source, moov.body, moov.end - moov.body);
  const { tracks, durationMs } = parseMoov(moovBytes, moov.body, deep);
  const video = tracks.find((track) => track.handler === 'vide' && VIDEO_CODECS.has(track.codec) && track.chunks.length > 0);
  if (!video) throw new Reject('no_video_track', 'no video track with a supported codec');

  // 4. Chunks lie inside mdat, don't overlap, and cover mdat.
  const chunks = tracks.flatMap((track) => track.chunks);
  chunks.sort((a, b) => a.start - b.start);
  const payloads = mdats.map((box) => ({ start: box.body, end: box.end }));
  let unreferenced = 0;
  let index = 0;
  for (const payload of payloads) {
    let cursor = payload.start;
    for (; index < chunks.length && chunks[index]!.start < payload.end; index++) {
      const chunk = chunks[index]!;
      if (chunk.start < payload.start) throw new Reject('damaged', 'chunk outside the media data');
      // An open-ended chunk runs to the next chunk or the end of this mdat.
      const next = chunks[index + 1];
      const end = chunk.end !== -1 ? chunk.end : next && next.start < payload.end ? next.start : payload.end;
      if (end > payload.end) throw new Reject('damaged', 'chunk runs past the media data');
      if (chunk.start < cursor) throw new Reject('damaged', 'overlapping chunks');
      unreferenced += chunk.start - cursor;
      cursor = end;
    }
    unreferenced += payload.end - cursor;
  }
  if (index < chunks.length) throw new Reject('damaged', 'chunk outside the media data');
  const mdatBytes = payloads.reduce((total, payload) => total + (payload.end - payload.start), 0);
  if (unreferenced > MAX_UNREFERENCED_BYTES(mdatBytes)) throw new Reject('hidden_data', 'media data holds bytes no track uses');

  // 5. Every video frame (deep).
  let framesChecked = 0;
  if (deep) {
    const window = new Window(source);
    const nalTracks = tracks.filter((track) => track.sampleSizes !== null);
    const totalChunks = nalTracks.reduce((total, track) => total + track.chunks.length, 0);
    let done = 0;
    for (const track of nalTracks) {
      framesChecked += await checkFrames(track, window, () => onProgress?.(++done / totalChunks), signal);
    }
  }
  onProgress?.(1);

  return { ok: true, container, durationMs, videoCodec: video.codec, tracks: tracks.length, framesChecked };
}

// Personal metadata ------------------------------------------------------------

/** Top-level boxes that can hold location or device details (XMP, Samsung trailer, ...). */
const PERSONAL_TOP_LEVEL = new Set(['meta', 'uuid', 'sefd', 'PICT', 'pnot']);
/** Movie- and track-level metadata: `©xyz` / `loci` GPS, Apple location keys, make and model. */
const PERSONAL_IN_MOVIE = new Set(['udta', 'meta', 'uuid']);
/** Timed metadata tracks that carry GPS: GoPro telemetry and camera motion. */
const TELEMETRY_CODECS = new Set(['gpmd', 'camm']);

export interface MetadataEdit {
  /** What it is (e.g. `moov/udta`), for logs and tests. */
  what: string;
  /** Start of a box whose type becomes `free`; null for sample data. */
  box: number | null;
  /** Byte range to overwrite with zeros. */
  start: number;
  end: number;
}

/**
 * Finds what to blank so a video no longer says where it was recorded (GPS
 * in `©xyz`, `loci`, Apple's `com.apple.quicktime.location.*`, XMP, GoPro
 * telemetry) or on which phone (make, model, software). Boxes become `free`
 * boxes of the same size with zeroed contents and telemetry samples are
 * zeroed, so no offset moves and the file stays valid and playable. Call it
 * on a file that passed `checkVideoFile`.
 */
export async function findPersonalMetadata(source: ByteSource): Promise<MetadataEdit[]> {
  const edits: MetadataEdit[] = [];
  const blank = (what: string, box: Box) => edits.push({ what, box: box.start, start: box.body, end: box.end });
  for (let offset = 0; offset < source.size; ) {
    const header = await readExactly(source, offset, Math.min(32, source.size - offset));
    const view = viewOf(header);
    const type = fourcc(header, 4);
    let size = u32(view, 0);
    let headerSize = 8;
    if (size === 1) {
      size = u64(view, 8);
      headerSize = 16;
    } else if (size === 0) {
      size = source.size - offset;
    }
    if (type === 'uuid') headerSize += 16;
    if (size < headerSize) throw new Reject('damaged', 'invalid box size');
    const box: Box = { type, start: offset, body: offset + headerSize, end: offset + size };

    if (PERSONAL_TOP_LEVEL.has(type)) blank(type, box);
    if (type === 'moov') {
      const moov = await readExactly(source, box.body, box.end - box.body);
      for (const child of childBoxes(moov, 0, moov.byteLength, box.body)) {
        if (PERSONAL_IN_MOVIE.has(child.type)) blank(`moov/${child.type}`, child);
        if (child.type !== 'trak') continue;
        for (const part of childBoxes(moov, child.body - box.body, child.end - box.body, box.body)) {
          if (PERSONAL_IN_MOVIE.has(part.type)) blank(`trak/${part.type}`, part);
        }
      }
      for (const track of parseMoov(moov, box.body, false).tracks) {
        if (!TELEMETRY_CODECS.has(track.codec)) continue;
        for (const chunk of track.chunks) edits.push({ what: `${track.codec} samples`, box: null, start: chunk.start, end: chunk.end });
      }
    }
    offset = box.end;
  }
  return edits;
}

/**
 * JPEG frames: starts with an SOI marker followed by another marker and ends
 * with EOI (trailing zero padding allowed).
 */
export function isJpeg(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 128 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return false;
  let end = bytes.byteLength;
  while (end > 2 && bytes[end - 1] === 0) end--;
  return bytes[end - 2] === 0xff && bytes[end - 1] === 0xd9;
}
