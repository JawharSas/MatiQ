import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupSecret, normalizeTotpCode } from './totp.ts';

describe('normalizeTotpCode', () => {
  it('accepts six digits with optional separators', () => {
    assert.equal(normalizeTotpCode('123456'), '123456');
    assert.equal(normalizeTotpCode(' 123 456 '), '123456');
    assert.equal(normalizeTotpCode('123-456'), '123456');
  });

  it('rejects anything else', () => {
    assert.equal(normalizeTotpCode('12345'), null);
    assert.equal(normalizeTotpCode('1234567'), null);
    assert.equal(normalizeTotpCode('12a456'), null);
    assert.equal(normalizeTotpCode(''), null);
  });
});

describe('groupSecret', () => {
  it('groups a base32 secret in fours', () => {
    assert.equal(groupSecret('JBSWY3DPEHPK3PXPAB'), 'JBSW Y3DP EHPK 3PXP AB');
    assert.equal(groupSecret(''), '');
  });
});
