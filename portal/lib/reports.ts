// The report exports. Each report reads one public view (over the private landing
// tables) through the Supabase REST client, the SAME connection the portal already
// uses for login and dashboards. No direct database connection, so none of the
// host / DNS / SSL / password-in-URL problems apply. Customer name and phone are
// never exposed (the views do not include them).
import 'server-only';
import { spine } from '@/lib/supabase/service';

export interface ReportDef {
  key: string;         // url token
  label: string;       // shown in the picker
  view: string;        // public view name (migration 041)
  columns: string[];   // columns to emit, in order (no PII)
  filenameStem: string;
}

export const REPORTS: Record<string, ReportDef> = {
  order: {
    key: 'order',
    label: 'Order report (Petpooja online orders)',
    view: 'v_report_online_orders',
    columns: [
      'business_date', 'order_ts', 'aggregator_order_no', 'pos_invoice_no',
      'order_from', 'outlet_name', 'order_type', 'status', 'my_amount', 'total',
    ],
    filenameStem: 'cc_order_report',
  },
  item: {
    key: 'item',
    label: 'Item report (Petpooja order summary item)',
    view: 'v_report_order_summary_item',
    columns: [
      'business_date', 'restaurant_name', 'invoice_no', 'order_ts', 'payment_type',
      'order_type', 'status', 'area', 'virtual_brand_name', 'my_amount', 'total_tax',
      'discount', 'delivery_charge', 'container_charge', 'total', 'item_name',
      'category_name', 'sap_code', 'item_price', 'item_quantity', 'item_total',
    ],
    filenameStem: 'cc_item_report',
  },
};

// A generous but bounded window for Phase 1 downloads. The 2-year bulk history is
// a separate importer/exporter task, not this on-demand button.
export const MAX_RANGE_DAYS = 92;
const PAGE = 1000; // REST page size; we loop until a short page.

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / 86_400_000);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString().slice(0, 10);
  else s = String(v);
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Fetch the report for [from, to] (inclusive, by business_date). Pages through the
// REST API and THROWS on any error, so the caller returns a clean message instead
// of a half-written file. Rows come back ordered (business_date, id) so the file
// is stable and re-downloadable identically.
export async function fetchReportRows(def: ReportDef, from: string, to: string): Promise<unknown[][]> {
  const client = spine();
  const rows: unknown[][] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await client
      .from(def.view)
      .select(def.columns.join(','))
      .gte('business_date', from)
      .lte('business_date', to)
      .order('business_date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    if (batch.length === 0) break;
    for (const obj of batch) rows.push(def.columns.map((c) => obj[c]));
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

// Turn already-fetched rows into a CSV stream. No I/O happens here, so this stream
// cannot fail midway: the download is complete or it never started.
export function rowsToCsvStream(def: ReportDef, rows: unknown[][]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const header = def.columns.join(',') + '\n';
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(header));
      for (const row of rows) {
        controller.enqueue(encoder.encode(row.map(csvCell).join(',') + '\n'));
      }
      controller.close();
    },
  });
}
