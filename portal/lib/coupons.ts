// Reads for the coupon sharing module. Every query goes to the coupons schema
// (migration 232) through lib/db.ts. The arithmetic per order lives in the
// database (coupons.refresh_day); this file aggregates it for the screens and
// applies the one rule Pranjay set on 19 Sep 2026: flag only when the platform
// paid LESS than agreed (our share above the agreed maximum); when they fund
// more, stay quiet.
import 'server-only';
import { q, one } from '@/lib/db';

const n0 = (v: unknown): number => Number(v ?? 0);
const nn = (v: unknown): number | null => (v == null ? null : Number(v));

export type Platform = 'zomato' | 'swiggy';
export interface Filters { from: string; to: string; platform: Platform | null; city: string | null; outlet: string | null }

// ---------- dates ----------
export function istToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}
export function shift(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
// Default window: the last 7 days ending yesterday (IST). Yesterday's Zomato half
// only completes after the evening pull, so the page also shows the match rate.
export function parseFilters(sp: Record<string, string | undefined>): Filters {
  const today = istToday();
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '') ? (sp.to as string) : shift(today, -1);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? (sp.from as string) : shift(to, -6);
  const platform = sp.p === 'zomato' || sp.p === 'swiggy' ? sp.p : null;
  return { from: from <= to ? from : to, to, platform, city: sp.city || null, outlet: sp.outlet || null };
}
export function qs(f: Filters, extra: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams();
  const all: Record<string, string | null | undefined> = { from: f.from, to: f.to, p: f.platform, city: f.city, outlet: f.outlet, ...extra };
  for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
  const s = p.toString(); return s ? '?' + s : '';
}
export function dateLabel(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
export function dayLabel(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ---------- formatting ----------
export const inr = (v: number | null | undefined): string => v == null ? '' : '₹' + Math.round(v).toLocaleString('en-IN');
export const lakh = (v: number | null | undefined): string => v == null ? '' : '₹' + (v / 100000).toFixed(1) + 'L';
export const pct = (v: number | null | undefined, d = 1): string => v == null ? '' : v.toFixed(d) + '%';
export const num = (v: number | null | undefined): string => v == null ? '' : Math.round(v).toLocaleString('en-IN');

// ---------- the status rule ----------
export type StatusKey = 'ok' | 'more' | 'red' | 'allours' | 'nolist';
export const STATUS_LABEL: Record<StatusKey, string> = {
  ok: 'On deal', more: 'They fund more', red: 'Above deal: they pay less', allours: 'All ours (100%)', nolist: 'No deal recorded',
};
export const STATUS_CHIP: Record<StatusKey, string> = { ok: 'c-ok', more: 'c-more', red: 'c-red', allours: 'c-grey', nolist: 'c-amber' };
export const STATUS_HEAT: Record<StatusKey, string> = { ok: 'h-ok', more: 'h-more', red: 'h-red', allours: 'h-grey', nolist: 'h-amb' };
export function status(share: number | null, agreed: number | null, tol: number): StatusKey {
  if (agreed == null) return 'nolist';
  if (agreed >= 99.5) return 'allours';
  if (share == null) return 'nolist';
  if (share > agreed + tol) return 'red';
  if (share < agreed - tol) return 'more';
  return 'ok';
}

export async function tolerance(): Promise<number> {
  const r = await one<{ value: string }>(`select value from coupons.setting where key = 'tolerance_pts'`);
  const t = r ? Number(r.value) : 0.5; return Number.isFinite(t) ? t : 0.5;
}

// ---------- filter fragments ----------
// $1 = from, $2 = to, then optional platform/city/outlet appended in order.
function where(f: Filters, alias = 'o'): { sql: string; params: unknown[] } {
  const params: unknown[] = [f.from, f.to];
  let sql = `${alias}.business_date between $1 and $2`;
  if (f.platform) { params.push(f.platform); sql += ` and ${alias}.platform = $${params.length}`; }
  if (f.city) { params.push(f.city); sql += ` and ${alias}.city = $${params.length}`; }
  if (f.outlet) { params.push(f.outlet); sql += ` and ${alias}.outlet_code = $${params.length}`; }
  return { sql, params };
}

// the deal that applies to an order row, outlet-specific first, then network-wide
const DEAL_LATERAL = `left join lateral (
    select d.max_our_share_pct from coupons.deal d
    where d.platform = o.platform and d.code = o.code
      and d.effective_from <= o.business_date and (d.effective_to is null or d.effective_to >= o.business_date)
      and (d.outlet_code = o.outlet_code or d.outlet_code is null)
    order by d.outlet_code nulls last, d.effective_from desc limit 1) dl on true`;

// ---------- summary: Total / Zomato / Swiggy, this period and the one before ----------
export interface SummaryRow {
  platform: Platform | 'total'; orders: number; coupon_orders: number; burn: number; ours: number; theirs: number; extras: number; avg_bill: number | null;
  share: number | null; above_deal: number;
  p_orders: number; p_coupon_orders: number; p_burn: number; p_ours: number; p_theirs: number; p_share: number | null;
}
async function summaryFor(f: Filters) {
  const w = where(f);
  const rows = await q(`
    select o.platform, count(*) filter (where o.is_coupon) coupon_orders,
           sum(o.burn) filter (where o.is_coupon) burn, sum(o.ours) filter (where o.is_coupon) ours, sum(o.theirs) filter (where o.is_coupon) theirs,
           sum(o.extras) extras, avg(o.bill) filter (where o.is_coupon and o.bill > 0) avg_bill,
           sum(greatest(0, o.ours - dl.max_our_share_pct * o.burn / 100)) filter (where o.is_coupon and dl.max_our_share_pct is not null and dl.max_our_share_pct < 99.5) above_deal
    from coupons.order_share o ${DEAL_LATERAL}
    where ${w.sql} group by o.platform`, w.params);
  // all orders, both platforms, from Petpooja (Swiggy's file only lists coupon orders)
  const wp: unknown[] = [f.from, f.to];
  let extra = '';
  if (f.city) { wp.push(f.city); extra += ` and ot.city = $${wp.length}`; }
  if (f.outlet) { wp.push(f.outlet); extra += ` and p.outlet_name = $${wp.length}`; }
  const all = await q<{ platform: string; n: string }>(`
    select lower(p.order_from) platform, count(*) n from landing.petpooja_online_orders p
    left join public.outlets ot on ot.internal_code = p.outlet_name
    where p.business_date between $1 and $2 and lower(p.order_from) in ('zomato','swiggy')
      and p.status not ilike '%cancel%' and p.voided_at is null ${extra}
    group by 1`, wp);
  const out: Record<string, { orders: number; coupon_orders: number; burn: number; ours: number; theirs: number; extras: number; avg_bill: number | null; above_deal: number }> = {};
  for (const p of ['zomato', 'swiggy']) out[p] = { orders: 0, coupon_orders: 0, burn: 0, ours: 0, theirs: 0, extras: 0, avg_bill: null, above_deal: 0 };
  for (const r of all) if (out[r.platform]) out[r.platform].orders = n0(r.n);
  for (const r of rows) {
    const p = String(r.platform); if (!out[p]) continue;
    out[p] = { ...out[p], coupon_orders: n0(r.coupon_orders), burn: n0(r.burn), ours: n0(r.ours), theirs: n0(r.theirs), extras: n0(r.extras), avg_bill: nn(r.avg_bill), above_deal: n0(r.above_deal) };
  }
  return out;
}
export async function summary(f: Filters): Promise<SummaryRow[]> {
  const len = daysBetween(f.from, f.to) + 1;
  const prev: Filters = { ...f, from: shift(f.from, -len), to: shift(f.to, -len) };
  const [cur, pre] = await Promise.all([summaryFor(f), summaryFor(prev)]);
  const mk = (key: Platform | 'total', ps: Platform[]): SummaryRow => {
    const s = (src: typeof cur, k: keyof typeof cur['zomato']) => ps.reduce((a, p) => a + n0(src[p][k]), 0);
    const billW = ps.reduce((a, p) => a + (cur[p].avg_bill ?? 0) * cur[p].coupon_orders, 0);
    const co = s(cur, 'coupon_orders');
    const burn = s(cur, 'burn'), ours = s(cur, 'ours'), pburn = s(pre, 'burn'), pours = s(pre, 'ours');
    return {
      platform: key, orders: s(cur, 'orders'), coupon_orders: co, burn, ours, theirs: s(cur, 'theirs'), extras: s(cur, 'extras'),
      avg_bill: co ? billW / co : null, share: burn ? 100 * ours / burn : null, above_deal: s(cur, 'above_deal'),
      p_orders: s(pre, 'orders'), p_coupon_orders: s(pre, 'coupon_orders'), p_burn: pburn, p_ours: pours, p_theirs: s(pre, 'theirs'), p_share: pburn ? 100 * pours / pburn : null,
    };
  };
  const ps: Platform[] = f.platform ? [f.platform] : ['zomato', 'swiggy'];
  const rows = [mk('total', ps)];
  for (const p of ps) rows.push(mk(p, [p]));
  return rows;
}

// ---------- every coupon, by name ----------
export interface CouponRow {
  platform: Platform; code: string; n: number; burn: number; ours: number; theirs: number; extras: number; share: number | null;
  avg_bill: number | null; min_bill: number | null; outlets: number; constructs: string | null; agreed: number | null; above_deal: number;
  what_it_is: string | null; for_whom: string | null; kind: string | null; status: StatusKey;
}
export async function couponRows(f: Filters, tol: number): Promise<CouponRow[]> {
  const w = where(f);
  const rows = await q(`
    select o.platform, o.code, count(*) n, sum(o.burn) burn, sum(o.ours) ours, sum(o.theirs) theirs, sum(o.extras) extras,
           avg(o.bill) filter (where o.bill > 0) avg_bill, min(o.bill) filter (where o.bill > 0) min_bill,
           count(distinct o.outlet_code) outlets, string_agg(distinct o.construct, ' / ') constructs,
           sum(greatest(0, o.ours - dl.max_our_share_pct * o.burn / 100)) filter (where dl.max_our_share_pct is not null and dl.max_our_share_pct < 99.5) above_deal,
           c.what_it_is, c.for_whom, c.kind,
           (select max_our_share_pct from coupons.deal d where d.platform = o.platform and d.code = o.code and d.outlet_code is null
              and d.effective_from <= $2 and (d.effective_to is null or d.effective_to >= $2) order by d.effective_from desc limit 1) agreed
    from coupons.order_share o ${DEAL_LATERAL}
    left join coupons.coupon c on c.platform = o.platform and c.code = o.code
    where ${w.sql} and o.is_coupon and o.code is not null
    group by o.platform, o.code, c.what_it_is, c.for_whom, c.kind
    order by sum(o.ours) desc`, w.params);
  return rows.map(r => {
    const burn = n0(r.burn), ours = n0(r.ours); const share = burn ? 100 * ours / burn : null; const agreed = nn(r.agreed);
    return { platform: r.platform as Platform, code: String(r.code), n: n0(r.n), burn, ours, theirs: n0(r.theirs), extras: n0(r.extras), share,
      avg_bill: nn(r.avg_bill), min_bill: nn(r.min_bill), outlets: n0(r.outlets), constructs: (r.constructs as string | null), agreed, above_deal: n0(r.above_deal),
      what_it_is: r.what_it_is as string | null, for_whom: r.for_whom as string | null, kind: r.kind as string | null, status: status(share, agreed, tol) };
  });
}

// ---------- our share by city, one platform ----------
export interface CityCell { code: string; city: string; n: number; burn: number; ours: number }
export async function cityCells(f: Filters, platform: Platform): Promise<CityCell[]> {
  const w = where({ ...f, platform });
  const rows = await q(`select o.code, coalesce(o.city, '?') city, count(*) n, sum(o.burn) burn, sum(o.ours) ours
    from coupons.order_share o where ${w.sql} and o.is_coupon and o.code is not null group by 1, 2`, w.params);
  return rows.map(r => ({ code: String(r.code), city: String(r.city), n: n0(r.n), burn: n0(r.burn), ours: n0(r.ours) }));
}

// ---------- lists for the filter bar ----------
export async function cities(): Promise<string[]> {
  const rows = await q<{ city: string }>(`select distinct city from public.outlets where active and city is not null order by 1`);
  return rows.map(r => r.city);
}
export async function outlets(city?: string | null): Promise<{ code: string; city: string }[]> {
  const rows = await q<{ code: string; city: string }>(`select internal_code code, city from public.outlets where active ${city ? 'and city = $1' : ''} order by 1`, city ? [city] : []);
  return rows;
}

// ---------- data completeness for the period ----------
export interface DayStatus { business_date: string; platform: Platform; orders: number; matched: number; coupon_orders: number; computed_at: string }
export async function dayStatus(f: Filters): Promise<DayStatus[]> {
  const rows = await q(`select business_date, platform, orders, matched, coupon_orders, computed_at from coupons.day_status where business_date between $1 and $2 order by 1, 2`, [f.from, f.to]);
  return rows.map(r => ({ business_date: String(r.business_date), platform: r.platform as Platform, orders: n0(r.orders), matched: n0(r.matched), coupon_orders: n0(r.coupon_orders), computed_at: String(r.computed_at) }));
}
export async function missingDays(f: Filters): Promise<string[]> {
  const ds = await dayStatus(f);
  const have = new Set(ds.map(d => d.business_date));
  const out: string[] = [];
  for (let d = f.from; d <= f.to; d = shift(d, 1)) if (!have.has(d)) out.push(d);
  return out;
}

// ---------- one coupon ----------
export interface OutletShare { outlet_code: string; city: string | null; n: number; burn: number; ours: number; share: number | null; avg_bill: number | null; agreed: number | null }
export interface DayShare { business_date: string; n: number; burn: number; ours: number; share: number | null }
export interface WeekShare { week: string; n: number; burn: number; ours: number; share: number | null }
export interface OrderRow { order_no: string; business_date: string; outlet_code: string | null; city: string | null; code: string | null; construct: string | null; bill: number | null; burn: number; ours: number; theirs: number; extras: number; share_pct: number | null }
export async function couponDetail(platform: Platform, code: string, f: Filters, tol: number) {
  const ff: Filters = { ...f, platform };
  const w = where(ff);
  const params = [...w.params, code];
  const codeIx = params.length;
  const [head, byOutlet, byDay, byWeek, siblings, orders, glossary] = await Promise.all([
    couponRows(ff, tol).then(rows => rows.find(r => r.code === code) ?? null),
    q(`select o.outlet_code, o.city, count(*) n, sum(o.burn) burn, sum(o.ours) ours, avg(o.bill) filter (where o.bill > 0) avg_bill,
          (select max_our_share_pct from coupons.deal d where d.platform = o.platform and d.code = o.code
             and (d.outlet_code = o.outlet_code or d.outlet_code is null) and d.effective_from <= $2 and (d.effective_to is null or d.effective_to >= $2)
             order by d.outlet_code nulls last, d.effective_from desc limit 1) agreed
       from coupons.order_share o where ${w.sql} and o.is_coupon and o.code = $${codeIx} group by o.platform, o.code, o.outlet_code, o.city order by count(*) desc`, params),
    q(`select o.business_date, count(*) n, sum(o.burn) burn, sum(o.ours) ours from coupons.order_share o where ${w.sql} and o.is_coupon and o.code = $${codeIx} group by 1 order by 1`, params),
    q(`select date_trunc('week', o.business_date)::date week, count(*) n, sum(o.burn) burn, sum(o.ours) ours from coupons.order_share o
       where o.platform = $1 and o.code = $2 and o.is_coupon and o.business_date >= (current_date - 120) group by 1 order by 1`, [platform, code]),
    platform === 'zomato' ? q(`select o.code, count(*) n, sum(o.burn) burn, sum(o.ours) ours from coupons.order_share o
       where ${w.sql} and o.is_coupon and o.code <> $${codeIx} and o.construct in (select distinct construct from coupons.order_share x where x.platform = 'zomato' and x.code = $${codeIx} and x.business_date between $1 and $2 and x.construct is not null)
       group by 1 order by 2 desc limit 8`, params) : Promise.resolve([]),
    q(`select o.order_no, o.business_date, o.outlet_code, o.city, o.code, o.construct, o.bill, o.burn, o.ours, o.theirs, o.extras, o.share_pct
       from coupons.order_share o where ${w.sql} and o.is_coupon and o.code = $${codeIx} order by o.business_date desc, o.order_no limit 200`, params),
    one(`select * from coupons.coupon where platform = $1 and code = $2`, [platform, code]),
  ]);
  const sh = (b: unknown, o: unknown) => { const bb = n0(b); return bb ? 100 * n0(o) / bb : null; };
  return {
    head, glossary,
    byOutlet: byOutlet.map(r => ({ outlet_code: String(r.outlet_code), city: r.city as string | null, n: n0(r.n), burn: n0(r.burn), ours: n0(r.ours), share: sh(r.burn, r.ours), avg_bill: nn(r.avg_bill), agreed: nn(r.agreed) })) as OutletShare[],
    byDay: byDay.map(r => ({ business_date: String(r.business_date), n: n0(r.n), burn: n0(r.burn), ours: n0(r.ours), share: sh(r.burn, r.ours) })) as DayShare[],
    byWeek: byWeek.map(r => ({ week: String(r.week), n: n0(r.n), burn: n0(r.burn), ours: n0(r.ours), share: sh(r.burn, r.ours) })) as WeekShare[],
    siblings: siblings.map(r => ({ code: String(r.code), n: n0(r.n), share: sh(r.burn, r.ours) })),
    orders: orders.map(r => ({ ...(r as unknown as OrderRow), bill: nn(r.bill), burn: n0(r.burn), ours: n0(r.ours), theirs: n0(r.theirs), extras: n0(r.extras), share_pct: nn(r.share_pct) })) as OrderRow[],
  };
}
// Group outlets by the share they actually sit on (GET175 ran at exactly 40 at
// some outlets and 48 at others; the blend was nobody's deal).
export interface Tier { label: string; share: number; outlets: OutletShare[]; n: number; burn: number; ours: number }
export function tiers(rows: OutletShare[]): Tier[] {
  const m = new Map<number, Tier>();
  for (const r of rows) {
    if (r.share == null || r.n < 3) continue;
    const key = Math.round(r.share);
    const t = m.get(key) ?? { label: key + '%', share: key, outlets: [], n: 0, burn: 0, ours: 0 };
    t.outlets.push(r); t.n += r.n; t.burn += r.burn; t.ours += r.ours; m.set(key, t);
  }
  return [...m.values()].sort((a, b) => a.share - b.share);
}

// ---------- orders for export ----------
export async function ordersForExport(f: Filters, code: string | null): Promise<OrderRow[]> {
  const w = where(f);
  const params = [...w.params];
  let extra = '';
  if (code) { params.push(code); extra = ` and o.code = $${params.length}`; }
  const rows = await q(`select o.platform, o.order_no, o.business_date, o.outlet_code, o.city, o.code, o.construct, o.bill, o.burn, o.ours, o.theirs, o.extras, o.share_pct, o.matched
    from coupons.order_share o where ${w.sql} ${extra} order by o.platform, o.business_date, o.outlet_code, o.order_no limit 100000`, params);
  return rows.map(r => ({ ...(r as unknown as OrderRow & { platform: string; matched: boolean }), bill: nn(r.bill), burn: n0(r.burn), ours: n0(r.ours), theirs: n0(r.theirs), extras: n0(r.extras), share_pct: nn(r.share_pct) }));
}

// ---------- glossary ----------
export interface GlossaryRow {
  id: number; platform: Platform; code: string; what_it_is: string | null; kind: string | null; for_whom: string | null; segment: string | null; status: string;
  first_seen: string | null; last_seen: string | null; notes: string | null; updated_by: string | null;
  n28: number; ours28: number; share28: number | null; min_bill: number | null; outlets28: number; constructs: string | null; agreed: number | null;
}
export async function glossaryRows(): Promise<GlossaryRow[]> {
  const rows = await q(`
    select c.id, c.platform, c.code, c.what_it_is, c.kind, c.for_whom, c.segment, c.status, c.first_seen, c.last_seen, c.notes, c.updated_by,
           coalesce(s.n, 0) n28, coalesce(s.ours, 0) ours28, s.burn burn28, s.min_bill, coalesce(s.outlets, 0) outlets28, s.constructs,
           (select max_our_share_pct from coupons.deal d where d.platform = c.platform and d.code = c.code and d.outlet_code is null
              and d.effective_from <= current_date and (d.effective_to is null or d.effective_to >= current_date) order by d.effective_from desc limit 1) agreed
    from coupons.coupon c
    left join (select platform, code, count(*) n, sum(ours) ours, sum(burn) burn, min(bill) filter (where bill > 0) min_bill, count(distinct outlet_code) outlets,
                      string_agg(distinct construct, ' / ') constructs
               from coupons.order_share where is_coupon and business_date >= current_date - 28 group by 1, 2) s on s.platform = c.platform and s.code = c.code
    order by coalesce(s.ours, 0) desc, c.platform, c.code`);
  return rows.map(r => ({ ...(r as unknown as GlossaryRow), id: n0(r.id), n28: n0(r.n28), ours28: n0(r.ours28), share28: n0(r.burn28) ? 100 * n0(r.ours28) / n0(r.burn28) : null,
    min_bill: nn(r.min_bill), outlets28: n0(r.outlets28), agreed: nn(r.agreed) }));
}

// ---------- deals ----------
export interface DealRow { id: number; platform: Platform; code: string; outlet_code: string | null; max_our_share_pct: number; effective_from: string; effective_to: string | null; agreed_with: string | null; note: string | null; created_by: string | null; created_at: string; superseded_at: string | null; what_it_is: string | null }
export async function deals(includeHistory = false): Promise<DealRow[]> {
  const rows = await q(`select d.*, c.what_it_is from coupons.deal d left join coupons.coupon c on c.platform = d.platform and c.code = d.code
    ${includeHistory ? '' : 'where d.superseded_at is null'} order by d.platform, d.code, d.outlet_code nulls first, d.effective_from desc`);
  return rows.map(r => ({ ...(r as unknown as DealRow), id: n0(r.id), max_our_share_pct: n0(r.max_our_share_pct) }));
}

// ---------- the uploaded discount sheet ----------
export interface UploadHead { id: number; platform: Platform; label: string; source: string | null; uploaded_by: string | null; uploaded_at: string; row_count: number | null }
export interface UploadGrid { head: UploadHead; cols: { col_no: number; slot_group: string | null; slot: string | null }[]; rows: { outlet_code: string; rid: string | null; cells: Record<number, string> }[] }
export async function currentUpload(platform: Platform): Promise<UploadGrid | null> {
  const head = await one(`select id, platform, label, source, uploaded_by, uploaded_at, row_count from coupons.upload where platform = $1 and superseded_at is null order by uploaded_at desc limit 1`, [platform]);
  if (!head) return null;
  const cells = await q(`select outlet_code, platform_rid, col_no, slot_group, slot, construct from coupons.upload_cell where upload_id = $1 order by outlet_code, col_no`, [head.id]);
  const colMap = new Map<number, { col_no: number; slot_group: string | null; slot: string | null }>();
  const rowMap = new Map<string, { outlet_code: string; rid: string | null; cells: Record<number, string> }>();
  for (const c of cells) {
    const col = n0(c.col_no);
    if (!colMap.has(col)) colMap.set(col, { col_no: col, slot_group: c.slot_group as string | null, slot: c.slot as string | null });
    const r = rowMap.get(String(c.outlet_code)) ?? { outlet_code: String(c.outlet_code), rid: c.platform_rid as string | null, cells: {} };
    r.cells[col] = String(c.construct); rowMap.set(r.outlet_code, r);
  }
  return { head: { ...(head as unknown as UploadHead), id: n0(head.id), row_count: nn(head.row_count) }, cols: [...colMap.values()].sort((a, b) => a.col_no - b.col_no), rows: [...rowMap.values()] };
}
// Uploaded versus live: per outlet, what fired that the sheet does not list, and
// what the sheet lists that did not fire (Zomato, where the order names its construct).
export interface UploadCheckRow { outlet_code: string; unexpected: { construct: string; n: number }[]; silent: string[] }
export async function uploadVsLive(f: Filters): Promise<{ rows: UploadCheckRow[]; matched: number; unexpected: number; silent: number } | null> {
  const up = await currentUpload('zomato');
  if (!up) return null;
  const w = where({ ...f, platform: 'zomato' });
  const live = await q(`select o.outlet_code, o.construct, count(*) n from coupons.order_share o where ${w.sql} and o.is_coupon and o.construct is not null group by 1, 2 having count(*) >= 5`, w.params);
  const norm = await q<{ outlet_code: string; construct_norm: string }>(`select distinct outlet_code, construct_norm from coupons.upload_cell where upload_id = $1 and construct_norm is not null`, [up.head.id]);
  const sheet = new Map<string, Set<string>>();
  for (const r of norm) { const k = r.outlet_code.trim().toLowerCase(); if (!sheet.has(k)) sheet.set(k, new Set()); sheet.get(k)!.add(r.construct_norm); }
  const liveMap = new Map<string, Map<string, number>>();
  for (const r of live) { const k = String(r.outlet_code).trim().toLowerCase(); if (!liveMap.has(k)) liveMap.set(k, new Map()); liveMap.get(k)!.set(String(r.construct), n0(r.n)); }
  const rows: UploadCheckRow[] = []; let unexpected = 0, silent = 0, matched = 0;
  for (const r of up.rows) {
    const k = r.outlet_code.trim().toLowerCase(); const lv = liveMap.get(k); const sh = sheet.get(k) ?? new Set<string>();
    if (!lv) continue; matched++;
    const un = [...lv.entries()].filter(([c]) => !sh.has(c)).map(([construct, n]) => ({ construct, n })).sort((a, b) => b.n - a.n);
    const si = [...sh].filter(c => !lv.has(c)).sort();
    unexpected += un.length; silent += si.length;
    rows.push({ outlet_code: r.outlet_code, unexpected: un, silent: si });
  }
  return { rows, matched, unexpected, silent };
}

export async function recentEvents(limit = 30) {
  return q<{ entity: string; action: string; actor: string | null; data: Record<string, unknown> | null; at: string }>(`select entity, action, actor, data, at from coupons.event order by at desc limit $1`, [limit]);
}
