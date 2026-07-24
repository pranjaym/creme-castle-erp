// Build 1a reconciliation core. Pure, deterministic, dependency-free.
// Every number here is reproducible: same inputs always yield the same buckets.
// No AI, no network, no clock. Tested by tests/match-core.test.mjs (node --test).
//
// Reconciles OMS D2C orders against Petpooja vendor-OMS transfers at one store for
// one business day. The Petpooja source is the Material Purchase Report at the OMS
// location: Supplier = the store, Invoice Number = the OMS order number the team
// writes in, Raw Material rows = the items transferred.
//
// The three exception buckets (build-plans-1a-3a.md, Build 1a):
//   punch_no_order      a Petpooja transfer with no matching OMS order (the leak)
//   order_no_punch      an OMS order with no matching transfer (overstatement risk)
//   qty_item_mismatch   matched, but unit count or line count disagree
// Plus a flag: a matched OMS order later cancelled or whose bill voided.
//
// STRUCTURAL CHECK IS ON UNITS AND LINES, NOT RUPEES. The transfer's Net Amount is
// Petpooja's item valuation, not the customer's D2C bill, so the two rupee totals
// differ by design; they are carried for context only, never to decide a bucket.

const QTY_TOL = 0.001;

/**
 * Normalise a raw Petpooja Invoice-Number value into the canonical OMS order key,
 * or null. The team writes the OMS order number (as OMS displays it) into that
 * field, so we normalise the two shapes the OMS shows:
 *   "#171643" / "171643"          -> "171643"
 *   "CC-4821" / "cc 4821"         -> "CC-4821"
 *   "" / null / non-order text    -> null
 */
export function normalizeOrderRef(raw) {
  if (raw === null || raw === undefined) return null;
  let s = String(raw).trim();
  if (s === '' || s.toLowerCase() === 'nan') return null;

  const cc = s.match(/CC[\s-]?(\d{1,10})/i);
  if (cc) return `CC-${cc[1]}`;

  // legacy embedded "web order 174736" form, kept harmless for old data
  const web = s.match(/web\s*order\s*#?\s*(\d{4,8})/i);
  if (web) return web[1];

  const bare = s.replace(/^#/, '').match(/\b(\d{4,8})\b/);
  if (bare) return bare[1];

  return null;
}

/**
 * The canonical order number OMS displays and a store would copy: shopify_name
 * without '#', else CC-<id>. Mirrors cremecastle-oms lib/reports/util.ts.
 */
export function omsOrderKey(order) {
  const name = order.shopify_name;
  if (name !== null && name !== undefined && String(name).trim() !== '') {
    return String(name).replace(/^#/, '');
  }
  return `CC-${order.id}`;
}

function qtyEq(a, b) {
  return Math.abs(Number(a || 0) - Number(b || 0)) <= QTY_TOL;
}

/**
 * Reconcile one store, one business day.
 * @param {Array<{id:number, shopify_name?:string|null, order_qty:number,
 *   line_count:number, order_total?:number, status?:string, bill_void?:boolean,
 *   location_code?:string}>} omsOrders
 * @param {Array<{ref_raw:string, punch_qty:number, punch_lines:number,
 *   punch_total?:number, location_code?:string, source?:string}>} punchouts
 * @param {{location_code?:string, business_date?:string}} [ctx]
 */
export function reconcile(omsOrders, punchouts, ctx = {}) {
  const loc = ctx.location_code ?? null;
  const bd = ctx.business_date ?? null;

  const omsByKey = new Map();
  const dupOms = [];
  for (const o of omsOrders) {
    const k = omsOrderKey(o);
    if (omsByKey.has(k)) dupOms.push({ key: k, order: o });
    else omsByKey.set(k, o);
  }

  const results = [];
  const matchedOmsKeys = new Set();

  for (const p of punchouts) {
    const key = normalizeOrderRef(p.ref_raw);
    const base = {
      location_code: p.location_code ?? loc,
      business_date: bd,
      oms_order_ref: key,
      punch_ref_raw: p.ref_raw ?? null,
      punch_qty: Number(p.punch_qty ?? 0),
      punch_lines: Number(p.punch_lines ?? 0),
      punch_total: p.punch_total ?? null,
      punch_source: p.source ?? null,
    };

    if (key === null) {
      results.push({ ...base, bucket: 'punch_no_order', reason: 'missing_order_number',
        oms_qty: null, oms_lines: null, oms_total: null, oms_status: null });
      continue;
    }
    const o = omsByKey.get(key);
    if (!o) {
      results.push({ ...base, bucket: 'punch_no_order', reason: 'no_oms_order',
        oms_qty: null, oms_lines: null, oms_total: null, oms_status: null });
      continue;
    }
    matchedOmsKeys.add(key);
    const qtyOk = qtyEq(o.order_qty, p.punch_qty);
    const linesOk = Number(o.line_count) === Number(p.punch_lines);
    const cancelled = o.status === 'cancelled' || o.bill_void === true;
    const bucket = qtyOk && linesOk ? 'matched' : 'qty_item_mismatch';
    results.push({
      ...base,
      bucket,
      reason: bucket === 'matched'
        ? (cancelled ? 'matched_but_cancelled' : null)
        : (!qtyOk && !linesOk ? 'qty_and_lines' : !qtyOk ? 'qty' : 'lines'),
      oms_qty: Number(o.order_qty ?? 0),
      oms_lines: Number(o.line_count ?? 0),
      oms_total: o.order_total ?? null,
      oms_status: o.status ?? null,
      cancelled_or_void: cancelled,
    });
  }

  for (const [key, o] of omsByKey) {
    if (matchedOmsKeys.has(key)) continue;
    results.push({
      location_code: o.location_code ?? loc,
      business_date: bd,
      bucket: 'order_no_punch',
      reason: null,
      oms_order_ref: key,
      punch_ref_raw: null, punch_qty: null, punch_lines: null, punch_total: null, punch_source: null,
      oms_qty: Number(o.order_qty ?? 0),
      oms_lines: Number(o.line_count ?? 0),
      oms_total: o.order_total ?? null,
      oms_status: o.status ?? null,
      cancelled_or_void: o.status === 'cancelled' || o.bill_void === true,
    });
  }
  for (const d of dupOms) {
    results.push({
      location_code: d.order.location_code ?? loc,
      business_date: bd,
      bucket: 'order_no_punch',
      reason: 'duplicate_oms_key',
      oms_order_ref: d.key,
      punch_ref_raw: null, punch_qty: null, punch_lines: null, punch_total: null, punch_source: null,
      oms_qty: Number(d.order.order_qty ?? 0),
      oms_lines: Number(d.order.line_count ?? 0),
      oms_total: d.order.order_total ?? null,
      oms_status: d.order.status ?? null,
      cancelled_or_void: false,
    });
  }

  return results;
}

/** Bucket tallies for the morning summary. Deterministic. */
export function summarize(results) {
  const s = { matched: 0, punch_no_order: 0, order_no_punch: 0, qty_item_mismatch: 0,
    matched_but_cancelled: 0 };
  for (const r of results) {
    s[r.bucket] = (s[r.bucket] ?? 0) + 1;
    if (r.reason === 'matched_but_cancelled') s.matched_but_cancelled += 1;
  }
  return s;
}
