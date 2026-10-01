// The Live status wall: the newest spot check the Petpooja robot has painted.
//
// The robot (Rishabh's CC-Server_side, not this repo) builds the spot check at
// its scheduled hours and uploads the finished HTML to the private spine bucket
// `spotcheck-live`, one file per paint, never overwritten:
//
//   live/<YYYY-MM-DD>/spotcheck_<YYYY-MM-DD>_<HHMMSS>__<MACHINE>.html
//   live/_status.json   the pointer to the newest paint, plus the robot's hours
//
// Its test paints go under `test/`, which the deployed wall never reads, so a
// test run on a laptop can never show up there. Only a local portal started
// with LIVE_WALL_AREA=test reads them, to try the whole path end to end. The portal only reads here,
// the same way it reads the daily dashboards; it never writes. Server-only.
import 'server-only';
import { spine } from '@/lib/supabase/service';

const BUCKET = process.env.LIVE_WALL_BUCKET || 'spotcheck-live';
const AREA = process.env.LIVE_WALL_AREA === 'test' ? 'test' : 'live';
const PAINT_RE = /^spotcheck_(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})__([A-Za-z0-9-]{1,40})\.html$/;
const PATH_RE = new RegExp(`^${AREA}/(\\d{4}-\\d{2}-\\d{2})/(spotcheck_[A-Za-z0-9_-]+\\.html)$`);

// Minutes after a scheduled hour before a missing paint counts as late. The
// spot check runs right after S1 refreshes the sheet, which can itself retry.
const GRACE_MIN = 60;
const IST_MS = 330 * 60 * 1000;

export interface Paint {
  path: string;     // object path inside the bucket
  date: string;     // YYYY-MM-DD (IST)
  time: string;     // HH:MM (IST)
  machine: string;  // the computer that painted it
}

export interface WallStatus {
  latest: Paint;
  paintedAt: Date;
  hours: number[];  // the robot's spot check hours, as it last reported them
}

export interface Freshness {
  stale: boolean;
  ageText: string;     // "12 min ago", "3 h 5 min ago"
  message: string;     // one plain sentence for the banner
  notToday: boolean;   // the newest paint is from an earlier day
}

function paintFromPath(path: string): Paint | null {
  const m = PATH_RE.exec(path);
  if (!m) return null;
  const p = PAINT_RE.exec(m[2]);
  if (!p) return null;
  return { path, date: p[1], time: `${p[2]}:${p[3]}`, machine: p[5] };
}

// The wall clock in India, as plain parts, whatever zone the server runs in.
function ist(d: Date) {
  const t = new Date(d.getTime() + IST_MS);
  return {
    date: t.toISOString().slice(0, 10),
    hour: t.getUTCHours(),
    y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(),
  };
}
// An IST date + hour as a real instant.
function istInstant(y: number, m: number, d: number, hour: number): Date {
  return new Date(Date.UTC(y, m, d, hour, 0, 0) - IST_MS);
}

export function todayIst(now = new Date()): string {
  return ist(now).date;
}

// The robot's pointer to its newest paint. Null when nothing is painted yet.
export async function readStatus(): Promise<WallStatus | null> {
  const { data, error } = await spine().storage.from(BUCKET).download(`${AREA}/_status.json`);
  if (error || !data) return null;
  try {
    const j = JSON.parse(await data.text());
    const latest = paintFromPath(String(j.file ?? ''));
    const paintedAt = new Date(String(j.painted_at ?? ''));
    if (!latest || isNaN(paintedAt.getTime())) return null;
    const hours = Array.isArray(j.hours)
      ? [...new Set<number>(j.hours.map(Number).filter((h: number) => Number.isInteger(h) && h >= 0 && h <= 23))].sort((a, b) => a - b)
      : [];
    return { latest, paintedAt, hours };
  } catch {
    return null;
  }
}

// Every paint of one day, newest first.
export async function listPaints(date: string): Promise<Paint[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  const { data, error } = await spine()
    .storage.from(BUCKET)
    .list(`${AREA}/${date}`, { limit: 200, sortBy: { column: 'name', order: 'desc' } });
  if (error || !data) return [];
  const out: Paint[] = [];
  for (const obj of data) {
    const p = paintFromPath(`${AREA}/${date}/${obj.name}`);
    if (p) out.push(p);
  }
  out.sort((a, b) => (a.path < b.path ? 1 : a.path > b.path ? -1 : 0));
  return out;
}

// One paint's HTML. Only paths under live/ that match the robot's naming are
// served, so the query string cannot be used to read anything else.
export async function getPaintHtml(path: string): Promise<string | null> {
  if (!paintFromPath(path)) return null;
  const { data, error } = await spine().storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return await data.text();
}

export function isPaintPath(path: string): boolean {
  return paintFromPath(path) !== null;
}

function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60), r = min % 60;
  if (h < 48) return r ? `${h} h ${r} min ago` : `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

// Is the wall up to date? A wall that has quietly stopped looks exactly like a
// current one, so this is what the banner says out loud. The next paint is due
// at the robot's next scheduled hour after the last one; it is late once that
// hour plus the grace has passed. With no schedule reported, three hours.
export function freshness(s: WallStatus, now = new Date()): Freshness {
  const age = now.getTime() - s.paintedAt.getTime();
  const p = ist(s.paintedAt);
  const notToday = p.date !== ist(now).date;

  let due: Date;
  let dueLabel: string;
  if (s.hours.length) {
    const later = s.hours.find(h => h > p.hour);
    if (later !== undefined) {
      due = istInstant(p.y, p.m, p.d, later);
      dueLabel = `${String(later).padStart(2, '0')}:00`;
    } else {
      due = istInstant(p.y, p.m, p.d + 1, s.hours[0]);
      dueLabel = `${String(s.hours[0]).padStart(2, '0')}:00`;
    }
  } else {
    due = new Date(s.paintedAt.getTime() + 2 * 3600 * 1000);
    dueLabel = 'the next run';
  }
  const stale = now.getTime() > due.getTime() + GRACE_MIN * 60 * 1000;

  let message: string;
  if (stale) {
    message = `The ${dueLabel} paint has not arrived. The robot may be switched off or stuck, so these figures are older than they look.`;
  } else if (notToday) {
    message = `No paint yet today. This is the last one from ${s.latest.date}; today's first is due at ${dueLabel}.`;
  } else {
    message = `Next paint due at ${dueLabel}.`;
  }
  return { stale, ageText: ago(age), message, notToday };
}
