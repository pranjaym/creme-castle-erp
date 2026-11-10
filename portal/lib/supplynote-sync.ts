// SupplyNote into the spine, run by the portal on a schedule (Pranjay, 10 Nov
// 2026: SupplyNote has an API, so the sync must not depend on the Mac).
// Plan: erp-plan/inventory-module-plan.md. Tables: migration 252. Loading rule:
// public.supplynote_ingest (migration 253), the single place where
// insert-or-supersede is decided. This file only reads SupplyNote, checks the
// pull is whole, and hands the rows over. Nothing is ever written to SupplyNote.
//
// Two modes, so the hourly run stays light:
//   light  stock, the last 3 days of movements, purchase orders of the last 45 days
//   heavy  item master, purchase orders of the last 366 days, every PO line
//          (the lines dataset has no date filter, about 33 pages)
import 'server-only';
import { spine } from '@/lib/supabase/service';
import { pullDataset, SN_WAREHOUSE } from '@/lib/supplynote';

export type SyncMode = 'light' | 'heavy';
export type ReportKey = 'products' | 'stock_daily' | 'inventory_log' | 'purchase_orders' | 'purchase_order_lines';
export interface DatasetResult { report: ReportKey; rows: number; new: number; changed: number; unchanged: number; seconds: number; error?: string; }

const CHUNK = 500;         // rows per database call
const PARALLEL = 3;        // database calls in flight; chunks never share a key
// A pull below these counts is plainly cut short and is refused before any write.
const FLOOR: Partial<Record<ReportKey, number>> = { products: 500, stock_daily: 500, purchase_order_lines: 10000 };
const KEY: Record<ReportKey, string[]> = {
  products: ['product_id'], stock_daily: ['outlet_id', 'product_id'], inventory_log: ['log_id'],
  purchase_orders: ['purchase_order_id'], purchase_order_lines: ['purchase_order_line_id'],
};

// IST calendar date and the instant, for a given moment
export function istDate(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
export function addDays(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Refuse a batch with an empty or repeated key before it leaves the portal
// (the database refuses it too; this gives a clearer message and saves the trip).
export function checkKeys(report: ReportKey, rows: Record<string, unknown>[]): void {
  const seen = new Set<string>();
  for (const r of rows) {
    const parts = KEY[report].map((k) => r[k]);
    if (parts.some((v) => v === null || v === undefined || v === '')) throw new Error(`${report}: a row has an empty key`);
    const k = parts.join('|');
    if (seen.has(k)) throw new Error(`${report}: key ${k} appears twice in one pull`);
    seen.add(k);
  }
}

export function chunk<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

interface Plan { report: ReportKey; dataset: string; params: Record<string, string>; from: string; }

export function planFor(mode: SyncMode, today: string): Plan[] {
  const wh = { outlet_ids: SN_WAREHOUSE };
  if (mode === 'light') {
    return [
      { report: 'stock_daily', dataset: 'outlet-products', params: wh, from: today },
      { report: 'inventory_log', dataset: 'inventory-log', params: { ...wh, start_date: addDays(today, -3), end_date: today }, from: addDays(today, -3) },
      { report: 'purchase_orders', dataset: 'purchase-orders', params: { ...wh, start_date: addDays(today, -45), end_date: today }, from: addDays(today, -45) },
    ];
  }
  return [
    { report: 'products', dataset: 'products', params: {}, from: today },
    { report: 'purchase_orders', dataset: 'purchase-orders', params: { ...wh, start_date: addDays(today, -365), end_date: today }, from: addDays(today, -365) },
    { report: 'purchase_order_lines', dataset: 'purchase-order-lines', params: wh, from: today },
  ];
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await spine().rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

async function loadOne(p: Plan, today: string, pulledAt: string): Promise<DatasetResult> {
  const t0 = Date.now();
  const res: DatasetResult = { report: p.report, rows: 0, new: 0, changed: 0, unchanged: 0, seconds: 0 };
  let runId: number | null = null;
  try {
    const rows = await pullDataset(p.dataset, p.params);
    res.rows = rows.length;
    const floor = FLOOR[p.report];
    if (floor && rows.length < floor) throw new Error(`only ${rows.length} rows, expected at least ${floor}; refusing a cut-short pull`);
    checkKeys(p.report, rows);
    runId = await rpc<number>('supplynote_run_open', { p_report_key: p.report, p_window_from: p.from, p_window_to: today, p_note: 'portal' });
    const parts = chunk(rows, CHUNK);
    for (let i = 0; i < parts.length; i += PARALLEL) {
      const done = await Promise.all(parts.slice(i, i + PARALLEL).map((c) =>
        rpc<{ new: number; changed: number; unchanged: number }>('supplynote_ingest', {
          p_report_key: p.report, p_rows: c, p_run_id: runId,
          p_snapshot_date: p.report === 'stock_daily' ? today : null,
          p_pulled_at: p.report === 'stock_daily' ? pulledAt : null,
        })));
      for (const d of done) { res.new += d.new; res.changed += d.changed; res.unchanged += d.unchanged; }
    }
    await rpc('supplynote_run_close', { p_run_id: runId, p_row_count: rows.length, p_status: 'loaded', p_note: `portal: new ${res.new}, changed ${res.changed}, unchanged ${res.unchanged}` });
  } catch (e) {
    res.error = e instanceof Error ? e.message : String(e);
    // Chunks already loaded stay loaded: each is whole, and the next run finishes the rest.
    if (runId !== null) {
      try { await rpc('supplynote_run_close', { p_run_id: runId, p_row_count: res.rows, p_status: 'failed', p_note: `portal: ${res.error}`.slice(0, 500) }); } catch { /* the run stays "started" */ }
    }
  }
  res.seconds = Math.round((Date.now() - t0) / 100) / 10;
  return res;
}

// One dataset failing does not stop the others: each is independent and the
// run log says which one failed.
export async function runSync(mode: SyncMode, now = new Date()): Promise<{ mode: SyncMode; day: string; ok: boolean; results: DatasetResult[] }> {
  const today = istDate(now);
  const results: DatasetResult[] = [];
  for (const p of planFor(mode, today)) results.push(await loadOne(p, today, now.toISOString()));
  return { mode, day: today, ok: results.every((r) => !r.error), results };
}

export interface SyncStatus { report_key: string; last_loaded_at: string | null; last_failed_at: string | null; last_failure_note: string | null; loads_last_24h: number; }

export async function syncStatus(): Promise<SyncStatus[]> {
  const { data, error } = await spine().from('v_supplynote_sync_status').select('*');
  if (error) throw new Error(`v_supplynote_sync_status: ${error.message}`);
  return (data ?? []) as SyncStatus[];
}

// Which datasets have gone stale. Stock and movements should never be more
// than 3 hours old in the working day; the PO lines never more than 10.
export function staleList(status: SyncStatus[], now = new Date()): string[] {
  const limitHours: Record<string, number> = { stock_daily: 3, inventory_log: 3, purchase_orders: 3, purchase_order_lines: 10, products: 30 };
  const out: string[] = [];
  for (const [k, h] of Object.entries(limitHours)) {
    const s = status.find((x) => x.report_key === k);
    const age = s?.last_loaded_at ? (now.getTime() - new Date(s.last_loaded_at).getTime()) / 3_600_000 : Infinity;
    if (age > h) out.push(`${k}: ${s?.last_loaded_at ? `last loaded ${age.toFixed(1)} hours ago` : 'never loaded'}${s?.last_failure_note ? ` (last failure: ${s.last_failure_note})` : ''}`);
  }
  return out;
}
