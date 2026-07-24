// Run: node --test
// Deterministic tests for the Build 1a reconciliation core. No DB, no network.
// Structural check is on UNITS (quantity) and line count, not rupees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrderRef, omsOrderKey, reconcile, summarize } from '../lib/recon/match-core.mjs';

test('normalizeOrderRef handles both order-number shapes and junk', () => {
  assert.equal(normalizeOrderRef('#171643'), '171643');
  assert.equal(normalizeOrderRef('171643'), '171643');
  assert.equal(normalizeOrderRef('CC-4821'), 'CC-4821');
  assert.equal(normalizeOrderRef('cc 4821'), 'CC-4821');
  assert.equal(normalizeOrderRef(''), null);
  assert.equal(normalizeOrderRef('NaN'), null);   // empty Invoice Number cell
  assert.equal(normalizeOrderRef(null), null);
});

test('omsOrderKey mirrors the OMS display rule', () => {
  assert.equal(omsOrderKey({ id: 4821, shopify_name: '#171643' }), '171643');
  assert.equal(omsOrderKey({ id: 4821, shopify_name: null }), 'CC-4821');
});

test('a clean match on units and lines lands in matched', () => {
  const oms = [{ id: 1, shopify_name: '#171643', order_qty: 2, line_count: 2, order_total: 1098, status: 'delivered' }];
  const punch = [{ ref_raw: '171643', punch_qty: 2, punch_lines: 2, punch_total: 640 }]; // rupees differ, ok
  const r = reconcile(oms, punch, { location_code: 'CC-DL-Shahpurjat', business_date: '2026-07-22' });
  assert.equal(r.length, 1);
  assert.equal(r[0].bucket, 'matched');
  assert.equal(r[0].oms_order_ref, '171643');
});

test('rupee difference alone does NOT cause a mismatch', () => {
  const oms = [{ id: 1, shopify_name: '#171643', order_qty: 1, line_count: 1, order_total: 549, status: 'delivered' }];
  const punch = [{ ref_raw: '171643', punch_qty: 1, punch_lines: 1, punch_total: 320 }];
  assert.equal(reconcile(oms, punch)[0].bucket, 'matched');
});

test('transfer with an empty Invoice Number is a punch_no_order (missing number)', () => {
  const r = reconcile([], [{ ref_raw: 'NaN', punch_qty: 1, punch_lines: 1 }]);
  assert.equal(r[0].bucket, 'punch_no_order');
  assert.equal(r[0].reason, 'missing_order_number');
});

test('transfer whose number matches no order is the leak bucket', () => {
  const r = reconcile([], [{ ref_raw: '#999999', punch_qty: 1, punch_lines: 1 }]);
  assert.equal(r[0].bucket, 'punch_no_order');
  assert.equal(r[0].reason, 'no_oms_order');
});

test('order with no transfer is overstatement bucket', () => {
  const oms = [{ id: 7, shopify_name: '#171000', order_qty: 3, line_count: 2, status: 'delivered' }];
  assert.equal(reconcile(oms, [])[0].bucket, 'order_no_punch');
});

test('unit mismatch and line mismatch produce qty_item_mismatch with reason', () => {
  const oms = [{ id: 1, shopify_name: '#171643', order_qty: 2, line_count: 2, status: 'delivered' }];
  assert.equal(reconcile(oms, [{ ref_raw: '171643', punch_qty: 1, punch_lines: 2 }])[0].reason, 'qty');
  assert.equal(reconcile(oms, [{ ref_raw: '171643', punch_qty: 2, punch_lines: 1 }])[0].reason, 'lines');
  assert.equal(reconcile(oms, [{ ref_raw: '171643', punch_qty: 1, punch_lines: 1 }])[0].reason, 'qty_and_lines');
});

test('matched but the OMS order was cancelled is flagged', () => {
  const oms = [{ id: 1, shopify_name: '#171643', order_qty: 1, line_count: 1, status: 'cancelled' }];
  const punch = [{ ref_raw: '171643', punch_qty: 1, punch_lines: 1 }];
  const r = reconcile(oms, punch);
  assert.equal(r[0].bucket, 'matched');
  assert.equal(r[0].reason, 'matched_but_cancelled');
  assert.equal(r[0].cancelled_or_void, true);
});

test('CC-<id> punched order matches by CC key, not by bare number', () => {
  const oms = [
    { id: 4821, shopify_name: null, order_qty: 1, line_count: 1, status: 'delivered' },
    { id: 171643, shopify_name: '#171643', order_qty: 1, line_count: 1, status: 'delivered' },
  ];
  const r = reconcile(oms, [{ ref_raw: 'CC-4821', punch_qty: 1, punch_lines: 1 }]);
  const matched = r.filter((x) => x.bucket === 'matched');
  assert.equal(matched.length, 1);
  assert.equal(matched[0].oms_order_ref, 'CC-4821');
});

test('summarize tallies the buckets deterministically', () => {
  const oms = [
    { id: 1, shopify_name: '#1710', order_qty: 1, line_count: 1, status: 'delivered' },
    { id: 2, shopify_name: '#1711', order_qty: 1, line_count: 1, status: 'delivered' },
  ];
  const punch = [
    { ref_raw: '1710', punch_qty: 1, punch_lines: 1 },   // matched
    { ref_raw: '#8888', punch_qty: 1, punch_lines: 1 },  // punch_no_order
  ];
  const s = summarize(reconcile(oms, punch));
  assert.equal(s.matched, 1);
  assert.equal(s.punch_no_order, 1);
  assert.equal(s.order_no_punch, 1); // #1711 had no punch
});
