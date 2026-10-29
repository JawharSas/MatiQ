import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { meetsMinimumAge, parseBirthMonth } from './age-rule.ts';

const TODAY = new Date(2026, 9, 15); // 15 October 2026

describe('meetsMinimumAge', () => {
  it('allows people whose 13th birthday month has passed', () => {
    assert.equal(meetsMinimumAge({ year: 2013, month: 9 }, TODAY), true);
    assert.equal(meetsMinimumAge({ year: 1990, month: 1 }, TODAY), true);
  });

  it('does not allow anyone in or before the month of their 13th birthday', () => {
    assert.equal(meetsMinimumAge({ year: 2013, month: 10 }, TODAY), false);
    assert.equal(meetsMinimumAge({ year: 2013, month: 11 }, TODAY), false);
    assert.equal(meetsMinimumAge({ year: 2020, month: 1 }, TODAY), false);
  });
});

describe('parseBirthMonth', () => {
  it('accepts a month and a four-digit year', () => {
    assert.deepEqual(parseBirthMonth({ month: 5, year: ' 1998 ' }, TODAY), { ok: true, value: { year: 1998, month: 5 } });
  });

  it('explains what is missing or wrong', () => {
    assert.deepEqual(parseBirthMonth({ month: null, year: '1998' }, TODAY), { ok: false, error: 'Choose your birth month.' });
    assert.equal(parseBirthMonth({ month: 5, year: '98' }, TODAY).ok, false);
    assert.equal(parseBirthMonth({ month: 5, year: '1899' }, TODAY).ok, false);
    assert.equal(parseBirthMonth({ month: 11, year: '2026' }, TODAY).ok, false, 'a month in the future');
    assert.equal(parseBirthMonth({ month: 10, year: '2026' }, TODAY).ok, true, 'this month is a real (if young) date');
  });
});
