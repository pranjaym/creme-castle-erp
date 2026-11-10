// Checks for lib/inventory-engine.ts (plain arithmetic, no database, no network).
// Run from the portal folder: node scripts/check-inventory-engine.cjs
const fs = require('fs'), path = require('path'), assert = require('assert');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'inventory-engine.ts'), 'utf8');
const m = { exports: {} }; new Function('exports', 'module', 'require', ts.transpileModule(src, { compilerOptions: { module: 'commonjs', target: 'es2020' } }).outputText)(m.exports, m, require);
const E = m.exports, S = E.DEFAULT_SETTINGS, T = '2026-11-10';
const base = { product_id: 'p', sku: 's', title: 't', unit: 'piece', type: 'Sticker', doubt: false, stock: 0, price: 2, out_window: 0, days_moved: 0, out7: 0, first_seen: '2026-08-01', last_out: null, receipt_days: [], vendor: 'V', lead_days: null, lead_src: null, min_order_qty: null, hist: null, pos: [] };
const po = (due, open, received = 0) => ({ po: 'PO', vendor: 'V', saved: '2026-10-01', due, ordered: open + received, received, open, price: 1 });
const it = (o) => E.computeItem({ ...base, ...o }, T, S);

assert.strictEqual(E.dayDiff('2026-11-10', '2026-10-31'), 10);
assert.strictEqual(E.addDays('2026-11-10', 21), '2026-12-01');
assert.strictEqual(E.receiptGap(['2026-10-01', '2026-10-04', '2026-10-10', '2026-10-13']), 3);
assert.strictEqual(E.receiptGap(['2026-10-01', '2026-10-04']), null);
// no use at all
assert.strictEqual(it({ stock: 500 }).status, 'IDLE');
// 28 a day, lead 7 from the vendor: buffer 7, need 14
let x = it({ stock: 280, out_window: 784, days_moved: 20, lead_days: 7, lead_src: 'vendor' });
assert.deepStrictEqual([x.use, x.dih, x.need, x.buffer, x.status, x.suggest], [28, 10, 14, 7, 'ORDER', 952]);   // 28 x (14 + 30) - 280
x = it({ stock: 420, out_window: 784, days_moved: 20, lead_days: 7, lead_src: 'vendor' });
assert.deepStrictEqual([x.dih, x.status, x.suggest], [15, 'OK', 0]);
// stock short but a PO due tomorrow covers it
x = it({ stock: 280, out_window: 784, days_moved: 20, lead_days: 7, lead_src: 'vendor', pos: [po('2026-11-11', 2800)] });
assert.deepStrictEqual([x.status, x.onOrder, x.cover, x.run], ['CHASE', 2800, 110, null]);
// the cut-off: 10 days late still counts, 11 days late does not (Pranjay, 10 Nov 2026)
x = it({ stock: 280, out_window: 784, days_moved: 20, lead_days: 7, lead_src: 'vendor', pos: [po('2026-10-31', 2800)] });
assert.deepStrictEqual([x.pos[0].late, x.pos[0].bucket, x.status], [10, 'late', 'CHASE']);
x = it({ stock: 280, out_window: 784, days_moved: 20, lead_days: 7, lead_src: 'vendor', pos: [po('2026-10-30', 2800, 200)] });
assert.deepStrictEqual([x.pos[0].late, x.pos[0].bucket, x.pos[0].short, x.status, x.onOrder, x.stale], [11, 'stale', true, 'ORDER', 0, 2800]);
// finished, with and without an order; negative stock counts as zero and is flagged
assert.deepStrictEqual([it({ stock: 0, out_window: 280, days_moved: 5 }).status, it({ stock: -3, out_window: 280, days_moved: 5, pos: [po('2026-11-12', 500)] }).status], ['OUT', 'OUT_PO']);
assert.strictEqual(it({ stock: -3, out_window: 280, days_moved: 5 }).negative, true);
// lead time order of preference: item or vendor figure, else the delivery gap, else the default
assert.deepStrictEqual([it({ out_window: 1 }).lead, it({ out_window: 1 }).leadSrc], [15, 'default']);
x = it({ out_window: 1, receipt_days: ['2026-10-01', '2026-10-03', '2026-10-05'] }); assert.deepStrictEqual([x.lead, x.leadSrc, x.buffer, x.need], [2, 'gap', 2, 4]);
// a new item is averaged over the days it has existed, not 28
assert.strictEqual(it({ first_seen: '2026-11-03', out_window: 700, days_moved: 2 }).use, 100);
// minimum order
assert.strictEqual(it({ stock: 280, out_window: 784, days_moved: 20, lead_days: 7, lead_src: 'vendor', min_order_qty: 2000 }).suggest, 2000);
// projection: arrival lands at the end of its day; run-out is the first day at zero
const pj = E.project(100, 40, [{ ...po('2026-11-12', 500), late: -2, bucket: 'due', short: false }], 6);
assert.deepStrictEqual(pj.withPos, [100, 60, 20, 480, 440, 400, 360]); assert.deepStrictEqual(pj.alone, [100, 60, 20, 0, 0, 0, 0]); assert.strictEqual(pj.run, null);
assert.strictEqual(E.project(100, 40, [], 6).run, 3);
console.log('inventory engine: all checks pass');
