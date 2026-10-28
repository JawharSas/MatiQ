import { jwtAal, requiresStepUp } from './mfa.ts';

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
}

const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const token = (claims: Record<string, unknown>) => `${encode({ alg: 'ES256' })}.${encode(claims)}.signature`;

Deno.test('jwtAal reads the claim and defaults to aal1', () => {
  assertEquals(jwtAal(token({ sub: 'u', aal: 'aal2' })), 'aal2');
  assertEquals(jwtAal(token({ sub: 'u' })), 'aal1');
  assertEquals(jwtAal('not-a-jwt'), 'aal1');
  assertEquals(jwtAal('a.%%%.c'), 'aal1');
});

Deno.test('step-up is required only with a verified factor on an aal1 session', () => {
  assertEquals(requiresStepUp(undefined, 'aal1'), false);
  assertEquals(requiresStepUp([{ status: 'unverified' }], 'aal1'), false);
  assertEquals(requiresStepUp([{ status: 'verified' }], 'aal1'), true);
  assertEquals(requiresStepUp([{ status: 'verified' }], 'aal2'), false);
});
