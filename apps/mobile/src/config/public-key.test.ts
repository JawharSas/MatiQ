import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPublicSupabaseKey } from './public-key.ts';

const jwt = (claims: object) =>
  ['{"alg":"HS256","typ":"JWT"}', JSON.stringify(claims)].map((part) => Buffer.from(part).toString('base64url')).join('.') + '.signature';

describe('isPublicSupabaseKey', () => {
  it('accepts publishable keys and anon JWTs', () => {
    assert.equal(isPublicSupabaseKey('sb_publishable_NLqMpAOvPaZK7G48Prt5iA_wQvZLIot'), true);
    assert.equal(isPublicSupabaseKey(jwt({ iss: 'supabase', role: 'anon' })), true);
  });

  it('refuses secret and service-role keys', () => {
    assert.equal(isPublicSupabaseKey('sb_secret_abcdefghijklmnopqrstuvwxyz'), false);
    assert.equal(isPublicSupabaseKey(jwt({ iss: 'supabase', role: 'service_role' })), false);
  });

  it('refuses anything else', () => {
    assert.equal(isPublicSupabaseKey('not-a-key-at-all-but-long'), false);
    assert.equal(isPublicSupabaseKey('header.%%%.signature'), false);
  });
});
