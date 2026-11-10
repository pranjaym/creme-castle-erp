// The inventory module's arithmetic. Pure: no clock, no network, no database.
// The same input always gives the same output (CLAUDE.md rule 4).
// Rules and their status (decided or proposal): erp-plan/inventory-module-plan.md.
//
// The one sum behind every screen: stock today, minus what we use each day,
// plus what is really coming, compared with how long a new order takes.
//
// No 'server-only' here on purpose: the client screens import the types and
// the projection for the graph.

export interface Settings {
  usage_days: number; past_due_cutoff_days: number; buffer_max_days: number;
  default_lead_days: number; order_cover_days: number; horizon_days: number;
}
export const DEFAULT_SETTINGS: Settings = { usage_days: 28, past_due_cutoff_days: 10, buffer_max_days: 7, default_lead_days: 15, order_cover_days: 30, horizon_days: 60 };

export interface RawPo { po: string; vendor: string | null; saved: string; due: string; ordered: number; received: number; open: number; price: number; }
export interface RawItem {
  product_id: string; sku: string; title: string; unit: string; type: string; doubt: boolean;
  stock: number; price: number; out_window: number; days_moved: number; out7: number;
  first_seen: string | null; last_out: string | null; receipt_days: string[];
  vendor: string | null; lead_days: number | null; lead_src: 'item' | 'vendor' | null; min_order_qty: number | null;
  hist: number[] | null; pos: RawPo[];
}
export interface RawData { today: string; stock_day: string | null; stock_as_of: string | null; settings: Partial<Settings>; items: RawItem[]; }

export type Status = 'OUT' | 'OUT_PO' | 'ORDER' | 'CHASE' | 'OK' | 'IDLE';
export type Bucket = 'due' | 'late' | 'stale';
export interface Po extends RawPo { late: number; bucket: Bucket; short: boolean; }
export interface Item {
  product_id: string; sku: string; title: string; unit: string; type: string; doubt: boolean;
  stock: number; price: number; value: number; vendor: string | null;
  outWindow: number; out7: number; useDays: number; use: number; daysMoved: number;
  dih: number | null; cover: number | null; lead: number; leadSrc: 'item' | 'vendor' | 'gap' | 'default'; buffer: number; need: number;
  status: Status; pos: Po[]; onOrder: number; stale: number; run: number | null; suggest: number;
  rough: boolean; negative: boolean; lastOut: string | null; hist: number[] | null;
}

export const STATUS_ORDER: Record<Status, number> = { OUT: 0, OUT_PO: 1, ORDER: 2, CHASE: 3, OK: 4, IDLE: 5 };
export const STATUS_LABEL: Record<Status, string> = {
  OUT: 'Finished, nothing ordered', OUT_PO: 'Finished, order on the way', ORDER: 'Order now',
  CHASE: 'Low, delivery awaited', OK: 'Enough stock', IDLE: 'Not used lately',
};
export function statusMeaning(s: Status, usageDays: number): string {
  switch (s) {
    case 'OUT': return 'None left at the warehouse and no order is on the way. Order now.';
    case 'OUT_PO': return 'None left at the warehouse. An order has been placed: chase the vendor for delivery.';
    case 'ORDER': return 'Some stock is left, but it will finish before a new order can reach us. Place the order today.';
    case 'CHASE': return 'Stock alone will not last, but an order already placed covers it if it arrives on time. Chase the vendor.';
    case 'OK': return 'Stock lasts longer than it takes to get a new order. Nothing to do.';
    case 'IDLE': return `Nothing sent out from the warehouse in the last ${usageDays} days.`;
  }
}

const DAY = 86_400_000;
export function dayDiff(a: string, b: string): number {      // a minus b, in whole days
  return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / DAY);
}
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
}

// The usual gap between deliveries: the middle value of the gaps between
// receipt days. Needs three receipts; otherwise there is no estimate.
export function receiptGap(days: string[]): number | null {
  const d = [...new Set(days)].sort();
  if (d.length < 3) return null;
  const gaps = d.slice(1).map((x, i) => dayDiff(x, d[i])).sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

// Day by day: yesterday's balance minus one day's use; a PO lands at the END of
// its due day. A PO that is late but inside the cut-off is assumed to land today.
export function project(stock: number, use: number, pos: Po[], horizon: number): { withPos: number[]; alone: number[]; run: number | null } {
  const arrive = new Map<number, number>();
  for (const p of pos) if (p.bucket !== 'stale') { const d = Math.max(0, -p.late); arrive.set(d, (arrive.get(d) ?? 0) + p.open); }
  const withPos: number[] = []; const alone: number[] = [];
  let b = Math.max(stock, 0); let a = b; let run: number | null = null;
  for (let d = 0; d <= horizon; d++) {
    if (d > 0) { b = Math.max(0, b - use); a = Math.max(0, a - use); }
    if (use > 0 && b <= 0 && run === null) run = d;
    withPos.push(b); alone.push(a);
    b += arrive.get(d) ?? 0;
  }
  return { withPos, alone, run };
}

export function settingsOf(raw: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(s) as (keyof Settings)[]) { const v = Number(raw?.[k]); if (Number.isFinite(v) && v > 0) s[k] = v; }
  return s;
}

export function computeItem(r: RawItem, today: string, S: Settings): Item {
  const stock = Number(r.stock) || 0; const s0 = Math.max(stock, 0); const price = Number(r.price) || 0;
  const useDays = r.first_seen ? Math.min(S.usage_days, Math.max(1, dayDiff(today, r.first_seen))) : S.usage_days;
  const use = (Number(r.out_window) || 0) / useDays;
  const pos: Po[] = (r.pos ?? []).map((p) => {
    const late = dayDiff(today, p.due);
    return { ...p, late, bucket: late > S.past_due_cutoff_days ? 'stale' : late > 0 ? 'late' : 'due', short: Number(p.received) > 0 };
  });
  const onOrder = pos.filter((p) => p.bucket !== 'stale').reduce((t, p) => t + p.open, 0);
  const stale = pos.filter((p) => p.bucket === 'stale').reduce((t, p) => t + p.open, 0);

  let lead = S.default_lead_days; let leadSrc: Item['leadSrc'] = 'default';
  if (r.lead_days != null && r.lead_days > 0) { lead = r.lead_days; leadSrc = r.lead_src === 'item' ? 'item' : 'vendor'; }
  else { const g = receiptGap(r.receipt_days ?? []); if (g != null) { lead = Math.max(1, Math.min(S.default_lead_days, g)); leadSrc = 'gap'; } }
  const buffer = Math.min(S.buffer_max_days, lead); const need = lead + buffer;

  let status: Status = 'IDLE'; let dih: number | null = null; let cover: number | null = null;
  if (use > 0) {
    dih = s0 / use; cover = (s0 + onOrder) / use;
    status = stock <= 0 ? (onOrder > 0 ? 'OUT_PO' : 'OUT') : cover < need ? 'ORDER' : dih < need ? 'CHASE' : 'OK';
  }
  const { run } = project(stock, use, pos, S.horizon_days);
  let suggest = 0;
  if (use > 0 && (status === 'OUT' || status === 'OUT_PO' || status === 'ORDER')) {
    suggest = Math.max(0, Math.ceil(use * (need + S.order_cover_days) - s0 - onOrder));
    const moq = Number(r.min_order_qty) || 0;
    if (suggest > 0 && moq > suggest) suggest = moq;
  }
  return {
    product_id: r.product_id, sku: r.sku, title: r.title, unit: r.unit, type: r.type, doubt: !!r.doubt,
    stock, price, value: Math.round(s0 * price), vendor: r.vendor,
    outWindow: Number(r.out_window) || 0, out7: Number(r.out7) || 0, useDays, use, daysMoved: Number(r.days_moved) || 0,
    dih, cover, lead, leadSrc, buffer, need, status, pos, onOrder, stale, run: use > 0 ? run : null, suggest,
    rough: use > 0 && (Number(r.days_moved) || 0) < 3, negative: stock < 0, lastOut: r.last_out, hist: r.hist,
  };
}

export interface Computed { today: string; stockAsOf: string | null; settings: Settings; items: Item[]; }
export function compute(raw: RawData): Computed {
  const S = settingsOf(raw.settings);
  const items = (raw.items ?? []).map((r) => computeItem(r, raw.today, S));
  items.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.dih ?? 1e9) - (b.dih ?? 1e9) || a.title.localeCompare(b.title));
  return { today: raw.today, stockAsOf: raw.stock_as_of, settings: S, items };
}

export const isFinished = (i: Item) => i.status === 'OUT' || i.status === 'OUT_PO';
export const needsAction = (i: Item) => STATUS_ORDER[i.status] <= 3;
