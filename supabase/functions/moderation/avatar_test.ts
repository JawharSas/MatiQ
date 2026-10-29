// deno test --allow-env supabase/functions/
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnalysisProvider } from '../_shared/ai/anthropic.ts';
import type { Safety } from '../_shared/ai/schemas.ts';
import type { Logger } from '../_shared/log.ts';
import { checkAvatar } from './avatar.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };
const USER = 'user-1';
const PENDING = `${USER}/pending.jpg`;
const JPEG = new Uint8Array(200);
JPEG.set([0xff, 0xd8, 0xff, 0xe0]);
JPEG.set([0xff, 0xd9], 198);

/** In-memory storage (all buckets) and a record of RPC calls. */
function fakeAdmin(files: Record<string, Uint8Array<ArrayBuffer>>, previous: string | null = null) {
  const objects = new Map(Object.entries(files).map(([path, bytes]) => [`avatars/${path}`, bytes]));
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const admin = {
    storage: {
      from: (bucket: string) => ({
        download: (path: string) => {
          const bytes = objects.get(`${bucket}/${path}`);
          return Promise.resolve(bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { message: 'missing' } });
        },
        move: (from: string, to: string, options?: { destinationBucket?: string }) => {
          const bytes = objects.get(`${bucket}/${from}`);
          if (!bytes) return Promise.resolve({ error: { message: 'missing' } });
          objects.delete(`${bucket}/${from}`);
          objects.set(`${options?.destinationBucket ?? bucket}/${to}`, bytes);
          return Promise.resolve({ error: null });
        },
        remove: (paths: string[]) => {
          for (const path of paths) objects.delete(`${bucket}/${path}`);
          return Promise.resolve({ error: null });
        },
      }),
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      return Promise.resolve({ data: name === 'svc_publish_avatar' ? previous : null, error: null });
    },
  } as unknown as SupabaseClient;
  return { admin, objects, rpcs };
}

function provider(result: Safety | null | Error): AnalysisProvider & { calls: number } {
  const fake = {
    model: 'test',
    calls: 0,
    analyzeBatch: () => Promise.reject(new Error('unused')),
    coachingSummary: () => Promise.reject(new Error('unused')),
    checkImage: () => {
      fake.calls++;
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
  return fake;
}

async function errorCode(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    return (error as { code?: string }).code ?? (error as Error).message;
  }
  return 'no error';
}

Deno.test('a clean picture is published under a new name and replaces the old one', async () => {
  const { admin, objects, rpcs } = fakeAdmin({ [PENDING]: JPEG, [`${USER}/old.jpg`]: JPEG }, `${USER}/old.jpg`);
  const path = await checkAvatar(admin, USER, provider({ sexualContent: false, confidence: 0.98 }), silent);
  assert(/^user-1\/[0-9a-f-]{36}\.jpg$/.test(path), `new path ${path}`);
  assert([...objects.keys()].join() === `avatars/${path}`, `only the new picture is left: ${[...objects.keys()]}`);
  assert(rpcs.length === 1 && rpcs[0]!.name === 'svc_publish_avatar' && rpcs[0]!.args.p_path === path, 'published');
});

Deno.test('sexual content is quarantined and bans the account', async () => {
  const { admin, objects, rpcs } = fakeAdmin({ [PENDING]: JPEG });
  const code = await errorCode(checkAvatar(admin, USER, provider({ sexualContent: true, confidence: 0.95 }), silent));
  assert(code === 'banned', `got ${code}`);
  const keys = [...objects.keys()];
  assert(keys.length === 1 && keys[0]!.startsWith(`moderation-quarantine/${USER}/avatar-`), `quarantined: ${keys}`);
  assert(rpcs.map((call) => call.name).join() === 'svc_ban_user', 'banned, never published');
  assert(rpcs[0]!.args.p_category === 'sexual_content', 'with the right category');
});

Deno.test('an unsure finding is not a ban, a declined check is not published', async () => {
  const unsure = fakeAdmin({ [PENDING]: JPEG });
  await checkAvatar(unsure.admin, USER, provider({ sexualContent: true, confidence: 0.3 }), silent);
  assert(!unsure.rpcs.some((call) => call.name === 'svc_ban_user'), 'no ban below the confidence bar');

  const declined = fakeAdmin({ [PENDING]: JPEG });
  assert((await errorCode(checkAvatar(declined.admin, USER, provider(null), silent))) === 'image_rejected', 'rejected');
  assert(declined.objects.size === 0 && declined.rpcs.length === 0, 'discarded');
});

Deno.test('anything but a small JPEG is discarded without an AI call', async () => {
  for (const bytes of [new TextEncoder().encode('<svg onload=alert(1)>'.padEnd(300)), new Uint8Array(3 * 1024 * 1024)]) {
    const { admin, objects } = fakeAdmin({ [PENDING]: bytes });
    const ai = provider({ sexualContent: false, confidence: 1 });
    assert((await errorCode(checkAvatar(admin, USER, ai, silent))) === 'image_rejected', 'rejected');
    assert(objects.size === 0 && ai.calls === 0, 'discarded unchecked');
  }
});

Deno.test('without the platform key nothing is published unchecked', async () => {
  const { admin, objects } = fakeAdmin({ [PENDING]: JPEG });
  assert((await errorCode(checkAvatar(admin, USER, null, silent))) === 'moderation_unavailable', 'unavailable');
  assert(objects.size === 0, 'the pending picture is removed');
});

Deno.test('a failing check discards the picture', async () => {
  const { admin, objects } = fakeAdmin({ [PENDING]: JPEG });
  const code = await errorCode(checkAvatar(admin, USER, provider(new Error('AI down')), silent));
  assert(code === 'AI down' && objects.size === 0, `got ${code}`);
});

Deno.test('replacing pending.jpg during the check does not swap the published picture', async () => {
  const { admin, objects } = fakeAdmin({ [PENDING]: JPEG });
  const swapped = JPEG.slice();
  swapped[100] = 0x42;
  const ai = provider({ sexualContent: false, confidence: 0.99 });
  ai.checkImage = () => {
    objects.set(`avatars/${PENDING}`, swapped);
    return Promise.resolve({ sexualContent: false, confidence: 0.99 });
  };
  const path = await checkAvatar(admin, USER, ai, silent);
  assert(objects.get(`avatars/${path}`) === JPEG, 'the checked bytes are the ones published');
  assert(objects.get(`avatars/${PENDING}`) === swapped, 'the replacement waits as a new, unchecked upload');
});
