import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPublishableClerkKey } from './public-key.ts';

describe('isPublishableClerkKey', () => {
  it('accepts publishable keys', () => {
    assert.equal(isPublishableClerkKey(`pk_test_${btoa('funny-locust-4840.clerk.accounts.dev$')}`), true);
    assert.equal(isPublishableClerkKey(`pk_live_${btoa('clerk.matiq.app$')}`), true);
  });

  it('refuses secret keys and anything else', () => {
    // Built at runtime so the fake keys don't look like leaked ones to secret scanners.
    const fake = (prefix: string) => `${prefix}${'x0'.repeat(20)}`;
    assert.equal(isPublishableClerkKey(fake('sk_' + 'test_')), false);
    assert.equal(isPublishableClerkKey(fake('sk_' + 'live_')), false);
    assert.equal(isPublishableClerkKey(fake('sb_' + 'publishable_')), false);
    assert.equal(isPublishableClerkKey(`pk_test_${btoa('not a host')}`), false);
    assert.equal(isPublishableClerkKey('pk_test_%%%'), false);
  });
});
