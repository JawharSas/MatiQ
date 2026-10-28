// deno test --allow-env supabase/functions/
import { chunk, type FrameRef, selectFrames, subsample, uncoveredFrames } from './pipeline.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const frames: FrameRef[] = [0, 1000, 2000, 3000, 4000].map((t) => ({ t, path: `u/m/${t}.jpg` }));

Deno.test('selectFrames returns only frames that exist in storage', () => {
  const selected = selectFrames(frames, [2000, 0]);
  assert(selected?.map((frame) => frame.t).join() === '0,2000', 'expected sorted selection');
  assert(selectFrames(frames, [0, 9999]) === null, 'missing frames must be rejected');
  assert(selectFrames(frames, [0, 0]) === null, 'duplicates must be rejected');
});

Deno.test('uncoveredFrames leaves only frames no live batch analysed', () => {
  const remaining = uncoveredFrames(frames, [0, 1000, 3000]);
  assert(remaining.map((frame) => frame.t).join() === '2000,4000', 'unexpected leftovers');
});

Deno.test('subsample keeps both ends and the requested size', () => {
  const items = Array.from({ length: 1000 }, (_, i) => i);
  const sampled = subsample(items, 240);
  assert(sampled.length === 240 && sampled[0] === 0 && sampled[239] === 999, 'bad subsample');
  assert(subsample(items, 0).length === 0, 'zero budget means no frames');
  assert(chunk(sampled, 20).length === 12, 'bad chunking');
});
