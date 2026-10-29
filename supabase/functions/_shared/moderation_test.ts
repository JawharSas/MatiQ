// deno test --allow-env supabase/functions/
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from './log.ts';
import { BAN_CONFIDENCE, isSexualContent, QUARANTINE_BUCKET, quarantine, requestIps } from './moderation.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent };

Deno.test('requestIps collects the whole proxy chain once', () => {
  const req = new Request('https://x.test', {
    headers: { 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '198.51.100.1, 203.0.113.7 ,, 10.0.0.1' },
  });
  assert(requestIps(req).join() === '203.0.113.7,198.51.100.1,10.0.0.1', `got ${requestIps(req)}`);
  assert(requestIps(new Request('https://x.test')).length === 0, 'no headers, no addresses');
  const many = Array.from({ length: 30 }, (_, i) => `10.0.0.${i}`).join(',');
  assert(requestIps(new Request('https://x.test', { headers: { 'x-forwarded-for': many } })).length === 10, 'capped');
});

Deno.test('isSexualContent needs a confident finding', () => {
  assert(isSexualContent({ sexualContent: true, confidence: BAN_CONFIDENCE }), 'confident finding');
  assert(!isSexualContent({ sexualContent: true, confidence: 0.4 }), 'unsure findings never ban');
  assert(!isSexualContent({ sexualContent: false, confidence: 1 }), 'clean');
  assert(!isSexualContent(undefined) && !isSexualContent(null), 'no check result');
});

Deno.test('quarantine moves files out of sight, or deletes them if it cannot', async () => {
  const moved: string[] = [];
  const removed: string[] = [];
  const admin = {
    storage: {
      from: () => ({
        move: (from: string, to: string, options: { destinationBucket: string }) => {
          if (from.includes('stuck')) return Promise.resolve({ error: { message: 'no' } });
          moved.push(`${options.destinationBucket}:${to}`);
          return Promise.resolve({ error: null });
        },
        remove: (paths: string[]) => {
          removed.push(...paths);
          return Promise.resolve({ error: null });
        },
      }),
    },
  } as unknown as SupabaseClient;
  await quarantine(admin, 'match-frames', ['u/m/1.jpg', 'u/m/stuck.jpg'], 'u', 'case-1', silent);
  assert(moved.join() === `${QUARANTINE_BUCKET}:u/case-1/match-frames/1.jpg`, `moved ${moved}`);
  assert(removed.join() === 'u/m/stuck.jpg', `removed ${removed}`);
});
