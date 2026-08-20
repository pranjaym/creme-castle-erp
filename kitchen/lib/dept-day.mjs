// Per-department production day (department module, 19 Aug 2026).
// There is NO company-wide day end. Each department's day runs from its
// day_start_time (IST) to the next day_start_time, and the physical closing
// count happens just before the next day starts (paper registers: sponges
// close 20:30 for a 21:00 start, liquids close 06:30 for a 07:00 start).
//
// The day is LABELLED by the IST calendar date it STARTED on. So the sponge
// day labelled 19 Aug runs 21:00 on 19 Aug to 20:59 on 20 Aug, and the count
// taken at 20:30 on 20 Aug closes the day labelled 19 Aug.
//
// Pure and deterministic: no default clock, the caller passes the time.

import { istCalendarDate, ymdAddDays } from './business-day.mjs';

const IST_OFFSET_MIN = 5 * 60 + 30;

/** Minutes since IST midnight for a timestamp. */
export function istMinutesOfDay(ts) {
  const istMs = ts.getTime() + IST_OFFSET_MIN * 60_000;
  const d = new Date(istMs);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** Parse 'HH:MM' or 'HH:MM:SS' into minutes since midnight. */
export function parseTimeToMinutes(hhmm) {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})/);
  if (!m) throw new Error(`Bad time: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * The department day currently OPEN at ts (YYYY-MM-DD): the day that started
 * most recently. Before day_start the open day started yesterday; at or after
 * day_start it started today. This is also the day a closing count taken now
 * would close.
 */
export function currentDeptDay(ts, dayStartTime) {
  const today = istCalendarDate(ts);
  const nowMin = istMinutesOfDay(ts);
  const startMin = parseTimeToMinutes(dayStartTime);
  return nowMin >= startMin ? today : ymdAddDays(today, -1);
}
