'use server';

// The two bulk writes of "Issues to Ask" (14 Oct 2026). Both re-check the
// caller, then call the Questions module's own database functions (migration
// 234), one row at a time, so a question raised here is the same record the
// area manager sees on their page and on /questions. No new ops function and
// no direct write to an ops table.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser, questionPerms, type SessionUser } from '@/lib/session';
import { q, one, tx } from '@/lib/db';
import { listIssues, issueFields, sectionOf, type IssueRow } from '@/lib/issues';

const who = (u: SessionUser) => u.fullName ?? u.email;
const str = (v: FormDataEntryValue | null): string | null => { const s = typeof v === 'string' ? v.trim() : ''; return s === '' ? null : s; };
const plain = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^error: /i, '').split('\n')[0];
const MAX_KEYS = 300;   // one bulk action is one screen of ticks, never a whole month

function withQs(back: string, extra: Record<string, string>): string {
  const [path, qs] = back.split('?');
  const p = new URLSearchParams(qs ?? '');
  p.delete('ask'); p.delete('q'); p.delete('ok'); p.delete('err');
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}
function safeBack(v: string | null): string {
  return v && v.startsWith('/daily/issues') ? v : '/daily/issues';
}
function refresh(back: string) {
  revalidatePath(back.split('?')[0]);
  revalidatePath('/questions');
  revalidatePath('/', 'layout');
}
async function needAsk(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u || !questionPerms(u).ask) redirect('/questions');
  return u;
}
async function needClose(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u || !questionPerms(u).close) redirect('/questions');
  return u;
}
function keysOf(form: FormData): string[] {
  const raw = [...form.getAll('key'), ...(str(form.get('keys')) ?? '').split('\n')].map(v => String(v).trim()).filter(Boolean);
  return [...new Set(raw)].slice(0, MAX_KEYS);
}
// The issue rows behind a set of keys, read from the same table the page shows.
async function rowsFor(keys: string[]): Promise<Map<string, IssueRow>> {
  const dates = await q<{ mn: string; mx: string }>(
    'select min(business_date)::text as mn, max(business_date)::text as mx from public.dash_issue where anchor_key = any($1::text[])', [keys]);
  if (!dates[0]?.mn) return new Map();
  const all = await listIssues(dates[0].mn, dates[0].mx);
  const want = new Set(keys);
  return new Map(all.filter(r => want.has(r.anchor_key)).map(r => [r.anchor_key, r]));
}
async function liveQuestion(key: string): Promise<{ id: string; status: string } | null> {
  return one<{ id: string; status: string }>("select id::text as id, status from ops.question where anchor_key = $1 and status <> 'closed'", [key]);
}
// A row whose last question is already closed needs nothing from a Close: the
// same selection posted twice on 15 Oct 2026 made 71 duplicate "seen" records
// (F75) because this check was missing.
async function closedQuestion(key: string): Promise<{ id: string } | null> {
  return one<{ id: string }>("select id::text as id from ops.question where anchor_key = $1 and status = 'closed' order by id desc limit 1", [key]);
}
const askArgs = (u: SessionUser, r: IssueRow, pageDate: string, prompt: string | null) => [
  u.email, who(u), r.outlet_code, 'issues', pageDate, sectionOf(r),
  r.order_id ? 'order' : 'outlet_day', r.anchor_key, r.platform, r.business_date,
  JSON.stringify(issueFields(r)), prompt];

// Ask on every selected row that has no live question, with the same words.
export async function askMany(form: FormData) {
  const u = await needAsk();
  const back = safeBack(str(form.get('back')));
  const keys = keysOf(form);
  if (!keys.length) redirect(withQs(back, { err: 'No rows were selected.' }));
  const prompt = str(form.get('prompt'));
  const pageDate = str(form.get('page_date')) ?? new Date().toISOString().slice(0, 10);
  const rows = await rowsFor(keys);
  let asked = 0, skipped = 0, lastId: string | null = null;
  try {
    for (const key of keys) {
      const r = rows.get(key);
      if (!r) { skipped++; continue; }
      if (await liveQuestion(key)) { skipped++; continue; }
      const res = await one<{ id: string }>('select ops.ask($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10::date,$11::jsonb,$12)::text as id', askArgs(u, r, pageDate, prompt));
      lastId = res?.id ?? null; asked++;
    }
  } catch (e) { redirect(withQs(back, { err: plain(e) })); }
  refresh(back);
  const extra: Record<string, string> = { ok: `Asked on ${asked} row${asked === 1 ? '' : 's'}${skipped ? `, ${skipped} skipped (already asked or not on the page)` : ''}.` };
  if (asked === 1 && lastId) extra.q = lastId;
  redirect(withQs(back, extra));
}

// Close every selected row. An answered question is accepted; an open one is
// closed without an answer; a row nobody asked about gets a question born
// closed with the note, so the decision that it needed no explanation is on
// the record (Pranjay, 14 Oct 2026: "yes to all four").
export async function closeMany(form: FormData) {
  const u = await needClose();
  const back = safeBack(str(form.get('back')));
  const keys = keysOf(form);
  if (!keys.length) redirect(withQs(back, { err: 'No rows were selected.' }));
  const note = str(form.get('note')) ?? 'Seen, no explanation needed.';
  const pageDate = str(form.get('page_date')) ?? new Date().toISOString().slice(0, 10);
  const rows = await rowsFor(keys);
  let closed = 0, seen = 0, skipped = 0;
  try {
    for (const key of keys) {
      const live = await liveQuestion(key);
      if (live) {
        await q('select ops.close($1,$2,$3,$4)', [live.id, u.email, who(u), note]);
        closed++; continue;
      }
      if (await closedQuestion(key)) { skipped++; continue; }   // already closed: a repeat post, nothing to do
      const r = rows.get(key);
      if (!r) { skipped++; continue; }
      await tx(async (c) => {
        const res = await c.q<{ id: string }>('select ops.ask($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10::date,$11::jsonb,$12)::text as id',
          askArgs(u, r, pageDate, 'Closed without a question.'));
        await c.q('select ops.close($1,$2,$3,$4)', [res[0].id, u.email, who(u), note]);
      });
      seen++;
    }
  } catch (e) { redirect(withQs(back, { err: plain(e) })); }
  refresh(back);
  redirect(withQs(back, { ok: `Closed ${closed + seen} row${closed + seen === 1 ? '' : 's'}${closed ? ` (${closed} explanation${closed === 1 ? '' : 's'} accepted)` : ''}${seen ? ` (${seen} marked seen, no explanation needed)` : ''}${skipped ? `, ${skipped} already closed or not on the page` : ''}.` }));
}
