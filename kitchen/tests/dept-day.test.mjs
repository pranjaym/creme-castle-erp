// Department-day rule tests (pure, no clock, no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { currentDeptDay, parseTimeToMinutes, istMinutesOfDay } from '../lib/dept-day.mjs';

// Helper: a Date at the given IST wall-clock moment.
const ist = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00+05:30`);

test('sponge dept (day starts 21:00): closing at 20:30 closes the day that started yesterday', () => {
  // The sponge day labelled 19 Aug runs 21:00 on 19 Aug to 20:59 on 20 Aug.
  assert.equal(currentDeptDay(ist('2026-08-20', '20:30'), '21:00'), '2026-08-19');
});

test('sponge dept: at 21:00 sharp the new day opens (labelled today)', () => {
  assert.equal(currentDeptDay(ist('2026-08-20', '21:00'), '21:00'), '2026-08-20');
  assert.equal(currentDeptDay(ist('2026-08-20', '23:59'), '21:00'), '2026-08-20');
});

test('sponge dept: a 1am batch belongs to the day that started the evening before', () => {
  assert.equal(currentDeptDay(ist('2026-08-20', '01:00'), '21:00'), '2026-08-19');
});

test('liquids dept (day starts 07:00): closing at 06:30 closes yesterday-labelled day', () => {
  assert.equal(currentDeptDay(ist('2026-08-21', '06:30'), '07:00'), '2026-08-20');
});

test('liquids dept: mid-morning the open day is today', () => {
  assert.equal(currentDeptDay(ist('2026-08-20', '08:00'), '07:00'), '2026-08-20');
});

test('month and year boundaries roll correctly', () => {
  assert.equal(currentDeptDay(ist('2026-09-01', '02:00'), '21:00'), '2026-08-31');
  assert.equal(currentDeptDay(ist('2027-01-01', '05:00'), '07:00'), '2026-12-31');
});

test('parseTimeToMinutes accepts HH:MM and HH:MM:SS', () => {
  assert.equal(parseTimeToMinutes('21:00'), 1260);
  assert.equal(parseTimeToMinutes('06:30:00'), 390);
  assert.equal(parseTimeToMinutes('7:05'), 425);
});

test('istMinutesOfDay converts a UTC instant to IST wall minutes', () => {
  // 15:30 UTC = 21:00 IST
  assert.equal(istMinutesOfDay(new Date('2026-08-19T15:30:00Z')), 21 * 60);
});
