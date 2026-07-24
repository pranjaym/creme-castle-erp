// Pull OMS orders for the four D2C stores into the spine landing zone, READ-ONLY.
// The spine reads OMS; it never writes back to OMS. Run daily (or on demand):
//   node services/oms-ingest/pull_oms_orders.mjs 2026-07-22
// Business day = the delivery_date (fulfillment day). Env creds only, no secrets.
//
// Reads OMS via supabase-js (OMS public tables). Writes the spine LANDING zone via
// direct Postgres (SPINE_DATABASE_URL): landing is a private schema, not exposed to
// PostgREST, so only ingestion workers touch it, and only by SQL. The app reads
// canonical public views only.
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const D2C_OMS_CODES = ['SPJ', 'FBD', 'GN', 'Meerut'];

const businessDate = process.argv[2];
if (!businessDate || !/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
  console.error('Usage: node pull_oms_orders.mjs YYYY-MM-DD (the delivery/business date)');
  process.exit(1);
}

function reqEnv(k) { const v = process.env[k]; if (!v) { console.error(`${k} missing`); process.exit(1); } return v; }
function displayNo(shopifyName, id) {
  return shopifyName && String(shopifyName).trim() ? String(shopifyName).replace(/^#/, '') : `CC-${id}`;
}

const oms = createClient(reqEnv('OMS_SUPABASE_URL'), reqEnv('OMS_SUPABASE_READONLY_KEY'),
  { auth: { persistSession: false } });
const db = new pg.Client({ connectionString: reqEnv('SPINE_DATABASE_URL') });
await db.connect();

try {
  // 1) resolve the four outlet ids by code (Meerut may not exist yet)
  const { data: outlets, error: oe } = await oms.from('outlets').select('id, code').in('code', D2C_OMS_CODES);
  if (oe) throw oe;
  const idToCode = new Map(outlets.map((o) => [o.id, o.code]));
  const ids = outlets.map((o) => o.id);
  if (!ids.length) console.error('warning: none of the four D2C outlet codes exist in OMS yet (Meerut?).');

  // 2) open an ingest run (the receipt of this pull)
  const run = await db.query(
    `insert into landing.ingest_runs (source_system, report_key, window_from, window_to, status)
     values ('oms','oms_orders',$1,$1,'started') returning id`, [businessDate]);
  const runId = run.rows[0].id;

  // 3) read orders for the delivery date at those outlets, with line count and bill status
  const { data: orders, error: qe } = await oms
    .from('orders')
    .select('id, shopify_name, outlet_id, source, status, total_amount, discount_amount, placed_at, delivery_date, order_items(quantity), bills(status)')
    .eq('delivery_date', businessDate)
    .in('outlet_id', ids.length ? ids : [-1]);
  if (qe) throw qe;

  // 4) idempotent upsert into landing, one row per order.
  //    line_count = number of item rows; order_qty = total units (sum of quantity).
  let n = 0;
  for (const o of orders ?? []) {
    const items = Array.isArray(o.order_items) ? o.order_items : [];
    const lineCount = items.length;
    const orderQty = items.reduce((s, it) => s + Number(it.quantity ?? 0), 0);
    const billVoid = Array.isArray(o.bills) && o.bills.some((b) => b.status === 'void');
    await db.query(
      `insert into landing.oms_orders
         (ingest_run_id, business_date, oms_order_id, shopify_name, order_display_no,
          outlet_code, source, status, order_total, discount_amount, line_count,
          order_qty, bill_void, placed_at, delivery_date)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       on conflict (business_date, oms_order_id) do update set
         status = excluded.status, order_total = excluded.order_total,
         line_count = excluded.line_count, order_qty = excluded.order_qty,
         bill_void = excluded.bill_void, loaded_at = now()`,
      [runId, businessDate, o.id, o.shopify_name, displayNo(o.shopify_name, o.id),
       idToCode.get(o.outlet_id) ?? null, o.source, o.status, o.total_amount,
       o.discount_amount, lineCount, orderQty, billVoid, o.placed_at, o.delivery_date]);
    n += 1;
  }

  await db.query(`update landing.ingest_runs set status='loaded', row_count=$1, finished_at=now() where id=$2`,
    [n, runId]);
  console.log(`OMS orders landed for ${businessDate}: ${n} rows across ${idToCode.size} stores.`);
} finally {
  await db.end();
}
