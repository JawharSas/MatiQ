import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { authInitializing } from './init-state.ts';

describe('authInitializing', () => {
  it('stays loading while Clerk is still loading and timeout has not elapsed', () => {
    assert.equal(
      authInitializing({
        isClerkLoaded: false,
        clerkLoadTimedOut: false,
        clerkUserId: null,
        userId: null,
        accountError: null,
      }),
      true,
    );
  });

  it('stops blocking on Clerk load after timeout for signed-out state', () => {
    assert.equal(
      authInitializing({
        isClerkLoaded: false,
        clerkLoadTimedOut: true,
        clerkUserId: null,
        userId: null,
        accountError: null,
      }),
      false,
    );
  });

  it('keeps loading while opening a signed-in account', () => {
    assert.equal(
      authInitializing({
        isClerkLoaded: true,
        clerkLoadTimedOut: false,
        clerkUserId: 'user_123',
        userId: null,
        accountError: null,
      }),
      true,
    );
  });

  it('stops loading when account opening has failed', () => {
    assert.equal(
      authInitializing({
        isClerkLoaded: true,
        clerkLoadTimedOut: false,
        clerkUserId: 'user_123',
        userId: null,
        accountError: new Error('No account'),
      }),
      false,
    );
  });
});
