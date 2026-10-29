// deno test --allow-env supabase/functions/
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from '../_shared/log.ts';
import { publishVideo, rangeSource } from './video.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// A 1-second, 2-frame H.264 MP4 (ffmpeg test pattern).
const MP4 = Uint8Array.from(
  atob(
    'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMEbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAA' +
    'AAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAlN0cmFrAAAAXHRraGQA' +
    'AAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAA' +
    'AAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAHLbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhk' +
    'bHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABdm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZW' +
    'YAAAAAAAAAAQAAAAx1cmwgAAAAAQAAATZzdGJsAAAAtnN0c2QAAAAAAAAAAQAAAKZhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABI' +
    'AAAASAAAAAAAAAABDExhdmMgbGlieDI2NAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAALGF2Y0MBQsAK/+EAFWdCwAraewEQAAADABAAAAMAQP' +
    'EiagEABGjOD8gAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAATcAAAE3AAAAAYc3R0cwAAAAAAAAABAAAAAgAAIAAAAAAUc3RzcwAAAAAA' +
    'AAABAAAAAQAAABxzdHNjAAAAAAAAAAEAAAABAAAAAgAAAAEAAAAcc3RzegAAAAAAAAAAAAAAAgAAAmUAAAAJAAAAFHN0Y28AAAAAAAAAAQAAAz' +
    'QAAAA9dWR0YQAAADVtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAAAhpbHN0AAAACGZyZWUAAAJ2bWRhdAAAAlMG' +
    'Bf//T9xF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjQgcjMxMDggMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bG' +
    'VmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0xIGRlYmxvY2s9' +
    'MDowOjAgYW5hbHlzZT0wOjAgbWU9ZGlhIHN1Ym1lPTAgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MCBtZV9yYW5nZT0xNiBjaH' +
    'JvbWFfbWU9MSB0cmVsbGlzPTAgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9MCB0' +
    'aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2' +
    'NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz0wIHdlaWdodHA9MCBrZXlpbnQ9MjUwIGtleWludF9taW49MiBzY2VuZWN1dD0w' +
    'IGludHJhX3JlZnJlc2g9MCByYz1jcmYgbWJ0cmVlPTAgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3' +
    'JhdGlvPTEuNDAgYXE9MACAAAAACmWIhDomKAAJAuAAAAAFQZogEqU=',
  ),
  (char) => char.charCodeAt(0),
);
const NOT_A_VIDEO = new TextEncoder().encode('<html><script>alert(1)</script></html>'.padEnd(2048, ' '));

/** Serves `files` (by signed URL) with HTTP range support. */
function rangeServer(files: Map<string, Uint8Array>, { ignoreRange = false } = {}) {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const bytes = files.get(String(input));
    if (!bytes) return Promise.resolve(new Response(null, { status: 404 }));
    const range = /bytes=(\d+)-(\d+)/.exec(new Headers(init?.headers).get('Range') ?? '');
    if (ignoreRange || !range) return Promise.resolve(new Response(bytes.slice(), { status: 200 }));
    const start = Number(range[1]);
    const end = Math.min(Number(range[2]), bytes.byteLength - 1);
    return Promise.resolve(
      new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.byteLength}` },
      }),
    );
  }) as typeof fetch;
}

/** In-memory stand-in for `admin.storage.from('match-videos')`. */
function fakeStorage(initial: Record<string, Uint8Array>) {
  const objects = new Map(Object.entries(initial));
  const signed = new Map<string, Uint8Array>();
  const bucket = {
    list: (folder: string) =>
      Promise.resolve({
        data: [...objects.keys()].filter((path) => path.startsWith(`${folder}/`)).map((path) => ({ name: path.slice(folder.length + 1) })),
        error: null,
      }),
    move: (from: string, to: string) => {
      const bytes = objects.get(from);
      if (!bytes || objects.has(to)) return Promise.resolve({ data: null, error: { message: 'cannot move' } });
      objects.delete(from);
      objects.set(to, bytes);
      return Promise.resolve({ data: {}, error: null });
    },
    remove: (paths: string[]) => {
      for (const path of paths) objects.delete(path);
      return Promise.resolve({ data: [], error: null });
    },
    createSignedUrl: (path: string) => {
      const url = `https://storage.test/sign/${path}?token=${signed.size}`;
      signed.set(url, objects.get(path)!);
      return Promise.resolve({ data: { signedUrl: url }, error: null });
    },
  };
  const admin = { storage: { from: () => bucket } } as unknown as SupabaseClient;
  return { admin, objects, fetch: rangeServer(signed) };
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };
const folder = 'user-1/match-1';

Deno.test('rangeSource reads byte ranges and knows the size', async () => {
  const source = await rangeSource('https://x.test/v', rangeServer(new Map([['https://x.test/v', MP4]])));
  assert(source.size === MP4.byteLength, 'size from Content-Range');
  const bytes = await source.read(4, 4);
  assert(new TextDecoder().decode(bytes) === 'ftyp', 'reads the requested range');
  assert((await source.read(MP4.byteLength - 2, 10)).byteLength === 2, 'clamped at the end');
});

Deno.test('rangeSource refuses servers that ignore Range', async () => {
  const fetchFn = rangeServer(new Map([['https://x.test/v', MP4]]), { ignoreRange: true });
  let failed = false;
  await rangeSource('https://x.test/v', fetchFn).catch(() => (failed = true));
  assert(failed, 'a 200 response must not be read as a range');
});

Deno.test('a genuine upload is checked and published as video.mp4', async () => {
  const storage = fakeStorage({ [`${folder}/upload.mp4`]: MP4 });
  const published = await publishVideo(storage.admin, 'user-1', 'match-1', silent, { fetchFn: storage.fetch });
  assert(published, 'published');
  assert([...storage.objects.keys()].join() === `${folder}/video.mp4`, `only video.mp4 remains: ${[...storage.objects.keys()]}`);
});

Deno.test('anything else is deleted, never published', async () => {
  const storage = fakeStorage({ [`${folder}/upload.mp4`]: NOT_A_VIDEO });
  const published = await publishVideo(storage.admin, 'user-1', 'match-1', silent, { fetchFn: storage.fetch });
  assert(!published, 'not published');
  assert(storage.objects.size === 0, 'the upload is gone');
});

Deno.test('a rejected re-upload keeps the earlier published video', async () => {
  const storage = fakeStorage({ [`${folder}/video.mp4`]: MP4, [`${folder}/upload.mov`]: NOT_A_VIDEO });
  assert(await publishVideo(storage.admin, 'user-1', 'match-1', silent, { fetchFn: storage.fetch }), 'still has a video');
  assert([...storage.objects.keys()].join() === `${folder}/video.mp4`, 'the bad upload is removed');
});

Deno.test('no upload: reports the published state unchanged', async () => {
  const none = fakeStorage({});
  assert(!(await publishVideo(none.admin, 'user-1', 'match-1', silent, { fetchFn: none.fetch })), 'no video');
  const existing = fakeStorage({ [`${folder}/video.mov`]: MP4 });
  assert(await publishVideo(existing.admin, 'user-1', 'match-1', silent, { fetchFn: existing.fetch }), 'existing video');
});

Deno.test('a check that cannot run keeps the upload for a retry', async () => {
  const storage = fakeStorage({ [`${folder}/upload.mp4`]: MP4 });
  let calls = 0;
  const down = (() => {
    calls++;
    return Promise.reject(new Error('storage unreachable'));
  }) as typeof fetch;
  let code = '';
  await publishVideo(storage.admin, 'user-1', 'match-1', silent, { fetchFn: down, retryDelayMs: 0 }).catch((error) => (code = error.code));
  assert(code === 'video_check_unavailable', `retryable error, got ${code}`);
  assert(calls === 3, `three attempts, got ${calls}`);
  assert([...storage.objects.keys()].join() === `${folder}/checking.mp4`, 'the upload is held, not deleted or published');

  assert(await publishVideo(storage.admin, 'user-1', 'match-1', silent, { fetchFn: storage.fetch }), 'the retry publishes it');
  assert([...storage.objects.keys()].join() === `${folder}/video.mp4`, 'published after the retry');
});
