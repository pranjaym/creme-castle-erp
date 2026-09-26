'use server';

// Every write in the Questions module. Each action re-checks the caller and
// their outlet scope, then calls ONE database function from migration 234,
// which does the work and writes the trail. The portal never writes an ops
// table directly. After a write the person lands back where they were, with
// the drawer open on that question and a one-line result.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser, questionPerms, type SessionUser } from '@/lib/session';
import { q, one } from '@/lib/db';

const who = (u: SessionUser) => u.fullName ?? u.email;
const str = (v: FormDataEntryValue | null): string | null => { const s = typeof v === 'string' ? v.trim() : ''; return s === '' ? null : s; };
const plain = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^error: /i, '').split('\n')[0];

function withQs(back: string, extra: Record<string, string>): string {
  const [path, qs] = back.split('?');
  const p = new URLSearchParams(qs ?? '');
  p.delete('ask'); p.delete('ok'); p.delete('err');
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}
function safeBack(v: string | null): string {
  // only ever a path inside the portal
  return v && v.startsWith('/') && !v.startsWith('//') ? v : '/questions';
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
async function needAnswer(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u || !questionPerms(u).answer) redirect('/questions');
  return u;
}
// An area manager or a store may answer only on their own outlets.
function inScope(u: SessionUser, outlet: string): boolean {
  return u.role === 'admin' || u.outletCodes.includes(outlet);
}
async function needClose(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u || !questionPerms(u).close) redirect('/questions');
  return u;
}

export async function askQuestion(form: FormData) {
  const u = await needAsk();
  const back = safeBack(str(form.get('back')));
  const key = str(form.get('anchor_key')); const outlet = str(form.get('outlet'));
  if (!key || !outlet) redirect(withQs(back, { err: 'No row was posted.' }));
  let snapshot: unknown = [];
  try { snapshot = JSON.parse(str(form.get('snapshot')) ?? '[]'); } catch { snapshot = []; }
  let id: number;
  try {
    const r = await one<{ id: string }>('select ops.ask($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10::date,$11::jsonb,$12) as id', [
      u.email, who(u), outlet, str(form.get('page')) ?? 'area', str(form.get('page_date')), str(form.get('section')) ?? '',
      str(form.get('anchor_type')) ?? 'order', key, str(form.get('platform')), str(form.get('business_date')),
      JSON.stringify(snapshot), str(form.get('prompt'))]);
    id = Number(r?.id);
  } catch (e) { redirect(withQs(back, { err: plain(e) })); }
  refresh(back);
  redirect(withQs(back, { q: String(id), ok: 'Asked. It now waits for the area manager.' }));
}

export async function answerQuestion(form: FormData) {
  const u = await needAnswer();
  const id = Number(str(form.get('id')));
  const back = safeBack(str(form.get('back')));
  const row = await one<{ outlet_code: string }>('select outlet_code from ops.question where id = $1', [id]);
  if (!row) redirect(withQs(back, { err: 'No such question.' }));
  if (!inScope(u, row.outlet_code)) redirect('/questions');
  try {
    await q('select ops.answer($1,$2,$3,$4,$5,$6,$7,$8)', [
      id, u.email, who(u), str(form.get('what')), str(form.get('cause')), str(form.get('person')),
      str(form.get('person_role')), str(form.get('prevention'))]);
  } catch (e) { redirect(withQs(back, { q: String(id), err: plain(e) })); }
  refresh(back);
  redirect(withQs(back, { q: String(id), ok: 'Sent. It now waits to be accepted.' }));
}

export async function closeQuestion(form: FormData) {
  const u = await needClose();
  const id = Number(str(form.get('id')));
  const back = safeBack(str(form.get('back')));
  try { await q('select ops.close($1,$2,$3,$4)', [id, u.email, who(u), str(form.get('note'))]); }
  catch (e) { redirect(withQs(back, { q: String(id), err: plain(e) })); }
  refresh(back);
  redirect(withQs(back, { q: String(id), ok: 'Closed.' }));
}

export async function pushBackQuestion(form: FormData) {
  const u = await needClose();
  const id = Number(str(form.get('id')));
  const back = safeBack(str(form.get('back')));
  try { await q('select ops.push_back($1,$2,$3,$4)', [id, u.email, who(u), str(form.get('note'))]); }
  catch (e) { redirect(withQs(back, { q: String(id), err: plain(e) })); }
  refresh(back);
  redirect(withQs(back, { q: String(id), ok: 'Pushed back. It is open again with a fresh 24 hours.' }));
}
