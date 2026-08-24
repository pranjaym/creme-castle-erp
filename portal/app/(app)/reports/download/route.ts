// Streams a report as CSV, gated by login. Validates the report key and the date
// window, then streams straight from the spine's private landing schema.
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/session';
import {
  REPORTS, MAX_RANGE_DAYS, isValidDate, daysBetween, fetchReportRows, rowsToCsvStream,
} from '@/lib/reports';

// Large item exports page through many REST calls; give them room (Vercel Pro).
export const maxDuration = 300;

export async function GET(req: Request) {
  const user = await requireUser();
  if (!['admin', 'central', 'viewer'].includes(user.role)) return bad('Not allowed for this role.');
  const url = new URL(req.url);
  const reportKey = url.searchParams.get('report') || '';
  const from = url.searchParams.get('from') || '';
  const to = url.searchParams.get('to') || '';

  const def = REPORTS[reportKey];
  if (!def) return bad('Unknown report.');
  if (!def.dateless) {
    if (!isValidDate(from) || !isValidDate(to)) return bad('Pick a valid from and to date.');
    if (from > to) return bad('The from date is after the to date.');
    const span = daysBetween(from, to);
    if (span > MAX_RANGE_DAYS) {
      return bad(`That range is ${span + 1} days. Keep a single download to ${MAX_RANGE_DAYS} days or fewer.`);
    }
  }

  // Run the query first so a DB failure returns a clean 500, never a header-only file.
  let rows: unknown[][];
  try {
    rows = await fetchReportRows(def, from, to);
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'unknown error';
    return new NextResponse(`Could not read the report from the database: ${detail}`, {
      status: 500, headers: { 'Content-Type': 'text/plain' },
    });
  }

  const filename = def.dateless ? `${def.filenameStem}.csv` : `${def.filenameStem}_${from}_to_${to}.csv`;
  const body = rowsToCsvStream(def, rows);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

function bad(message: string) {
  return new NextResponse(message, { status: 400, headers: { 'Content-Type': 'text/plain' } });
}
