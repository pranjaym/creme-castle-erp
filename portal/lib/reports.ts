// The report exports. Each report reads one private `landing` table over the
// direct pg pool and streams a clean CSV. Customer name and phone are NEVER
// emitted, even though the item table has those columns (the daily loader strips
// them, and we exclude them here too, so an export can never leak PII).
import 'server-only';
import { pool } from '@/lib/db';

export interface ReportDef {
  key: string;         // url token
  label: string;       // shown in the picker
  table: string;       // qualified landing table
  columns: string[];   // columns to emit, in order (no PII)
  filenameStem: string;
}

export const REPORTS: Record<string, ReportDef> = {
  order: {
    key: 'order',
    label: 'Order report (Petpooja online orders)',
    table: 'landing.petpooja_online_orders',
    columns: [
      'business_date', 'order_ts', 'aggregator_order_no', 'pos_invoice_no',
      'order_from', 'outlet_name', 'order_type', 'status', 'my_amount', 'total',
    ],
    filenameStem: 'cc_order_report',
  },
  item: {
    key: 'item',
    label: 'Item report (Petpooja order summary item)',
    table: 'landing.petpooja_order_summary_item',
    // No customer_name / customer_phone: never export PII.
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

// Stream the chosen report for [from, to] (inclusive, by business_date) as CSV.
// Rows come back ordered so the file is stable and re-downloadable identically.
export function streamReportCsv(def: ReportDef, from: string, to: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const cols = def.columns;
  const sql =
    `select ${cols.join(', ')} from ${def.table} ` +
    `where business_date >= $1 and business_date <= $2 ` +
    `order by business_date, id`;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(cols.join(',') + '\n'));
      const client = await pool().connect();
      try {
        const res = await client.query({ text: sql, values: [from, to], rowMode: 'array' });
        for (const row of res.rows as unknown[][]) {
          controller.enqueue(encoder.encode(row.map(csvCell).join(',') + '\n'));
        }
      } finally {
        client.release();
      }
      controller.close();
    },
  });
}
