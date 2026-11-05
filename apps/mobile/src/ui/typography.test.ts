import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { CONDENSED, nearestFace, typeface } from './typography.ts';

describe('typeface', () => {
  it('leaves styles alone until the fonts have loaded', () => {
    assert.equal(typeface({ fontWeight: '700' }, false), null);
  });

  it('picks the Barlow face for the weight', () => {
    assert.deepEqual(typeface({}, true), { fontFamily: 'Barlow_400Regular', fontWeight: 'normal' });
    assert.deepEqual(typeface({ fontWeight: 'bold' }, true), { fontFamily: 'Barlow_700Bold', fontWeight: 'normal' });
    assert.deepEqual(typeface({ fontWeight: '600' }, true), { fontFamily: 'Barlow_600SemiBold', fontWeight: 'normal' });
    assert.deepEqual(typeface({ fontWeight: '900' }, true), { fontFamily: 'Barlow_800ExtraBold', fontWeight: 'normal' });
  });

  it('uses the condensed face when asked for', () => {
    assert.deepEqual(typeface({ fontFamily: CONDENSED, fontWeight: '800' }, true), {
      fontFamily: 'BarlowCondensed_800ExtraBold',
      fontWeight: 'normal',
    });
    // Condensed starts at 600: lighter weights get the nearest one.
    assert.equal(typeface({ fontFamily: CONDENSED }, true)?.fontFamily, 'BarlowCondensed_600SemiBold');
  });

  it("doesn't touch another font", () => {
    assert.equal(typeface({ fontFamily: 'Ionicons' }, true), null);
    assert.equal(typeface({ fontFamily: 'monospace', fontWeight: '700' }, true), null);
  });
});

describe('nearestFace', () => {
  it('prefers the heavier face on a tie', () => {
    assert.equal(nearestFace({ 400: 'regular', 600: 'semibold' }, 500), 'semibold');
  });
});
