// Data layer for the daily dashboard module. All numbers come from the spine
// functions dash_all / dash_store_detail / dash_store_reasons (migration 150),
// so the portal and the future mailer can never disagree: the definitions live
// in the database. Ranks and area rollups are simple arithmetic done here.
import 'server-only';
import { spine } from '@/lib/supabase/service';
import type { SessionUser } from '@/lib/session';

export interface DayStats {
  orders: number | null; delivered: number | null; subtotal: number | null;
  rating: number | null; comps: number | null; cpct: number | null;
  srej: number | null; rej: number | null; rpct: number | null;
  online: number | null; offmin: number | null;
  wait: number | null; fr: number | null; avgord: number | null;
}
export interface WkStats {
  orders: number | null; delivered: number | null; subtotal: number | null;
  rating: number | null; comps: number | null; srej: number | null; rej: number | null;
  online: number | null; offmin: number | null;
  wait: number | null; waits3: number | null; fr: number | null;
  stockout: number | null; refunds: number | null;
}
export interface StoreStats {
  code: string; locality: string | null; city: string | null; am: string | null;
  day: DayStats; wk: WkStats;
  dayScore?: number | null; wkScore?: number | null;
  dayRank?: number | null; wkRank?: number | null;
}
export interface DashAll {
  date: string; week_start: string; week_end: string;
  stores: StoreStats[];
  reasons_wk: { comps: number; wrong: number; missing: number; packaging: number; quality: number; late: number } | null;
  levers: {
    seg_day: Record<string, number | null> | null;
    seg_wk: Record<string, number | null> | null;
    ads_day: Record<string, number | null> | null;
    ads_wk: Record<string, number | null> | null;
  } | null;
}
export interface Receipt {
  d?: string; dlabel?: string; time?: string; basket?: string | null;
  tag?: string | null; reason?: string | null; refund?: number | null;
  value?: number | null; rating?: string | null;
  ready_secs?: number | null; waited_min?: number | null;
}
export interface TrendDay {
  d: string; online: number | null; offmin: number | null; comps: number | null;
  srej: number | null; rating: number | null; orders: number | null; wait: number | null;
}
export interface StoreDetail {
  code: string; locality: string | null; city: string | null; am: string | null;
  date: string; week_start: string;
  trend: TrendDay[];
  mealtime_wk: Record<string, number>;
  complaints_day: Receipt[]; complaints_wk: Receipt[];
  rated_day: Receipt[]; low_ratings_wk: Receipt[];
  rejections_day: Receipt[]; rejections_wk: Receipt[];
  false_ready_day: Receipt[]; false_ready_wk: Receipt[];
  waits3_day: number; waits3_wk: number; delivered_day: number;
  other_cancels_wk: number; refunds_day: number; refunds_wk: number;
  stockout_day: number; stockout_wk: number;
}
export interface StoreReasons {
  comps?: number; wrong?: number; missing?: number; packaging?: number; quality?: number; late?: number;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await spine().rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T;
}

export async function getLatestDate(): Promise<string> {
  return rpc<string>('dash_latest_date', {});
}

// Clean-day score: complaints % + rejections % + offline penalty; lower is
// better. Ties break on rating then orders (same rule as the sample pages and
// the mailer). Stores with no quality row that day are unranked.
function score(cpct: number | null, rpct: number | null, online: number | null): number | null {
  if (cpct === null && rpct === null && online === null) return null;
  return (cpct ?? 0) + (rpct ?? 0) + (100 - (online ?? 100));
}

export async function getDashAll(date: string): Promise<DashAll> {
  const d = await rpc<DashAll>('dash_all', { p_date: date });
  for (const s of d.stores) {
    s.dayScore = score(s.day.cpct, s.day.rpct, s.day.online);
    s.wkScore = s.wk.orders
      ? (100 * (s.wk.comps ?? 0)) / s.wk.orders + (100 * (s.wk.rej ?? 0)) / s.wk.orders + (100 - (s.wk.online ?? 100))
      : null;
  }
  const rank = (key: 'dayScore' | 'wkScore', rating: (s: StoreStats) => number, orders: (s: StoreStats) => number,
                out: 'dayRank' | 'wkRank') => {
    const ranked = d.stores.filter(s => s[key] !== null)
      .sort((a, b) => (a[key]! - b[key]!) || (rating(b) - rating(a)) || (orders(b) - orders(a)));
    ranked.forEach((s, i) => { s[out] = i + 1; });
  };
  rank('dayScore', s => s.day.rating ?? 0, s => s.day.orders ?? 0, 'dayRank');
  rank('wkScore', s => s.wk.rating ?? 0, s => s.wk.orders ?? 0, 'wkRank');
  return d;
}

export async function getStoreDetail(code: string, date: string): Promise<StoreDetail> {
  return rpc<StoreDetail>('dash_store_detail', { p_code: code, p_date: date });
}
export async function getStoreReasons(code: string, date: string): Promise<StoreReasons> {
  return rpc<StoreReasons>('dash_store_reasons', { p_code: code, p_date: date });
}

export interface AreaAgg {
  am: string; stores: number;
  day: { orders: number; comps: number; cpct: number | null; srej: number; offmin: number };
  wk: { orders: number; comps: number; cpct: number | null; srej: number; offmin: number; fr: number; stockout: number; refunds: number };
}
export function aggregateAreas(stores: StoreStats[]): AreaAgg[] {
  const by = new Map<string, StoreStats[]>();
  for (const s of stores) {
    const am = s.am ?? 'Unassigned';
    if (!by.has(am)) by.set(am, []);
    by.get(am)!.push(s);
  }
  const sum = (xs: StoreStats[], f: (s: StoreStats) => number | null | undefined) =>
    xs.reduce((t, s) => t + (f(s) ?? 0), 0);
  const out: AreaAgg[] = [];
  for (const [am, xs] of by) {
    const dOrders = sum(xs, s => s.day.orders), dComps = sum(xs, s => s.day.comps);
    const wOrders = sum(xs, s => s.wk.orders), wComps = sum(xs, s => s.wk.comps);
    out.push({
      am, stores: xs.length,
      day: { orders: dOrders, comps: dComps, cpct: dOrders ? (100 * dComps) / dOrders : null,
             srej: sum(xs, s => s.day.srej), offmin: sum(xs, s => s.day.offmin) },
      wk: { orders: wOrders, comps: wComps, cpct: wOrders ? (100 * wComps) / wOrders : null,
            srej: sum(xs, s => s.wk.srej), offmin: sum(xs, s => s.wk.offmin),
            fr: sum(xs, s => s.wk.fr), stockout: sum(xs, s => s.wk.stockout),
            refunds: sum(xs, s => s.wk.refunds) },
    });
  }
  return out.sort((a, b) => (a.day.cpct ?? 99) - (b.day.cpct ?? 99));
}

// What may this user open? Role equals scope.
export function canSeeStore(user: SessionUser, code: string): boolean {
  if (user.role === 'admin' || user.role === 'central' || user.role === 'viewer') return true;
  return user.outletCodes.includes(code);
}
export function allowedAms(user: SessionUser, stores: StoreStats[]): string[] {
  if (user.role === 'admin' || user.role === 'central' || user.role === 'viewer') {
    return [...new Set(stores.map(s => s.am ?? 'Unassigned'))];
  }
  return [...new Set(stores.filter(s => user.outletCodes.includes(s.code)).map(s => s.am ?? 'Unassigned'))];
}

// Formatting helpers shared by the pages.
export const inr = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : '₹' + Math.round(v).toLocaleString('en-IN');
export const n1 = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : (Math.round(v * 10) / 10).toFixed(1);
export const n0 = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : Math.round(v).toLocaleString('en-IN');
export const lakh = (v: number | null | undefined) =>
  v === null || v === undefined ? '-' : '₹' + (v / 100000).toFixed(2) + 'L';
export function dateLabel(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
export function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---- area page (migration 180): one call returns everything an AM needs,
// every receipt naming its outlet. Shapes mirror dash_area_detail exactly.
export interface AreaReceipt {
  code: string; dlabel?: string; time?: string; basket?: string | null;
  reason?: string | null; tag?: string | null; rating?: string | null;
  value?: number | null; refund?: number | null; today?: boolean;
  ready_secs?: number | null; waited_min?: number | null;
}
export interface OnlineDip {
  code: string; online_day: number; offmin_day: number; offmin_wk: number;
  series: { d: string; online: number }[];
}
export interface WaitStore {
  code: string; wait_day: number | null; wait_wk: number | null;
  waits3_wk: number; delivered_wk: number; pct3: number | null;
}
export interface FrStore { code: string; fr_day: number; fr_wk: number; delivered_wk: number; pct: number | null }
export interface MoneyStore {
  code: string; stockout_wk: number; refunds_wk: number; total_wk: number; rej_wk: number; comp_wk: number;
}

// ---- the shut-shop tracker (migration 192, 26 Aug 2026) ----
// Zomato only routes an order to a store whose listing it believes is OPEN, so
// a rejection of "Restaurant is closed" or "Unavailable to accept the order"
// means the listing was live while the shop could not serve. Different failure
// from a stockout, different conversation, so it gets its own section on both
// the central and the area page. Each order carries its store's online % for
// that day as the proof the listing was up, and the hour, because the pattern
// is in the clock.
export interface ShutOrder {
  code: string; am: string; dlabel: string; time: string; reason: string;
  basket: string | null; value: number | null; today: boolean; hour: string;
  online_day: number | null; offmin_day: number | null;
}
export interface ShutStore { code: string; am: string; orders: number; value: number; days: number }
export interface ShutHour { hour: string; orders: number; value: number }
export interface ShutBlock {
  shut_orders: ShutOrder[]; shut_stores: ShutStore[]; shut_hours: ShutHour[];
}
export interface AreaDetail extends ShutBlock {
  am: string; date: string; week_start: string; stores: string[];
  online_dips: OnlineDip[]; rejections: AreaReceipt[]; complaints: AreaReceipt[];
  low_ratings: AreaReceipt[]; wait_stores: WaitStore[]; fr_stores: FrStore[];
  fr_orders: AreaReceipt[]; money_stores: MoneyStore[];
}
export async function getAreaDetail(am: string, date: string): Promise<AreaDetail> {
  return rpc<AreaDetail>('dash_area_detail', { p_am: am, p_date: date });
}

// ---- central page (migration 190): one call returns the whole network page.
// Every receipt carries its outlet AND its area manager, because central acts
// through the AM. Money and rejections here use the CORRECTED store-caused
// reason list (F32); dash_all still carries the old one until migration 191
// is applied, so the central page reads its money figures from HERE.
export interface CentralReceipt extends AreaReceipt { am: string }
export interface CentralDip extends OnlineDip { am: string }
export interface TrendPoint {
  d: string; orders: number | null; comps: number | null; cpct: number | null;
  srej: number | null; online: number | null; rating: number | null; wait: number | null;
  discount_pct: number | null; spend: number | null; roi: number | null;
}
export interface LeverStore {
  code: string; am: string;
  sub_day: number; disc_day: number; disc_pct_day: number | null;
  sub_wk: number; disc_wk: number; disc_pct_wk: number | null;
  net_wk: number; orders_wk: number; offer_pct_wk: number | null;
  spend_day: number; spend_wk: number; adsales_wk: number; adorders_wk: number;
  roi_wk: number | null; impr_wk: number; opens_wk: number;
  open_pct_wk: number | null; conv_pct_wk: number | null;
}
export interface CentralDetail extends ShutBlock {
  date: string; week_start: string; stores: string[]; ams: string[];
  trend: TrendPoint[];
  online_dips: CentralDip[];
  rejections: CentralReceipt[];
  complaints: CentralReceipt[]; complaints_total: number;
  low_ratings: CentralReceipt[]; low_ratings_total: number;
  wait_stores: (WaitStore & { am: string })[];
  fr_stores: (FrStore & { am: string })[];
  fr_orders: CentralReceipt[];
  money_stores: (MoneyStore & { am: string })[];
  lever_stores: LeverStore[];
}
export async function getCentralDetail(date: string): Promise<CentralDetail> {
  return rpc<CentralDetail>('dash_central_detail', { p_date: date });
}
