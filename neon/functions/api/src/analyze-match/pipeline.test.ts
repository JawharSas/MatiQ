import { test } from 'node:test';
import type { Admin } from '../shared/admin.ts';
import type { Logger } from '../shared/log.ts';
import { chunk, enforceContentSafety, type FrameRef, type MatchRow, selectFrames, subsample, uncoveredFrames } from './pipeline.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const frames: FrameRef[] = [0, 1000, 2000, 3000, 4000].map((t) => ({ t, path: `u/m/${t}.jpg` }));

test('selectFrames returns only frames that exist in storage', () => {
  const selected = selectFrames(frames, [2000, 0]);
  assert(selected?.map((frame) => frame.t).join() === '0,2000', 'expected sorted selection');
  assert(selectFrames(frames, [0, 9999]) === null, 'missing frames must be rejected');
  assert(selectFrames(frames, [0, 0]) === null, 'duplicates must be rejected');
});

test('uncoveredFrames leaves only frames no live batch analysed', () => {
  const remaining = uncoveredFrames(frames, [0, 1000, 3000]);
  assert(remaining.map((frame) => frame.t).join() === '2000,4000', 'unexpected leftovers');
});

test('subsample keeps both ends and the requested size', () => {
  const items = Array.from({ length: 1000 }, (_, i) => i);
  const sampled = subsample(items, 240);
  assert(sampled.length === 240 && sampled[0] === 0 && sampled[239] === 999, 'bad subsample');
  assert(subsample(items, 0).length === 0, 'zero budget means no frames');
  assert(chunk(sampled, 20).length === 12, 'bad chunking');
});

test('enforceContentSafety quarantines the recording and bans on a confident finding', async () => {
  const objects = new Set(['match-frames/u/m/0.jpg', 'match-frames/u/m/1000.jpg', 'match-videos/u/m/video.mp4']);
  const rpcs: string[] = [];
  const admin = {
    storage: {
      from: (bucket: string) => ({
        list: (folder: string) =>
          Promise.resolve({
            data: [...objects].filter((key) => key.startsWith(`${bucket}/${folder}/`)).map((key) => ({ name: key.split('/').pop() })),
            error: null,
          }),
        move: (from: string, to: string, options: { destinationBucket: string }) => {
          objects.delete(`${bucket}/${from}`);
          objects.add(`${options.destinationBucket}/${to}`);
          return Promise.resolve({ error: null });
        },
        remove: () => Promise.resolve({ error: null }),
      }),
    },
    rpc: (name: string) => {
      rpcs.push(name);
      return Promise.resolve({ data: null, error: null });
    },
  } as unknown as Admin;
  const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };
  const match = { id: 'm', owner_id: 'u' } as MatchRow;
  const clean = { events: [], observations: [], safety: { sexualContent: false, confidence: 0.9 } };

  await enforceContentSafety(admin, match, [clean, { events: [], observations: [] }], silent);
  assert(objects.size === 3 && rpcs.length === 0, 'clean recordings are left alone');

  let code = '';
  await enforceContentSafety(admin, match, [clean, { ...clean, safety: { sexualContent: true, confidence: 0.9 } }], silent)
    .catch((error) => (code = error.code));
  assert(code === 'content_removed', `stops the analysis, got ${code}`);
  assert([...objects].every((key) => key.startsWith('moderation-quarantine/u/match-m/')), `quarantined: ${[...objects]}`);
  assert(objects.size === 3 && rpcs.join() === 'svc_ban_user', 'everything moved and the account banned');
});
