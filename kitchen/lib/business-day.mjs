// Canonical display-side business-day rule (mirrors SQL business_day() in
// 000_foundation.sql): 04:00 IST to 03:59 IST next day. Single source; the .ts
// re-exports this so the app and the tests share one implementation.
// Pure and deterministic.

const IST_OFFSET_MIN = 5 * 60 + 30; // +05:30
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The SALES business day (YYYY-MM-DD), by the 04:00 IST rule. Front-of-house only:
 * outlets, POS, reconciliation, console feed. Do NOT use for kitchen production,
 * which runs 24 hours and has no dead-hour cutoff (use istCalendarDate instead).
 */
export function businessDay(ts = new Date()) {
  const istMs = ts.getTime() + IST_OFFSET_MIN * 60_000;
  const shifted = new Date(istMs - 4 * 60 * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The plain IST calendar date (YYYY-MM-DD), midnight to midnight. This is the
 * kitchen/back-of-house production day: the kitchen is online 24 hours, so it has
 * no 04:00 cutoff. The 04:00 sales rule (businessDay) never touches production.
 */
export function istCalendarDate(ts = new Date()) {
  const istMs = ts.getTime() + IST_OFFSET_MIN * 60_000;
  return new Date(istMs).toISOString().slice(0, 10);
}

/** Weekday label, IST (both sibling apps show weekday on every date). */
export function istWeekday(ts = new Date()) {
  const istMs = ts.getTime() + IST_OFFSET_MIN * 60_000;
  const d = new Date(istMs);
  return WEEKDAYS[d.getUTCDay()];
}

/** Add n days to a business-day string (YYYY-MM-DD). n may be negative. */
export function ymdAddDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** Weekday label for a bare business-day string (YYYY-MM-DD), no clock involved. */
export function weekdayForYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
