// Read the daily dashboards out of the spine Storage bucket that run_daily.py
// writes to. Objects are named cc_daily_<YYYY-MM-DD>.html, so the date sorts
// chronologically. Server-only (uses the service-role client).
import 'server-only';
import { spine } from '@/lib/supabase/service';

const BUCKET = process.env.DASH_HTML_BUCKET || 'dashboard-html';
const NAME_RE = /^cc_daily_(\d{4}-\d{2}-\d{2})\.html$/;

export interface DashboardEntry {
  date: string; // YYYY-MM-DD
  name: string; // object name in the bucket
}

// All dashboards, newest first. Empty list if the bucket is missing or empty.
export async function listDashboards(): Promise<DashboardEntry[]> {
  const { data, error } = await spine()
    .storage.from(BUCKET)
    .list('', { limit: 1000, sortBy: { column: 'name', order: 'desc' } });
  if (error || !data) return [];
  const out: DashboardEntry[] = [];
  for (const obj of data) {
    const m = NAME_RE.exec(obj.name);
    if (m) out.push({ date: m[1], name: obj.name });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

export async function latestDashboard(): Promise<DashboardEntry | null> {
  const all = await listDashboards();
  return all[0] ?? null;
}

// Fetch one dashboard's HTML. Returns null if the date is unknown / not present.
export async function getDashboardHtml(date: string): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const { data, error } = await spine()
    .storage.from(BUCKET)
    .download(`cc_daily_${date}.html`);
  if (error || !data) return null;
  return await data.text();
}

// Nice display: "23 Jul 2026 (Thursday)". Parsed as a plain calendar date.
export function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = dt.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const mon = dt.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${d} ${mon} ${y} (${wd})`;
}
