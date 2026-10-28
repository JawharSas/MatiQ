// deno test --allow-env supabase/functions/
import { decryptSecret, DecryptionError, encryptSecret, fingerprintSecret, fromBase64, rotateRecord, toBase64 } from './crypto.ts';
import { redact } from './log.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejects(fn: () => Promise<unknown>, type: new (...args: never[]) => Error): Promise<void> {
  try {
    await fn();
  } catch (error) {
    assert(error instanceof type, `expected ${type.name}, got ${String(error)}`);
    return;
  }
  throw new Error(`expected ${type.name} to be thrown`);
}

const randomKek = () => toBase64(crypto.getRandomValues(new Uint8Array(32)));
Deno.env.set('MATIQ_KEK_V1', randomKek());
Deno.env.set('MATIQ_KEK_V2', randomKek());
Deno.env.set('MATIQ_KEK_CURRENT', '1');

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const SECRET = 'sk-ant-api03-test-key-0123456789abcdefghijklmnop';

Deno.test('encrypts and decrypts a secret', async () => {
  const encrypted = await encryptSecret(SECRET, USER, 'anthropic');
  assert(!encrypted.ciphertext.includes('sk-ant'), 'ciphertext must not contain plaintext');
  assert(fromBase64(encrypted.iv).byteLength === 12, 'iv must be 96 bits');
  assert(encrypted.iv.length === 16, 'iv must fit the database constraint');
  assert((await decryptSecret(encrypted, USER, 'anthropic')) === SECRET, 'round trip failed');
});

Deno.test('uses a fresh IV for every encryption', async () => {
  const a = await encryptSecret(SECRET, USER, 'anthropic');
  const b = await encryptSecret(SECRET, USER, 'anthropic');
  assert(a.iv !== b.iv && a.ciphertext !== b.ciphertext, 'IV reuse detected');
});

Deno.test('binds ciphertext to its owner (AAD)', async () => {
  const encrypted = await encryptSecret(SECRET, USER, 'anthropic');
  await rejects(() => decryptSecret(encrypted, OTHER, 'anthropic'), DecryptionError);
});

Deno.test('detects tampering', async () => {
  const encrypted = await encryptSecret(SECRET, USER, 'anthropic');
  const bytes = fromBase64(encrypted.ciphertext);
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  await rejects(() => decryptSecret({ ...encrypted, ciphertext: toBase64(bytes) }, USER, 'anthropic'), DecryptionError);
});

Deno.test('rotates records to the current KEK version', async () => {
  const v1 = await encryptSecret(SECRET, USER, 'anthropic');
  Deno.env.set('MATIQ_KEK_CURRENT', '2');
  try {
    const v2 = await rotateRecord(v1, USER, 'anthropic');
    assert(v2.keyVersion === 2, 'expected key version 2');
    assert((await decryptSecret(v2, USER, 'anthropic')) === SECRET, 'rotated record must decrypt');
  } finally {
    Deno.env.set('MATIQ_KEK_CURRENT', '1');
  }
});

Deno.test('fingerprints are stable and short', async () => {
  const a = await fingerprintSecret(SECRET);
  const b = await fingerprintSecret(SECRET);
  assert(a === b && /^[0-9a-f]{16}$/.test(a), 'unexpected fingerprint');
  assert(a !== (await fingerprintSecret(`${SECRET}x`)), 'fingerprints must differ');
});

Deno.test('log redaction masks credentials', () => {
  const line = redact(`{"apiKey":"${SECRET}","note":"Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl"}`);
  assert(!line.includes('test-key'), 'api key leaked');
  assert(!line.includes('eyJzdWIi'), 'jwt leaked');
});
