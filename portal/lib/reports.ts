// The report exports. Each report reads one public view (over the private landing
// tables) through the Supabase REST client, the SAME connection the portal already
// uses for login and dashboards. The CSV reproduces the raw Petpooja report
// verbatim: `columns` are the database column names (used to query and to pull each
// value), `headers` are the exact template header names written to the CSV, in the
// same order. Decision 24 Jul 2026: full columns, customer PII included.
import 'server-only';
import { spine } from '@/lib/supabase/service';

export interface ReportDef {
  key: string;         // url token
  label: string;       // shown in the picker
  view: string;        // public view name (migration 050)
  columns: string[];   // db column names, in template order
  headers: string[];   // raw report header names, 1:1 with columns
  filenameStem: string;
  // Optional per-column value formatters, keyed by db column name. Applied as rows are
  // read, before CSV escaping. Used sparingly: most reports stream the spine value
  // verbatim, so a report with no `format` behaves exactly as before.
  format?: Record<string, (raw: unknown) => unknown>;
}

// Petpooja/finance date convention: DD-MM-YYYY HH:MM (no seconds). The spine stores
// order timestamps as YYYY-MM-DD HH:MM:SS; this reformats to match the finance team's
// template file. A null/empty or unexpected value is passed through untouched, so a
// surprise format is never silently blanked.
function fmtDateDMY(raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === '') return raw;
  const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return raw;
  const [, y, mo, d, h, mi] = m;
  return `${d}-${mo}-${y} ${h}:${mi}`;
}

export const REPORTS: Record<string, ReportDef> = {
  order: {
    key: 'order',
    label: 'Order report (Petpooja online orders)',
    view: 'v_report_online_orders',
    columns: [
      'order_date', 'invoice_date', 'aggregator_order_no', 'pos_invoice_no', 'order_from',
      'outlet_name', 'outlet_display_name', 'petpooja_identifier', 'order_type',
      'customer_name', 'customer_phone', 'payment_type', 'delivery_status', 'status',
      'my_amount', 'aggregator_discount', 'outlet_discount', 'delivery_charges',
      'container_charges', 'additional_charge', 'total', 'order_acceptance_time',
      'order_delivery_time', 'cancelled_by', 'reason', 'tip', 'complimentary',
    ],
    headers: [
      'Date', 'Invoice Date', 'Aggregator Order No.', 'PoS Invoice No.', 'Order From',
      'Outlet Name', 'Outlet Display Name', 'Petpooja Identifier', 'Order Type',
      'Customer Name', 'Customer Phone', 'Payment Type', 'Delivery Status', 'Status',
      'My amount', 'Aggregator Discount', 'Outlet Discount', 'Delivery Charges',
      'Container Charges', 'Additional Charge', 'Total', 'Order Acceptance Time',
      'Order Delivery Time', 'Cancelled By', 'Reason', 'Tip', 'Complimentary',
    ],
    filenameStem: 'cc_order_report',
  },
  item: {
    key: 'item',
    label: 'Item report (Petpooja order summary item)',
    view: 'v_report_order_summary_item',
    columns: [
      'restaurant_name', 'invoice_no', 'order_ts', 'payment_type', 'order_type', 'status',
      'area', 'virtual_brand_name', 'brand_grouping', 'assign_to', 'customer_phone',
      'customer_name', 'customer_address', 'persons', 'order_cancel_reason', 'my_amount',
      'total_tax', 'discount', 'delivery_charge', 'container_charge', 'service_charge',
      'additional_charge', 'deduction_charge', 'waived_off', 'round_off', 'total',
      'item_name', 'category_name', 'sap_code', 'item_price', 'item_quantity', 'item_total',
    ],
    headers: [
      'restaurant_name', 'invoice_no', 'date', 'payment_type', 'order_type', 'status',
      'area', 'virtual_brand_name', 'brand_grouping', 'assign_to', 'customer_phone',
      'customer_name', 'customer_address', 'persons', 'order_cancel_reason', 'my_amount',
      'total_tax', 'discount', 'delivery_charge', 'container_charge', 'service_charge',
      'additional_charge', 'deduction_charge', 'waived_off', 'round_off', 'total',
      'item_name', 'category_name', 'sap_code', 'item_price', 'item_quantity', 'item_total',
    ],
    filenameStem: 'cc_item_report',
  },
  finance: {
    // The finance cut of the item report: the same per-line rows as `item`, narrowed to
    // the columns finance works with (money fields, tax, discount, delivery/container
    // charges, round-off, total, plus item detail) and dropping the operational columns
    // they do not use (virtual_brand_name, brand_grouping, assign_to, persons,
    // service_charge, additional_charge, deduction_charge, waived_off, sap_code). It reads
    // the SAME view as `item`, so it is always in step and needs no separate ingest.
    // Decision 31 July 2026: reproduce Pranjay's Order_Summary_Item_Report_Fixed.xlsx
    // shape verbatim (23 columns, this order), customer PII kept, listed on the same
    // /reports page for all logged-in users. The `date` header maps to order_ts and
    // streams exactly as the item report does (verbatim from the spine, no reformatting).
    key: 'finance',
    label: 'Finance report (item-level: sales, tax, charges)',
    view: 'v_report_order_summary_item',
    columns: [
      'restaurant_name', 'invoice_no', 'order_ts', 'payment_type', 'order_type', 'status',
      'area', 'customer_phone', 'customer_name', 'customer_address', 'order_cancel_reason',
      'my_amount', 'total_tax', 'discount', 'delivery_charge', 'container_charge',
      'round_off', 'total', 'item_name', 'category_name', 'item_price', 'item_quantity',
      'item_total',
    ],
    headers: [
      'restaurant_name', 'invoice_no', 'date', 'payment_type', 'order_type', 'status',
      'area', 'customer_phone', 'customer_name', 'customer_address', 'order_cancel_reason',
      'my_amount', 'total_tax', 'discount', 'delivery_charge', 'container_charge',
      'round_off', 'total', 'item_name', 'category_name', 'item_price', 'item_quantity',
      'item_total',
    ],
    // The one place the finance report diverges from the raw spine value: its `date`
    // column is reformatted to DD-MM-YYYY HH:MM to match the finance template file.
    format: { order_ts: fmtDateDMY },
    filenameStem: 'cc_finance_report',
  },
  sub_order: {
    key: 'sub_order',
    label: 'Sub-Order Wise (sales summary by outlet + channel)',
    view: 'v_report_sub_order_wise',
    columns: [
      'restaurants', 'order_type', 'sub_order_type', 'total_no_of_bills', 'my_amount',
      'total_discount', 'net_sales', 'delivery_charge', 'container_charge', 'service_charge',
      'additional_charge', 'total_tax', 'round_off', 'waived_off', 'total_sales',
      'online_tax_calculated', 'gst_paid_by_merchant', 'gst_paid_by_ecommerce',
    ],
    headers: [
      'Restaurants', 'Order Type', 'Sub Order Type', 'Total no. of bills', 'My Amount',
      'Total Discount', 'Net Sales(M.A - T.D)', 'Delivery Charge', 'Container Charge',
      'Service Charge', 'Additional Charge', 'Total Tax', 'Round Off', 'Waived off',
      'Total Sales', 'Online Tax Calculated', 'GST Paid by Merchant', 'GST Paid by Ecommerce',
    ],
    filenameStem: 'cc_sub_order_wise',
  },
  invoice_wise: {
    key: 'invoice_wise',
    label: 'Invoice Wise Sales (B2B / GST invoice lines)',
    view: 'v_report_invoice_wise_sales',
    columns: [
      's_no', 'location', 'inv_date', 'seller_invoice_no', 'invoice_no', 'challan_no',
      'from_location', 'pickup_gstin', 'pickup_pincode', 'deliver_gstin', 'buyer_billing_name',
      'buyer_billing_state', 'buyer_billing_address', 'buyer_billing_gstin',
      'buyer_billing_pincode', 'buyer_name', 'buyer_gstin', 'item_name', 'hsn_code', 'sku_code',
      'brand', 'mrp', 'category', 'price', 'so_qty', 'gr_qty', 'uom', 'discount_pct',
      'discount_amt', 'subtotal', 'tax', 'cess', 'tax_amt', 'cess_amt', 'sgst_tax',
      'sgst_tax_amount', 'cgst_tax', 'cgst_tax_amount', 'igst_tax', 'igst_tax_amount',
      'additional_charges', 'delivery_charges', 'total',
    ],
    headers: [
      'S.No.', 'Location', 'Date', 'Seller_Invoice_No', 'Invoice No', 'Challan No',
      'From Location', 'Pickup Address GSTIN', 'Pickup Address PinCode', 'Deliver Address GSTIN',
      'Buyer Billing Name', 'Buyer Billing State', 'Buyer Billing Address', 'Buyer Billing GSTIN',
      'Buyer Billing PinCode', 'Buyer Name', 'Buyer GSTIN', 'Item Name', 'HSN Code', 'Sku Code',
      'Brand', 'MRP', 'Category', 'Price', 'So Qty', 'GR Qty', 'UOM', 'Discount %',
      'Discount Amt', 'Subtotal', 'Tax', 'Cess', 'Tax Amt', 'Cess Amt', 'SGST Tax',
      'SGST Tax Amount', 'CGST Tax', 'CGST Tax Amount', 'IGST Tax', 'IGST Tax Amount',
      'Additional Charges', 'Delivery Charges', 'Total',
    ],
    filenameStem: 'cc_invoice_wise_sales',
  },
  daily_stock: {
    key: 'daily_stock',
    label: 'Daily Report (per-item stock ledger by location)',
    view: 'v_report_daily_stock',
    columns: [
      'report_location', 'raw_material', 'category', 'sub_category', 'hsn_code', 'sap_code',
      'unit', 'opening_a', 'purchase_sales_return_b', 'excess_c', 'total_stock', 'consumed_d',
      'wastage_e', 'normal_loss_f', 'sales_transfer_purchase_g', 'shortage_h', 'production_i',
      'total_consumed', 'closing_stock', 'closing_summary', 'difference', 'reconciliation_price',
      'reconciliation_amount',
    ],
    headers: [
      'Restaurant', 'Raw Material', 'Category', 'Sub Category', 'HSN Code', 'Sap Code', 'Unit',
      'Opening (A)', 'Purchase / Sales Return (B)', 'Excess (C)', 'Total Stock (A+B+C)',
      'Consumed (D)', 'Wastage (E)', 'Normal Loss (F)', 'Sales / Transfer / Purchase (G)',
      'Shortage (H)', 'Production (I)', 'Total Consumed (D+E+F+G+H)', 'Closing Stock',
      'Closing Summary (A+B-D-E-F-G-H)', 'Difference', 'Reconciliation Price',
      'Reconciliation Amount',
    ],
    filenameStem: 'cc_daily_stock',
  },
};

// A generous but bounded window for a single download. The 2-year bulk history is a
// separate importer/exporter task, not this on-demand button.
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
// of a half-written file. Rows come back ordered (business_date, id) so the file is
// stable and re-downloadable identically.
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
    for (const obj of batch) {
      rows.push(def.columns.map((c) => {
        const fmt = def.format?.[c];
        return fmt ? fmt(obj[c]) : obj[c];
      }));
    }
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

// Turn already-fetched rows into a CSV stream, with the raw report header names.
// No I/O happens here, so this stream cannot fail midway.
export function rowsToCsvStream(def: ReportDef, rows: unknown[][]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const header = def.headers.map(csvCell).join(',') + '\n';
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
