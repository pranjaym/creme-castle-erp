// The wide OMS to spine feed: order headers, items, and customers, landed with
// the supersede pattern into landing.oms_order_header / oms_order_item /
// oms_customer. Spec: erp-plan/oms-spine-feed-spec.md. Built 24 Aug 2026.
//
// This is NOT the Build 1a recon feed; pull_oms_orders.mjs stays untouched.
//
// Modes:
//   node pull_oms_feed.mjs                     incremental (events + 3 day rolling,
//                                              plus a 30 day sweep and a full
//                                              customer sweep on Mondays IST)
//   node pull_oms_feed.mjs --backfill 2026-08-01   orders placed on/after that IST
//                                              date, plus a full customer sweep,
//                                              and the event cursor initialised
//   node pull_oms_feed.mjs --customers-full    customer sweep only
//   node pull_oms_feed.mjs --sweep 30          force an N day order sweep
//
// Transport (spec section 3; F29 RESOLVED 24 Aug 2026): reads go to the OMS
// over its ap-south-1 pooler as the dedicated `spine_reader` role
// (OMS_RO_DATABASE_URL), which can SELECT exactly six tables and runs
// read-only transactions enforced by Postgres itself. Nothing here can write
// to the OMS even by accident.
// HASH STABILITY: full-row reads use `to_jsonb` with the session pinned to
// UTC, byte-identical to the PostgREST JSON the original backfill hashed.
// Do not change either without re-verifying an all-unchanged run.
// Writes go to the spine over the ap-south-1 pooler (SPINE_DATABASE_URL),
// never db.<ref> which is IPv6 only (F15).
//
// Hardening, the F28 birth checklist:
//   * every OMS read retries 3 times, 10 s apart, with a request timeout (F22);
//   * transport class failures (network, 5xx, dead connection) defer with exit
//     75 so the next launchd slot retries silently; at the last slot of the
//     ladder they alert and exit 1 (F23);
//   * logic failures (bad SQL, schema drift, missing env) alert immediately;
//   * spine rollback is guarded so a dead connection cannot mask the real
//     error (F20);
//   * a partial run exits 75 and does NOT advance the event cursor; the landing
//     is idempotent, so the retry re-processes harmlessly.
//
// Exit codes: 0 done, 75 defer (wrapper: no stamp, no alert), 1 fatal (alerted).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUTO_DIR = path.join(HERE, '..', '..', '..', 'dashboard', 'auto');

const ORDER_BACKFILL_FLOOR_IST = '2026-08-01'; // spec section 9: earlier D2C is already in the spine via Petpooja
const LAST_SLOT_HOUR_IST = Number(process.env.CC_OMS_LAST_SLOT_HOUR ?? 11);

// ---------- env ----------

function loadEnvFile() {
  // Same contract as the Python workers: KEY=VALUE lines, existing env wins.
  // Values may contain spaces (the Gmail app password does), so no shell sourcing.
  const p = path.join(AUTO_DIR, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

function reqEnv(k) {
  const v = process.env[k];
  if (!v) { fatal(`${k} is not set (expected in ${AUTO_DIR}/.env)`, false); }
  return v;
}

// ---------- time helpers (IST) ----------

const IST = 'Asia/Kolkata';
function istDateOf(ts) {
  // ts: Date or ISO string. Returns YYYY-MM-DD in IST.
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: IST });
}
function istNowParts() {
  const s = new Date().toLocaleString('en-GB', { timeZone: IST, weekday: 'short', hour: '2-digit', hour12: false });
  const weekday = s.slice(0, 3);
  const hour = Number(s.match(/(\d{2})$/)?.[1] ?? '0');
  return { weekday, hour };
}
function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

// ---------- alerting (reuses dashboard/auto/alert_failure.py) ----------

function sendAlert(subject, body) {
  const guard = path.join(HERE, '.last_alert');
  const today = istDateOf(new Date());
  try { if (fs.readFileSync(guard, 'utf8').trim() === today) return; } catch {}
  const py = process.env.CC_PYTHON || '/Library/Frameworks/Python.framework/Versions/3.14/bin/python3';
  const pyBin = fs.existsSync(py) ? py : 'python3';
  const script = 'import sys; sys.path.insert(0, sys.argv[1]); import alert_failure; ' +
    'ok = alert_failure.send_alert(sys.argv[2], sys.argv[3]); sys.exit(0 if ok else 2)';
  const r = spawnSync(pyBin, ['-c', script, AUTO_DIR, subject, body], { timeout: 60_000 });
  if (r.status === 0) {
    try { fs.writeFileSync(guard, today + '\n'); } catch {}
    console.log('owner alert sent.');
  } else {
    console.log(`owner alert could not be sent (status ${r.status}).`);
  }
}

function isLastSlot() {
  return istNowParts().hour >= LAST_SLOT_HOUR_IST;
}

function fatal(msg, transport) {
  // transport=true: defer unless this is the last slot of the ladder (F23).
  console.error(`FATAL(${transport ? 'transport' : 'logic'}): ${msg}`);
  if (transport && !isLastSlot()) {
    console.error('deferring to the next slot (exit 75).');
    process.exit(75);
  }
  sendAlert('OMS feed failed', `The OMS to spine feed failed.\n\n${msg}\n\n` +
    'The landing is idempotent: once the cause is fixed, re-run\n' +
    '  cd ~/creme-castle-erp/kitchen/workers/oms-feed && node pull_oms_feed.mjs\n' +
    'and it will pick up exactly where it left off (the event cursor only\n' +
    'advances on a fully successful run).');
  process.exit(1);
}

// Transport classification (F22/F23/F28): errors extra retries or a later slot
// can fix. Everything else is a logic fault and alarms immediately.
function isTransportError(err) {
  if (err?.transportClassified !== undefined) return err.transportClassified;
  const s = `${err?.message ?? ''} ${err?.code ?? ''} ${err?.cause?.code ?? ''} ${err?.cause?.message ?? ''}`;
  if (/ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENETDOWN|EADDRNOTAVAIL|EAI_AGAIN|ENOTFOUND|EPIPE/i.test(s)) return true;
  if (/fetch failed|aborted|socket hang up|network|Connection terminated|timeout exceeded|server closed the connection|Client was closed/i.test(s)) return true;
  if (/^(08|57)/.test(String(err?.code ?? ''))) return true; // pg connection / admin classes
  if (err?.httpStatus && err.httpStatus >= 500) return true;
  return false;
}

// ---------- OMS reads (spine_reader role over the pooler, retried) ----------

let omsPg;
async function omsConnect() {
  omsPg = new pg.Client({
    connectionString: reqEnv('OMS_RO_DATABASE_URL'),
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
    connectionTimeoutMillis: 30_000,
  });
  await omsPg.connect();
  // Pin the serialization the row hashes were built on (PostgREST used UTC).
  await omsPg.query(`set time zone 'UTC'`);
}

async function omsRead(label, sql, params) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await omsPg.query(sql, params);
      return res.rows;
    } catch (err) {
      const transport = isTransportError(err);
      if (transport && attempt < 3) {
        console.log(`${label}: attempt ${attempt} failed (${err.message}); reconnecting in 10 s.`);
        try { await omsPg.end(); } catch {}
        await new Promise((r) => setTimeout(r, 10_000));
        try { await omsConnect(); } catch (e2) { console.log(`reconnect failed (${e2.message}); will retry.`); }
        continue;
      }
      err.transportClassified = transport;
      throw err; // main() marks the ingest run failed, then defers or alerts
    }
  }
}

// ---------- column maps: OMS source column -> landing column ----------
// hash:false columns are stored but excluded from row_hash (churn without a
// business change; the F19 lesson). Order matters: it IS the hash order.

const HEADER_MAP = [
  ['id', 'oms_order_id', 'bigint', true],
  ['source', 'source', 'text', true],
  ['shopify_order_id', 'shopify_order_id', 'bigint', true],
  ['shopify_name', 'shopify_name', 'text', true],
  ['legacy_retool_id', 'legacy_retool_id', 'bigint', true],
  ['corporate_account_id', 'corporate_account_id', 'integer', true],
  ['customer_id', 'oms_customer_id', 'bigint', true],
  ['outlet_id', 'outlet_id', 'integer', true],
  ['status', 'status', 'text', true],
  ['placed_at', 'placed_at', 'timestamptz', true],
  ['delivery_date', 'delivery_date', 'date', true],
  ['slot_start', 'slot_start', 'time', true],
  ['slot_end', 'slot_end', 'time', true],
  ['slot_text', 'slot_text', 'text', true],
  ['address_line', 'address_line', 'text', true],
  ['area', 'area', 'text', true],
  ['city', 'city', 'text', true],
  ['pincode', 'pincode', 'text', true],
  ['customer_name', 'customer_name', 'text', true],
  ['customer_mobile', 'customer_mobile', 'text', true],
  ['item_count', 'item_count', 'integer', true],
  ['total_amount', 'total_amount', 'numeric', true],
  ['advance_amount', 'advance_amount', 'numeric', true],
  ['is_prepaid', 'is_prepaid', 'boolean', true],
  ['attribution', 'attribution', 'jsonb', true],
  ['notes', 'notes', 'text', true],
  ['modifications', 'modifications', 'text', true],
  ['requires_skill', 'requires_skill', 'boolean', true],
  ['accepted_at', 'accepted_at', 'timestamptz', true],
  ['accepted_by', 'accepted_by', 'text', true],
  ['cancelled_at', 'cancelled_at', 'timestamptz', true],
  ['cancelled_by', 'cancelled_by', 'text', true],
  ['cancel_reason', 'cancel_reason', 'text', true],
  ['created_by', 'created_by', 'text', true],
  ['created_at', 'created_at_oms', 'timestamptz', true],
  ['updated_at', 'updated_at_oms', 'timestamptz', false],
  ['unacked_edit', 'unacked_edit', 'boolean', true],
  ['attention_reason', 'attention_reason', 'text', true],
  ['edited_fields', 'edited_fields', 'jsonb', true],
  ['is_complimentary', 'is_complimentary', 'boolean', true],
  ['complimentary_reason', 'complimentary_reason', 'text', true],
  ['discount_amount', 'discount_amount', 'numeric', true],
  ['deposit_amount', 'deposit_amount', 'numeric', true],
  ['deposit_note', 'deposit_note', 'text', true],
  ['deposit_returned', 'deposit_returned', 'numeric', true],
  ['deposit_returned_at', 'deposit_returned_at', 'timestamptz', true],
  ['deposit_returned_by', 'deposit_returned_by', 'text', true],
  ['refunded_amount', 'refunded_amount', 'numeric', true],
  ['refunded_at', 'refunded_at', 'timestamptz', true],
  ['discount_note', 'discount_note', 'text', true],
  ['b2b_doc_type', 'b2b_doc_type', 'text', true],
  ['discount_origin_order_id', 'discount_origin_order_id', 'bigint', true],
];

const ITEM_MAP = [
  ['id', 'oms_item_id', 'bigint', true],
  ['order_id', 'oms_order_id', 'bigint', true],
  ['sku', 'sku', 'text', true],
  ['product_title', 'product_title', 'text', true],
  ['variant_title', 'variant_title', 'text', true],
  ['flavour', 'flavour', 'text', true],
  ['weight_kg', 'weight_kg', 'numeric', true],
  ['weight_text', 'weight_text', 'text', true],
  ['egg_option', 'egg_option', 'text', true],
  ['quantity', 'quantity', 'integer', true],
  ['unit_price', 'unit_price', 'numeric', true],
  ['line_total', 'line_total', 'numeric', true],
  ['cake_message', 'cake_message', 'text', true],
  ['reference_image_url', 'reference_image_url', 'text', true],
  ['item_delivery_date', 'item_delivery_date', 'date', true],
  ['item_slot_text', 'item_slot_text', 'text', true],
  ['notes', 'notes', 'text', true],
  ['delivery_id', 'delivery_id', 'bigint', true],
  ['catalog_price', 'catalog_price', 'numeric', true],
  ['item_address_line', 'item_address_line', 'text', true],
  ['item_area', 'item_area', 'text', true],
  ['item_pincode', 'item_pincode', 'text', true],
  ['item_contact_name', 'item_contact_name', 'text', true],
  ['item_contact_phone', 'item_contact_phone', 'text', true],
];

const CUSTOMER_MAP = [
  ['id', 'oms_customer_id', 'bigint', true],
  ['primary_mobile', 'primary_mobile', 'text', true],
  ['name', 'name', 'text', true],
  ['email', 'email', 'text', true],
  ['alt_mobile', 'alt_mobile', 'text', true],
  ['first_source', 'first_source', 'text', true],
  ['created_at', 'created_at_oms', 'timestamptz', true],
  ['order_count', 'order_count', 'integer', false],
  ['last_order_at', 'last_order_at', 'date', false],
  ['first_touch_channel', 'first_touch_channel', 'text', true],
  ['first_touch_source', 'first_touch_source', 'text', true],
  ['first_touch_medium', 'first_touch_medium', 'text', true],
  ['first_touch_campaign', 'first_touch_campaign', 'text', true],
  ['first_touch_at', 'first_touch_at', 'timestamptz', true],
  ['first_touch_order_id', 'first_touch_order_id', 'bigint', true],
  ['addresses', 'addresses', 'jsonb', true],
];

function canon(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
function rowHash(map, src) {
  const h = crypto.createHash('sha256');
  for (const [srcKey, , , hashed] of map) {
    if (!hashed) continue;
    h.update(canon(src[srcKey]));
    h.update(' ');
  }
  return h.digest('hex');
}
function toLanding(map, src, extra = {}) {
  // jsonb values stay as objects: the whole row set is embedded as one JSON
  // document and jsonb_to_recordset extracts them as jsonb directly.
  const out = { ...extra };
  for (const [srcKey, landingCol] of map) {
    const v = src[srcKey];
    out[landingCol] = v === undefined ? null : v;
  }
  out.row_hash = rowHash(map, src);
  return out;
}

// ---------- spine writes ----------

let spine;
async function spineQuery(sql, params) {
  try {
    return await spine.query(sql, params);
  } catch (err) {
    throw err; // classified by the caller's chunk handler
  }
}

function insertSql(table, map, extraCols = []) {
  // Batched insert through jsonb_to_recordset, so a chunk is one round trip.
  const cols = [...extraCols, ...map.map(([, c, t]) => [c, t]), ['row_hash', 'text']];
  const names = cols.map(([c]) => c).join(', ');
  const defs = cols.map(([c, t]) => `"${c}" ${t}`).join(', ');
  return `insert into ${table} (ingest_run_id, ${names})
          select $1, ${cols.map(([c]) => `t."${c}"`).join(', ')}
          from jsonb_to_recordset($2::jsonb) as t(${defs})
          returning id`;
}

const HEADER_INSERT = insertSql('landing.oms_order_header', HEADER_MAP,
  [['business_date', 'date'], ['outlet_code', 'text']]);
const ITEM_INSERT = insertSql('landing.oms_order_item', ITEM_MAP);
const CUSTOMER_INSERT = insertSql('landing.oms_customer', CUSTOMER_MAP);

// Generic supersede-aware landing of one entity chunk. Returns counters.
async function landChunk({ table, keyCol, insert, rows, runId, removedKeys = [] }) {
  const counters = { inserted: 0, superseded: 0, unchanged: 0, removed: 0 };
  if (!rows.length && !removedKeys.length) return counters;
  const keys = rows.map((r) => r.key);
  await spineQuery('begin');
  try {
    const cur = keys.length
      ? await spineQuery(
          `select id, ${keyCol} as key, row_hash from ${table}
           where ${keyCol} = any($1::bigint[]) and superseded_at is null`, [keys])
      : { rows: [] };
    const curMap = new Map(cur.rows.map((r) => [String(r.key), r]));

    const fresh = [];
    const changed = [];
    for (const r of rows) {
      const c = curMap.get(String(r.key));
      if (!c) fresh.push(r);
      else if (c.row_hash !== r.landing.row_hash) changed.push({ oldId: c.id, row: r });
      else counters.unchanged += 1;
    }

    if (fresh.length) {
      const res = await spineQuery(insert, [runId, JSON.stringify(fresh.map((r) => r.landing))]);
      counters.inserted += res.rowCount;
    }
    for (const { oldId, row } of changed) {
      // Stamp the old row first to free the current slot, insert, then link:
      // same three step dance as the Zomato loader, same reason.
      await spineQuery(`update ${table} set superseded_at = now() where id = $1`, [oldId]);
      const res = await spineQuery(insert, [runId, JSON.stringify([row.landing])]);
      await spineQuery(`update ${table} set superseded_by = $1 where id = $2`, [res.rows[0].id, oldId]);
      counters.superseded += 1;
    }
    if (removedKeys.length) {
      const res = await spineQuery(
        `update ${table} set superseded_at = now()
         where ${keyCol} = any($1::bigint[]) and superseded_at is null`, [removedKeys]);
      counters.removed += res.rowCount;
    }
    await spineQuery('commit');
    return counters;
  } catch (err) {
    try { await spineQuery('rollback'); } catch (rbErr) {
      console.log(`rollback failed too (${rbErr.message}); connection presumed dead.`); // F20: never let rollback mask the cause
    }
    throw err;
  }
}

function addCounters(total, c) {
  for (const k of Object.keys(c)) total[k] = (total[k] ?? 0) + c[k];
}

// ---------- fetch helpers ----------

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// Full-row reads come back as to_jsonb documents (column `j`), matching the
// PostgREST JSON shape the row hashes were built on.
const CUSTOMER_JSON = `to_jsonb(c) || jsonb_build_object('customer_addresses',
  coalesce((select jsonb_agg(to_jsonb(a) order by a.id)
            from public.customer_addresses a where a.customer_id = c.id), '[]'::jsonb))`;

async function fetchOrdersByIds(ids) {
  const out = [];
  for (const part of chunks(ids, 1000)) {
    const rows = await omsRead('orders by id',
      'select to_jsonb(t) as j from public.orders t where t.id = any($1::bigint[])', [part]);
    out.push(...rows.map((r) => r.j));
  }
  return out;
}

async function fetchItemsForOrders(orderIds) {
  const out = [];
  for (const part of chunks(orderIds, 1000)) {
    const rows = await omsRead('order_items',
      'select to_jsonb(t) as j from public.order_items t where t.order_id = any($1::bigint[])', [part]);
    out.push(...rows.map((r) => r.j));
  }
  return out;
}

async function fetchCustomersByIds(ids) {
  const out = [];
  for (const part of chunks(ids, 1000)) {
    const rows = await omsRead('customers by id',
      `select ${CUSTOMER_JSON} as j from public.customers c where c.id = any($1::bigint[])`, [part]);
    out.push(...rows.map((r) => r.j));
  }
  return out;
}

function prepCustomer(c) {
  const addresses = (c.customer_addresses ?? [])
    .slice().sort((a, b) => a.id - b.id);
  const src = { ...c, addresses };
  delete src.customer_addresses;
  return { key: c.id, landing: toLanding(CUSTOMER_MAP, src) };
}

// ---------- main ----------

async function main() {
  loadEnvFile();
  const args = process.argv.slice(2);
  const getOpt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? (args[i + 1] ?? true) : null;
  };
  const backfillFrom = getOpt('--backfill');
  const customersOnly = args.includes('--customers-full');
  const forcedSweep = Number(getOpt('--sweep') ?? 0);

  try {
    await omsConnect();
  } catch (err) {
    fatal(`could not connect to the OMS as spine_reader: ${err.message}`, isTransportError(err) || true);
  }

  spine = new pg.Client({
    connectionString: reqEnv('SPINE_DATABASE_URL'),
    ssl: { rejectUnauthorized: false },
    keepAlive: true,
    connectionTimeoutMillis: 30_000,
  });
  try {
    await spine.connect();
    await spine.query(`set statement_timeout = '180s'`);
  } catch (err) {
    fatal(`could not connect to the spine: ${err.message}`, isTransportError(err) || true);
  }

  const { weekday } = istNowParts();
  const monday = weekday === 'Mon';
  const mode = backfillFrom ? 'backfill' : customersOnly ? 'customers_full' : 'incremental';
  console.log(`===== oms-feed ${mode} at ${new Date().toISOString()} (IST ${istDateOf(new Date())}, ${weekday}) =====`);

  // The receipt of this pull.
  const runRes = await spineQuery(
    `insert into landing.ingest_runs (source_system, report_key, status, note)
     values ('oms', 'oms_feed', 'started', $1) returning id`, [`mode=${mode}`]);
  const runId = runRes.rows[0].id;

  const summary = { mode };
  let ok = false;
  try {
    // Outlet code map, once per run.
    const outlets = await omsRead('outlets', 'select id, code from public.outlets');
    const outletCode = new Map(outlets.map((o) => [Number(o.id), o.code]));

    let orderIds = [];
    let newCursor = null;
    const floorIso = new Date(`${ORDER_BACKFILL_FLOOR_IST}T00:00:00+05:30`).toISOString();

    if (mode === 'backfill') {
      const fromIso = new Date(`${backfillFrom}T00:00:00+05:30`).toISOString();
      if (fromIso < floorIso) fatal(`backfill start ${backfillFrom} is before the ${ORDER_BACKFILL_FLOOR_IST} floor; earlier D2C is already in the spine via Petpooja (spec section 2).`, false);
      // Initialise the event cursor to the CURRENT max event id up front:
      // events landing during the backfill are re-read by the next incremental,
      // and the landing is idempotent, so nothing is lost or doubled.
      const maxEv = await omsRead('max event id', 'select max(id) as id from public.order_events');
      newCursor = maxEv[0]?.id ?? 0;
      let last = 0;
      for (;;) {
        const page = await omsRead('backfill order ids',
          `select id from public.orders where placed_at >= $1 and id > $2
           order by id limit 1000`, [fromIso, last]);
        orderIds.push(...page.map((r) => r.id));
        if (page.length < 1000) break;
        last = page[page.length - 1].id;
      }
      summary.backfill_from = backfillFrom;
    } else if (mode === 'incremental') {
      // 1. The event feed above the stored cursor (spec section 4).
      const st = await spineQuery('select last_event_id from landing.oms_feed_state where id = 1');
      const cursor = Number(st.rows[0]?.last_event_id ?? 0);
      const touched = new Set();
      let cur = cursor;
      for (;;) {
        const page = await omsRead('order_events',
          'select id, order_id from public.order_events where id > $1 order by id limit 1000', [cur]);
        for (const e of page) { if (e.order_id != null) touched.add(Number(e.order_id)); cur = Number(e.id); }
        if (page.length < 1000) break;
      }
      newCursor = cur;
      summary.events_from = cursor; summary.events_to = cur;

      // 2. Rolling re-read: everything placed or updated in the last 3 days,
      //    plus the Monday 30 day sweep (spec section 4).
      const sweepDays = forcedSweep || (monday ? 30 : 3);
      const sweepIso = isoDaysAgo(sweepDays);
      const recentPlaced = await omsRead('rolling window (placed)',
        'select id from public.orders where placed_at >= $1', [sweepIso]);
      const recentUpdated = await omsRead('rolling window (updated)',
        'select id from public.orders where updated_at >= $1', [isoDaysAgo(3)]);
      for (const r of [...recentPlaced, ...recentUpdated]) touched.add(Number(r.id));
      summary.sweep_days = sweepDays;
      orderIds = [...touched];
    }

    // ---- orders + items ----
    const totals = { orders: {}, items: {}, customers: {} };
    const customerIds = new Set();

    if (orderIds.length) {
      const all = await fetchOrdersByIds(orderIds);
      // The floor guards every path: pre-cutover orders never land (spec section 2).
      const orders = all.filter((o) => o.placed_at && o.placed_at >= floorIso);
      summary.orders_fetched = orders.length;
      summary.orders_below_floor = all.length - orders.length;

      for (const part of chunks(orders, 200)) {
        const headerRows = part.map((o) => ({
          key: o.id,
          landing: toLanding(HEADER_MAP, o, {
            business_date: istDateOf(o.placed_at),
            outlet_code: outletCode.get(o.outlet_id) ?? null,
          }),
        }));
        addCounters(totals.orders, await landChunk({
          table: 'landing.oms_order_header', keyCol: 'oms_order_id',
          insert: HEADER_INSERT, rows: headerRows, runId,
        }));

        const partIds = part.map((o) => o.id);
        const items = await fetchItemsForOrders(partIds);
        const itemRows = items.map((i) => ({ key: i.id, landing: toLanding(ITEM_MAP, i) }));
        // Items that vanished from an order in the OMS: stamp them superseded.
        const seen = new Set(items.map((i) => i.id));
        const curItems = await spineQuery(
          `select oms_item_id from landing.oms_order_item
           where oms_order_id = any($1::bigint[]) and superseded_at is null`, [partIds]);
        const removed = curItems.rows.map((r) => Number(r.oms_item_id)).filter((id) => !seen.has(id));
        addCounters(totals.items, await landChunk({
          table: 'landing.oms_order_item', keyCol: 'oms_item_id',
          insert: ITEM_INSERT, rows: itemRows, runId, removedKeys: removed,
        }));

        for (const o of part) if (o.customer_id != null) customerIds.add(o.customer_id);
        console.log(`orders chunk done (${part.length} orders, ${items.length} items).`);
      }
    }

    // ---- customers ----
    const fullCustomerSweep = mode === 'backfill' || customersOnly || monday;
    if (fullCustomerSweep) {
      let last = 0; let n = 0;
      for (;;) {
        const page = (await omsRead('customers sweep',
          `select ${CUSTOMER_JSON} as j from public.customers c where c.id > $1
           order by c.id limit 1000`, [last])).map((r) => r.j);
        if (!page.length) break;
        last = page[page.length - 1].id;
        n += page.length;
        addCounters(totals.customers, await landChunk({
          table: 'landing.oms_customer', keyCol: 'oms_customer_id',
          insert: CUSTOMER_INSERT, rows: page.map(prepCustomer), runId,
        }));
        if (n % 10000 === 0) console.log(`customers swept: ${n}`);
        if (page.length < 1000) break;
      }
      summary.customers_swept = n;
    } else if (mode === 'incremental') {
      const recent = await omsRead('recent customers',
        'select id from public.customers where created_at >= $1', [isoDaysAgo(3)]);
      for (const r of recent) customerIds.add(Number(r.id));
      if (customerIds.size) {
        const custs = await fetchCustomersByIds([...customerIds]);
        for (const part of chunks(custs.map(prepCustomer), 1000)) {
          addCounters(totals.customers, await landChunk({
            table: 'landing.oms_customer', keyCol: 'oms_customer_id',
            insert: CUSTOMER_INSERT, rows: part, runId,
          }));
        }
        summary.customers_touched = custs.length;
      }
    }

    // ---- close out: cursor first advances only now, after full success ----
    if (newCursor !== null) {
      await spineQuery(
        'update landing.oms_feed_state set last_event_id = $1, updated_at = now() where id = 1',
        [newCursor]);
    }
    summary.totals = totals;
    const landed = ['orders', 'items', 'customers']
      .reduce((s, k) => s + (totals[k].inserted ?? 0) + (totals[k].superseded ?? 0), 0);
    await spineQuery(
      `update landing.ingest_runs set status = 'loaded', row_count = $1,
         finished_at = now(), note = $2 where id = $3`,
      [landed, JSON.stringify(summary), runId]);
    console.log(`done: ${JSON.stringify(summary)}`);
    ok = true;
  } catch (err) {
    try {
      await spineQuery(
        `update landing.ingest_runs set status = 'failed', finished_at = now(),
           note = $1 where id = $2`,
        [JSON.stringify({ ...summary, error: String(err?.message ?? err) }), runId]);
    } catch {}
    const transport = isTransportError(err);
    fatal(`${err?.stack ?? err}`, transport);
  } finally {
    try { await spine.end(); } catch {}
    try { await omsPg?.end(); } catch {}
  }
  process.exit(ok ? 0 : 1);
}

await main();
