// Run: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessDay, istCalendarDate, istWeekday, ymdAddDays, weekdayForYmd } from '../lib/business-day.mjs';

test('02:00 IST belongs to the previous business day (before the 04:00 cutoff)', () => {
  // 2026-07-22T20:30:00Z == 2026-07-23 02:00 IST -> business day 2026-07-22
  assert.equal(businessDay(new Date('2026-07-22T20:30:00Z')), '2026-07-22');
});

test('05:00 IST belongs to the same business day (after the cutoff)', () => {
  // 2026-07-22T23:30:00Z == 2026-07-23 05:00 IST -> business day 2026-07-23
  assert.equal(businessDay(new Date('2026-07-22T23:30:00Z')), '2026-07-23');
});

test('exactly 04:00 IST rolls to the new business day', () => {
  // 2026-07-22T22:30:00Z == 2026-07-23 04:00 IST -> 2026-07-23
  assert.equal(businessDay(new Date('2026-07-22T22:30:00Z')), '2026-07-23');
});

test('03:59 IST is still the previous business day', () => {
  // 2026-07-22T22:29:00Z == 2026-07-23 03:59 IST -> 2026-07-22
  assert.equal(businessDay(new Date('2026-07-22T22:29:00Z')), '2026-07-22');
});

test('weekday is computed in IST', () => {
  assert.equal(istWeekday(new Date('2026-07-22T12:00:00Z')), 'Wednesday');
});

// The KITCHEN is 24 hours: its day is the plain IST calendar date, with NO 04:00
// shift. These lock that it differs from businessDay() in the small hours.
test('kitchen calendar date: 02:00 IST is already the new calendar day (no 04:00 cutoff)', () => {
  // 2026-07-22T20:30:00Z == 2026-07-23 02:00 IST -> calendar date 2026-07-23
  // (businessDay would say 2026-07-22 here; the kitchen must not)
  assert.equal(istCalendarDate(new Date('2026-07-22T20:30:00Z')), '2026-07-23');
});

test('kitchen calendar date: 23:00 IST is that same calendar day', () => {
  // 2026-07-23T17:30:00Z == 2026-07-23 23:00 IST -> 2026-07-23
  assert.equal(istCalendarDate(new Date('2026-07-23T17:30:00Z')), '2026-07-23');
});

test('ymdAddDays and weekdayForYmd (date-picker helpers)', () => {
  assert.equal(ymdAddDays('2026-07-23', -1), '2026-07-22');
  assert.equal(ymdAddDays('2026-03-01', -1), '2026-02-28');
  assert.equal(weekdayForYmd('2026-07-23'), 'Thursday');
});
