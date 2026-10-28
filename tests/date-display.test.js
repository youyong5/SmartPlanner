import test from 'node:test';
import assert from 'node:assert/strict';
import { shortDateTime, parseShortDateTime } from '../src/date-display.js';

const minute = (year, month, day, hour, time) => new Date(year, month - 1, day, hour, time).getTime() / 60_000;

test('date fields hide the year but keep the plan year', () => {
  const anchor = minute(2026, 10, 21, 8, 0);
  assert.equal(shortDateTime(anchor), '10/21 08:00');
  assert.equal(parseShortDateTime('10/21 17:30', anchor), minute(2026, 10, 21, 17, 30));
});

test('nearby dates can cross New Year without showing a year', () => {
  assert.equal(parseShortDateTime('01/02 09:00', minute(2026, 12, 31, 17, 0)), minute(2027, 1, 2, 9, 0));
  assert.equal(parseShortDateTime('12/30 09:00', minute(2027, 1, 1, 9, 0)), minute(2026, 12, 30, 9, 0));
});

test('invalid calendar dates are rejected', () => {
  const anchor = minute(2026, 10, 21, 8, 0);
  for (const value of ['13/01 10:00', '02/30 10:00', '10/21 24:00', '10/21 9:60', '2026/10/21 09:00']) {
    assert.equal(parseShortDateTime(value, anchor), null, value);
  }
});
