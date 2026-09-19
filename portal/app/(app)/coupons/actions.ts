'use server';

// Every write in the coupon module. Each action re-checks the caller, then calls
// ONE database function from migration 232, which does the work and writes the
// audit row. The portal never writes a coupons table directly.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser, couponPerms, type SessionUser } from '@/lib/session';
import { q } from '@/lib/db';

async function needEdit(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u || !couponPerms(u).edit) redirect('/coupons');
  return u;
}
const who = (u: SessionUser) => u.fullName ? `${u.fullName} <${u.email}>` : u.email;
function bounce(to: string, msg: string, kind: 'ok' | 'err' = 'ok'): never {
  redirect(`${to}${to.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(msg)}`);
}
const str = (v: FormDataEntryValue | null): string | null => { const s = typeof v === 'string' ? v.trim() : ''; return s === '' ? null : s; };
const numv = (v: FormDataEntryValue | null): number | null => { const s = str(v); if (s == null) return null; const n = Number(s); return Number.isFinite(n) ? n : null; };
const plain = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^error: /i, '').split('\n')[0];
function refresh() { revalidatePath('/coupons', 'layout'); }

export async function saveCoupon(form: FormData) {
  const u = await needEdit();
  const back = str(form.get('back')) ?? '/coupons/glossary';
  const platform = str(form.get('platform')); const code = str(form.get('code'));
  if (!platform || !code) bounce(back, 'No coupon was posted.', 'err');
  try {
    await q('select coupons.save_coupon($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [platform, code, str(form.get('what_it_is')), str(form.get('kind')), str(form.get('for_whom')), str(form.get('segment')), str(form.get('status')) ?? 'active', str(form.get('notes')), who(u)]);
  } catch (e) { bounce(back, plain(e), 'err'); }
  refresh(); bounce(back, `Saved ${code}.`);
}

export async function setDeal(form: FormData) {
  const u = await needEdit();
  const back = str(form.get('back')) ?? '/coupons/deals';
  const platform = str(form.get('platform')); const code = str(form.get('code'))?.toUpperCase() ?? null;
  const pct = numv(form.get('pct')); const from = str(form.get('from')) ?? new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const outlet = str(form.get('outlet'));
  if (!platform || !code) bounce(back, 'Platform and coupon name are needed.', 'err');
  if (pct == null || pct < 0 || pct > 100) bounce(back, 'The agreed share must be a number between 0 and 100.', 'err');
  try {
    await q('select coupons.set_deal($1,$2,$3,$4,$5,$6,$7,$8)', [platform, code, outlet, pct, from, str(form.get('agreed_with')), str(form.get('note')), who(u)]);
  } catch (e) { bounce(back, plain(e), 'err'); }
  refresh(); bounce(back, `Deal saved: ${code} at most ${pct}% ours${outlet ? ' at ' + outlet : ''}, from ${from}.`);
}

export async function setTolerance(form: FormData) {
  const u = await needEdit();
  const t = numv(form.get('tolerance'));
  if (t == null || t < 0 || t > 10) bounce('/coupons/deals', 'Tolerance is a number of points between 0 and 10.', 'err');
  try { await q('select coupons.set_setting($1,$2,$3)', ['tolerance_pts', String(t), who(u)]); }
  catch (e) { bounce('/coupons/deals', plain(e), 'err'); }
  refresh(); bounce('/coupons/deals', `Tolerance set to ${t} points.`);
}
