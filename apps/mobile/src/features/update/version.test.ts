import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOlderThan } from './version.ts';

describe('isOlderThan', () => {
  it('compares each part as a number', () => {
    assert.equal(isOlderThan('1.3.0', '1.7.0'), true);
    assert.equal(isOlderThan('1.9.0', '1.10.0'), true);
    assert.equal(isOlderThan('1.7.0', '1.7.0'), false);
    assert.equal(isOlderThan('1.7.1', '1.7.0'), false);
    assert.equal(isOlderThan('2.0.0', '1.99.99'), false);
  });

  it('ignores a channel suffix', () => {
    assert.equal(isOlderThan('1.7.0-alpha', '1.7.0'), false);
    assert.equal(isOlderThan('1.6.0-pre-beta', '1.7.0'), true);
  });

  it('never blocks on something it cannot read', () => {
    assert.equal(isOlderThan(undefined, '1.7.0'), false);
    assert.equal(isOlderThan('1.7.0', null), false);
    assert.equal(isOlderThan('dev', '1.7.0'), false);
    assert.equal(isOlderThan('1.7.0', 'latest'), false);
  });
});
