import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afterFailure, MAX_LOCK_MS, noThrottle, parseThrottle, remainingMs, waitMessage } from './sign-in-throttle.ts';

const fail = (times: number, now = 0) => {
  let state = noThrottle;
  for (let i = 0; i < times; i++) state = afterFailure(state, now);
  return state;
};

describe('sign-in throttle', () => {
  it('allows four wrong passwords without waiting', () => {
    assert.equal(remainingMs(fail(4), 0), 0);
  });

  it('waits 30 seconds after the fifth, then doubles', () => {
    assert.equal(remainingMs(fail(5), 0), 30_000);
    assert.equal(remainingMs(fail(6), 0), 60_000);
    assert.equal(remainingMs(fail(7), 0), 120_000);
  });

  it('never waits longer than 15 minutes', () => {
    assert.equal(remainingMs(fail(30), 0), MAX_LOCK_MS);
  });

  it('counts down', () => {
    assert.equal(remainingMs(fail(5, 1000), 21_000), 10_000);
    assert.equal(remainingMs(fail(5, 1000), 40_000), 0);
  });

  it('reads only valid stored state', () => {
    assert.deepEqual(parseThrottle(JSON.stringify(fail(6, 5))), fail(6, 5));
    assert.deepEqual(parseThrottle(undefined), noThrottle);
    assert.deepEqual(parseThrottle('{"failures":-1,"lockedUntil":0}'), noThrottle);
    assert.deepEqual(parseThrottle('not json'), noThrottle);
  });

  it('says how long to wait', () => {
    assert.equal(waitMessage(29_200), 'Too many sign-in attempts. Try again in 30 seconds.');
    assert.equal(waitMessage(120_000), 'Too many sign-in attempts. Try again in 2 minutes.');
  });
});
