// Data layer of "Issues to Ask" (14 Oct 2026, plan: erp-plan/central-view-plan.md).
// The page reads public.dash_issue (migration 247), the derived table the
// workers fill after every pull: one row per issue the daily pages highlight,
// keyed exactly as the Questions module keys its rows, so a row's question is
// qmap.get(row.anchor_key). Nothing here touches the landing tables: a 30-day
// network read is one indexed query of about a thousand rows.
import 'server-only';
import { q } from '@/lib/db';
import { type Field } from '@/lib/questions';
import { shiftDate } from '@/lib/daily';

export interface IssueRow {
  anchor_key: string; outlet_code: string; business_date: string; platform: 'Z' | 'S';
  issue_type: 'Online visibility' | 'Complaint' | 'Rejection'; issue_kind: string; detail: string | null;
  order_id: string | null; order_time: string | null; basket: string | null;
  value: number | null; refund: number | null; customer_words: string | null; customer_asked: string | null;
  must_answer: boolean;   // migration 248: central expects an explanation (the 30-minute floors and the tablet rule)
  city: string; am: string; locality: string | null; region: string;
}

export type DaysPreset = '1' | '3' | '7' | '14' | 'custom';
export interface IssueFilters {
  days: DaysPreset; from: string; to: string;
  region: string; city: string; am: string; store: string;
  plat: '' | 'Z' | 'S'; type: '' | IssueRow['issue_type'];
  status: '' | 'none' | 'open' | 'overdue' | 'answered' | 'unasked' | 'closed';
  must: boolean;   // only the must-answer rows
}
export const STATUS_WORDS: Record<Exclude<IssueFilters['status'], ''>, string> = {
  none: 'Not asked yet', open: 'Asked, waiting', overdue: 'Overdue', answered: 'Explained, waiting for close',
  unasked: 'Explained unasked', closed: 'Closed',
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// The window is relative to the newest settled day (T-2), the same ceiling as
// every daily page, so a preset never shows a day Zomato is still revising.
export function parseIssueFilters(sp: Record<string, string | undefined>, latest: string): IssueFilters {
  const days = (['1', '3', '7', '14', 'custom'] as DaysPreset[]).includes(sp.days as DaysPreset) ? (sp.days as DaysPreset) : '1';
  let from: string, to: string;
  if (days === 'custom') {
    to = ISO.test(sp.to ?? '') && sp.to! <= latest ? sp.to! : latest;
    from = ISO.test(sp.from ?? '') ? sp.from! : shiftDate(to, -6);
    if (from > to) [from, to] = [to, from];
  } else {
    to = latest; from = shiftDate(latest, -(Number(days) - 1));
  }
  const s = (k: string) => (sp[k] ?? '').trim();
  const plat = s('plat'); const type = s('type'); const status = s('status');
  return {
    days, from, to, region: s('region'), city: s('city'), am: s('am'), store: s('store'),
    plat: plat === 'Z' || plat === 'S' ? plat : '',
    type: ['Online visibility', 'Complaint', 'Rejection'].includes(type) ? (type as IssueRow['issue_type']) : '',
    status: (status in STATUS_WORDS) ? (status as IssueFilters['status']) : '',
    must: s('must') === '1',
  };
}

// The query string for these filters, so every link and every form returns to
// the same view and the view can be pasted into a group (two-audience rule).
export function issueQs(f: IssueFilters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.days !== '1') p.set('days', f.days);
  if (f.days === 'custom') { p.set('from', f.from); p.set('to', f.to); }
  for (const k of ['region', 'city', 'am', 'store', 'plat', 'type', 'status'] as const) if (f[k]) p.set(k, f[k]);
  if (f.must) p.set('must', '1');
  for (const [k, v] of Object.entries(extra)) { if (v) p.set(k, v); else p.delete(k); }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export async function listIssues(from: string, to: string): Promise<IssueRow[]> {
  return q<IssueRow>(
    `select i.anchor_key, i.outlet_code, i.business_date::text as business_date, i.platform, i.issue_type, i.issue_kind,
            i.detail, i.order_id, i.order_time, i.basket, i.value::float as value, i.refund::float as refund,
            i.customer_words, i.customer_asked, i.must_answer,
            o.city, coalesce(o.area_manager, 'Unassigned') as am, o.locality, coalesce(l.region, 'Other') as region
       from public.dash_issue i
       join public.outlets o on o.internal_code = i.outlet_code and o.active
       left join public.locations l on l.code = o.internal_code
      where i.business_date between $1::date and $2::date
      order by i.business_date desc, i.order_time desc nulls last, i.anchor_key`, [from, to]);
}

// Scope filters are applied in memory: the rows of a window are few and the
// outlet master is tiny, and it keeps one query shape for every view.
export function inScope(r: IssueRow, f: IssueFilters): boolean {
  return (!f.region || r.region === f.region) && (!f.city || r.city === f.city) && (!f.am || r.am === f.am)
    && (!f.store || r.outlet_code === f.store) && (!f.plat || r.platform === f.plat) && (!f.type || r.issue_type === f.type)
    && (!f.must || r.must_answer);
}

// The section a row belongs to, in the words the area and store pages use, so
// a question raised here groups with the same questions raised there.
export function sectionOf(r: IssueRow): string {
  if (r.issue_type === 'Online visibility') return 'Outlets not fully online';
  if (r.issue_type === 'Complaint') return 'Complaints';
  return r.issue_kind.startsWith('Shop shut') ? 'Orders turned away because the shop was shut' : 'Turned away or cancelled on the store';
}

export function dayLabel(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}
const rs = (v: number | null) => (v == null ? null : 'Rs. ' + Math.round(v).toLocaleString('en-IN'));

// The labelled row a question carries as its snapshot: what the page shows,
// in the page's own words, nothing more (shared by the page and the bulk ask).
export function issueFields(r: IssueRow): Field[] {
  const pairs: [string, string | null][] = [
    ['Store', r.outlet_code], ['Day', dayLabel(r.business_date)], ['Time', r.order_time],
    ['App', r.platform === 'Z' ? 'Zomato' : 'Swiggy'], ['Issue', r.issue_kind], ['Detail', r.detail],
    ['Order no.', r.order_id], ['What was ordered', r.basket], ['Customer asked for', r.customer_asked],
    ["Customer's words", r.customer_words], ['Value', rs(r.value)], ['Refund', r.refund ? rs(r.refund) : null],
  ];
  return pairs.filter((p): p is [string, string] => !!p[1] && p[1] !== '-').map(([label, value]) => ({ label, value }));
}
