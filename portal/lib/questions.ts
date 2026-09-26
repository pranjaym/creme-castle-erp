// Questions on the daily pages (migration 234, 26 Sep 2026). Reads and the
// small helpers the pages share. Every write goes through actions.ts, which
// calls the ops.* database functions; nothing here writes.
//
// A question is attached to a ROW of an area or store page, and the row is
// snapshotted as the labelled fields the page showed at the time of asking
// (Pranjay, 26 Sep 2026: "the whole row, vertical, so one can see what the
// question is about"), so it still reads correctly after a restatement.
import 'server-only';
import { q, one } from '@/lib/db';
import { questionPerms, type SessionUser } from '@/lib/session';

export type QStatus = 'open' | 'answered' | 'closed';
export type AnchorType = 'order' | 'outlet_day' | 'outlet_week';

export interface Field { label: string; value: string }

export interface QuestionRow {
  id: number; raised_by: string; raised_by_name: string | null; outlet_code: string; am: string | null;
  page: 'area' | 'store'; page_date: string; section: string; anchor_type: AnchorType; anchor_key: string;
  platform: 'Z' | 'S' | null; business_date: string | null; row_snapshot: Field[]; prompt: string | null;
  status: QStatus; overdue: boolean; push_backs: number;
  answered_by_name: string | null; what_happened: string | null; cause: string | null; cause_label: string | null;
  person_name: string | null; person_role: string | null; prevention: string | null;
  closed_by_name: string | null;
  raised_at_iso: string; due_at_iso: string; latest_event_at_iso: string;
  answered_at_iso: string | null; closed_at_iso: string | null;
}

export interface EventRow {
  id: number; at_iso: string; actor: string; actor_name: string | null; action: 'asked' | 'answered' | 'pushed_back' | 'closed';
  what_happened: string | null; cause: string | null; cause_label: string | null; person_name: string | null;
  person_role: string | null; prevention: string | null; note: string | null;
}

export interface Cause { code: string; label: string }
export interface Person { id: number; name: string; role: string; outlet_code: string }

// ---------- anchor keys: the stable name of a row ----------
export const orderKey = (app: 'Z' | 'S', oid: string) => `${app}:${oid}`;
export const dayKey = (code: string, date: string, app: 'Z' | 'S' | 'ZS') => `D:${code}:${date}:${app}`;
export const weekKey = (code: string, weekStart: string, metric: string) => `W:${code}:${weekStart}:${metric}`;

// ---------- reads ----------
const COLS = `id, raised_by, raised_by_name, outlet_code, am, page, page_date::text as page_date, section, anchor_type, anchor_key,
  platform, business_date::text as business_date, row_snapshot, prompt, status, overdue, push_backs,
  answered_by_name, what_happened, cause, cause_label, person_name, person_role, prevention, closed_by_name,
  raised_at_iso, due_at_iso, latest_event_at_iso, answered_at_iso, closed_at_iso`;

// The questions a daily page needs: every live one on its outlets, plus the
// closed ones of the last 30 days so a "Closed" chip still shows on the row.
export async function questionsForOutlets(codes: string[]): Promise<Map<string, QuestionRow>> {
  if (!codes.length) return new Map();
  const rows = await q<QuestionRow>(
    `select ${COLS} from ops.v_question
      where outlet_code = any($1::text[])
        and (status <> 'closed' or latest_event_at > now() - interval '30 days')
      order by latest_event_at desc`, [codes]);
  // one row per anchor: the live one wins, else the most recent closed one
  const m = new Map<string, QuestionRow>();
  for (const r of rows) {
    const cur = m.get(r.anchor_key);
    if (!cur || (cur.status === 'closed' && r.status !== 'closed')) m.set(r.anchor_key, r);
  }
  return m;
}

export async function getQuestion(id: number): Promise<QuestionRow | null> {
  return one<QuestionRow>(`select ${COLS} from ops.v_question where id = $1`, [id]);
}

export async function getEvents(id: number): Promise<EventRow[]> {
  return q<EventRow>(`select id, at_iso, actor, actor_name, action, what_happened, cause, cause_label,
      person_name, person_role, prevention, note from ops.v_event where question_id = $1 order by at, id`, [id]);
}

export async function causes(): Promise<Cause[]> {
  return q<Cause>('select code, label from ops.cause order by sort');
}

export async function peopleAt(code: string): Promise<Person[]> {
  return q<Person>(`select id, name, role, outlet_code from ops.person
      where outlet_code = $1 and active and superseded_by is null order by name`, [code]);
}

// ---------- the list page ----------
export interface ListFilters {
  status: '' | QStatus | 'overdue'; store: string; am: string; section: string; cause: string; person: string;
  newonly: boolean; q: string;
}
export function parseListFilters(sp: Record<string, string | undefined>): ListFilters {
  const st = sp.status ?? '';
  return {
    status: (['open', 'answered', 'closed', 'overdue'].includes(st) ? st : '') as ListFilters['status'],
    store: sp.store ?? '', am: sp.am ?? '', section: sp.section ?? '', cause: sp.cause ?? '', person: sp.person ?? '',
    newonly: sp.new === '1', q: sp.q ?? '',
  };
}
export function listQs(f: ListFilters, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  if (f.status) p.set('status', f.status);
  if (f.store) p.set('store', f.store);
  if (f.am) p.set('am', f.am);
  if (f.section) p.set('section', f.section);
  if (f.cause) p.set('cause', f.cause);
  if (f.person) p.set('person', f.person);
  if (f.newonly) p.set('new', '1');
  for (const [k, v] of Object.entries(extra)) { if (v) p.set(k, v); else p.delete(k); }
  const s = p.toString();
  return s ? '?' + s : '';
}

// The outlets a person may see questions on: empty list means all.
export function scopeCodes(u: SessionUser): string[] | null {
  if (u.role === 'area_manager' || u.role === 'store') return u.outletCodes;
  return null;
}

export async function listQuestions(u: SessionUser, f: ListFilters, lastSeenIso: string | null): Promise<QuestionRow[]> {
  const where: string[] = []; const params: unknown[] = [];
  const codes = scopeCodes(u);
  if (codes) { params.push(codes); where.push(`outlet_code = any($${params.length}::text[])`); }
  if (f.status === 'overdue') where.push('overdue');
  else if (f.status) { params.push(f.status); where.push(`status = $${params.length}`); }
  if (f.store) { params.push(f.store); where.push(`outlet_code = $${params.length}`); }
  if (f.am) { params.push(f.am); where.push(`am = $${params.length}`); }
  if (f.section) { params.push(f.section); where.push(`section = $${params.length}`); }
  if (f.cause) { params.push(f.cause); where.push(`cause = $${params.length}`); }
  if (f.person) { params.push(f.person); where.push(`person_name = $${params.length}`); }
  if (f.newonly) {
    if (lastSeenIso) { params.push(lastSeenIso); where.push(`latest_event_at > $${params.length}::timestamptz`); }
  }
  const sql = `select ${COLS} from ops.v_question ${where.length ? 'where ' + where.join(' and ') : ''}
    order by case when overdue then 0 when status = 'open' then 1 when status = 'answered' then 2 else 3 end,
             latest_event_at desc limit 500`;
  return q<QuestionRow>(sql, params);
}

export interface Counts { open: number; overdue: number; answered: number; closed_wk: number; median_hours: number | null }
export async function counts(u: SessionUser): Promise<Counts> {
  const codes = scopeCodes(u);
  const r = await one<{ open: string; overdue: string; answered: string; closed_wk: string; median_hours: string | null }>(
    `select count(*) filter (where status = 'open') as open,
            count(*) filter (where overdue) as overdue,
            count(*) filter (where status = 'answered') as answered,
            count(*) filter (where status = 'closed' and closed_at > now() - interval '7 days') as closed_wk,
            round((percentile_cont(0.5) within group (order by extract(epoch from (answered_at - raised_at))/3600.0)
              filter (where answered_at is not null))::numeric, 1) as median_hours
       from ops.v_question where ($1::text[] is null or outlet_code = any($1::text[]))`, [codes]);
  return {
    open: Number(r?.open ?? 0), overdue: Number(r?.overdue ?? 0), answered: Number(r?.answered ?? 0),
    closed_wk: Number(r?.closed_wk ?? 0), median_hours: r?.median_hours == null ? null : Number(r.median_hours),
  };
}

// What the rail badge and the home line say for this person. Field roles see
// what waits for THEIR answer; central sees what waits for THEIR close.
export interface Waiting { n: number; red: boolean; text: string }
export async function waitingFor(u: SessionUser): Promise<Waiting | null> {
  const p = questionPerms(u);
  if (!p.view) return null;
  const c = await counts(u);
  if (p.ask) {
    const n = c.answered;
    const open = c.open;
    const text = n
      ? `${n} answer${n === 1 ? '' : 's'} waiting for your close, ${open} still open${c.overdue ? ` (${c.overdue} overdue)` : ''}.`
      : open ? `${open} question${open === 1 ? '' : 's'} open${c.overdue ? `, ${c.overdue} overdue` : ''}, no answer waiting for you.`
      : 'No questions waiting.';
    return { n, red: false, text };
  }
  const n = c.open;
  const text = n
    ? `${n} question${n === 1 ? '' : 's'} waiting for your answer${c.overdue ? `, ${c.overdue} overdue` : ''}.`
    : 'No questions waiting for you.';
  return { n, red: c.overdue > 0, text };
}

// The filter dropdowns: what exists, within scope.
export async function filterOptions(u: SessionUser): Promise<{ stores: string[]; ams: string[]; sections: string[]; people: string[] }> {
  const codes = scopeCodes(u);
  const rows = await q<{ k: string; v: string }>(
    `select 'store' k, outlet_code v from ops.v_question where ($1::text[] is null or outlet_code = any($1::text[])) group by 2
     union all select 'am', am from ops.v_question where am is not null and ($1::text[] is null or outlet_code = any($1::text[])) group by 2
     union all select 'section', section from ops.v_question where ($1::text[] is null or outlet_code = any($1::text[])) group by 2
     union all select 'person', person_name from ops.v_question where person_name is not null and ($1::text[] is null or outlet_code = any($1::text[])) group by 2
     order by 1, 2`, [codes]);
  const pick = (k: string) => rows.filter(r => r.k === k).map(r => r.v);
  return { stores: pick('store'), ams: pick('am'), sections: pick('section'), people: pick('person') };
}

// Moves this person's "last looked" cursor to now and returns the previous
// value, which is what "new since you last looked" compares against.
export async function touchLastSeen(email: string): Promise<string | null> {
  const r = await one<{ prev: string | null }>(
    `select to_char(ops.touch_last_seen($1) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as prev`, [email]);
  return r?.prev ?? null;
}

// ---------- formatting (IST, plain words) ----------
export function fmtIst(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(',', '').replace(' am', ' am').replace(' pm', ' pm');
}
export function ago(iso: string): string {
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
export function chipLabel(r: QuestionRow): string {
  if (r.status === 'closed') return 'Closed';
  if (r.status === 'answered') return `Answered by ${firstName(r.answered_by_name)}`;
  if (r.overdue) return `Overdue, asked ${ago(r.raised_at_iso)} ago`;
  return `Asked by ${firstName(r.raised_by_name)}, ${ago(r.raised_at_iso)}`;
}
export function chipClass(r: QuestionRow): string {
  if (r.status === 'closed') return 'closed';
  if (r.status === 'answered') return 'answered';
  return r.overdue ? 'overdue' : 'open';
}
export function firstName(name: string | null | undefined): string {
  if (!name) return 'someone';
  return name.replace(/\s*\(.*\)\s*$/, '').split(' ')[0];
}
export function statusWord(r: QuestionRow): string {
  if (r.status === 'closed') return 'closed';
  if (r.status === 'answered') return 'answered';
  return r.overdue ? 'overdue' : 'open';
}
