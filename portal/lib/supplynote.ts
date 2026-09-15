// Read-only calls to the SupplyNote data API (erp-plan/supplynote-api-notes.md).
// Base URL is the one their team gave us, never the one in their documents.
// The key is server-only. Nothing is ever written to SupplyNote.
import 'server-only';

const BASE = 'https://reporting-api.supplynote.in';
const WAREHOUSE = '5dd9015b742a4b9b20c45677'; // Noida-Central Warehouse (outlet_id), the place vendor purchases land

function key(): string {
  const k = process.env.SUPPLYNOTE_API_KEY;
  if (!k) throw new Error('SUPPLYNOTE_API_KEY missing (server-only)');
  return k;
}

async function get<T>(path: string, params: Record<string, string | number | undefined>): Promise<{ data: T; meta: Record<string, unknown> }> {
  const qs = Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
  const res = await fetch(`${BASE}${path}?${qs}`, { headers: { 'X-API-Key': key(), 'X-Request-Id': 'cc-portal-recipes-' + Date.now() }, cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SupplyNote ${res.status}: ${(body as { error?: { code?: string; message?: string } }).error?.message ?? 'request failed'}`);
  return body as { data: T; meta: Record<string, unknown> };
}

export interface FulfilmentRow {
  sku_code: string; product_title: string; unit: string; direction: string; seller_name: string; grn_date: string | null; po_saved_at: string;
  invoiced_unit_price: number | null; po_unit_price: number | null; po_tax_pct: number | null; quantity_received: number | null; purchase_order_no: string; grn_no: string | null;
}

// The last vendor purchase of every product received at the warehouse in the window.
// Prices are pre-tax per SupplyNote unit (a kg, a piece, a tray), which is the basis
// the workbook used (BB012 carry bag: 11.39 in both). We keep the raw direction
// value so the screen can show what SupplyNote calls a vendor purchase.
export async function lastPurchases(days = 120): Promise<{ rows: FulfilmentRow[]; directions: Record<string, number>; pages: number }> {
  const end = new Date(); const start = new Date(end.getTime() - days * 86400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const all: FulfilmentRow[] = []; let cursor: string | undefined; let pages = 0;
  do {
    const r = await get<FulfilmentRow[]>('/v2/data/purchase-fulfilment', { start_date: fmt(start), end_date: fmt(end), outlet_id: WAREHOUSE, limit: 1000, cursor });
    all.push(...r.data); pages += 1;
    cursor = (r.meta.next_cursor as string | null) ?? undefined;
  } while (cursor && pages < 30);
  const directions: Record<string, number> = {};
  for (const r of all) directions[r.direction] = (directions[r.direction] ?? 0) + 1;
  // vendor purchases only: anything that is not an internal transfer, with a GRN and a real price
  const vendor = all.filter(r => r.direction !== 'internal_transfer' && r.grn_date && (r.invoiced_unit_price ?? r.po_unit_price ?? 0) > 0 && (r.quantity_received ?? 0) > 0);
  vendor.sort((a, b) => (b.grn_date! > a.grn_date! ? 1 : b.grn_date! < a.grn_date! ? -1 : 0));
  const latest = new Map<string, FulfilmentRow>();
  for (const r of vendor) if (!latest.has(r.sku_code)) latest.set(r.sku_code, r);
  return { rows: [...latest.values()], directions, pages };
}
