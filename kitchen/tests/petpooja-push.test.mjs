// Petpooja push receiver tests (pure, no clock, no network). Fixtures are
// Petpooja's own documentation samples with placeholder keys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  blankSecrets, parseBody, safeEqual, sha256Hex, sourceIp, verifyOrder, verifyPurchaseOrder,
} from '../lib/petpooja/push-core.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/petpooja/${name}`, import.meta.url), 'utf8');
const ENV = {
  PETPOOJA_WEBHOOK_TOKEN: 'test-webhook-token',
  PETPOOJA_APP_KEY: 'test-app-key',
  PETPOOJA_ACCESS_TOKEN: 'test-access-token',
};

test('bill with the right lower-case token is verified', () => {
  const { json } = parseBody(fixture('order_basic.json'));
  assert.deepEqual(verifyOrder(json, ENV), { verified: true, reason: 'token ok' });
});

test('aggregator bill: the capital-T "Token" spelling is accepted', () => {
  const { json } = parseBody(fixture('order_aggregator.json'));
  assert.equal(verifyOrder(json, ENV).verified, true);
});

test('bill with a wrong token is refused', () => {
  const { json } = parseBody(fixture('order_basic.json'));
  json.token = 'guess';
  assert.deepEqual(verifyOrder(json, ENV), { verified: false, reason: 'token mismatch' });
});

test('bill with an empty token (Petpooja sample default) is refused', () => {
  const { json } = parseBody(fixture('order_part_payment.json'));
  json.token = '';
  assert.deepEqual(verifyOrder(json, ENV), { verified: false, reason: 'no token in body' });
});

test('if the server token is not configured, nothing is verified', () => {
  const { json } = parseBody(fixture('order_basic.json'));
  assert.deepEqual(verifyOrder(json, {}), { verified: false, reason: 'server token not set' });
});

test('a body that is not JSON is refused and reported', () => {
  const p = parseBody('token=abc&x=1');
  assert.equal(p.json, null);
  assert.ok(p.error);
  assert.deepEqual(verifyOrder(p.json, ENV), { verified: false, reason: 'not JSON' });
  assert.equal(parseBody('[1,2]').json, null);
});

test('purchase order with the right echoed keys is verified', () => {
  const { json } = parseBody(fixture('purchase_order.json'));
  assert.deepEqual(verifyPurchaseOrder(json, ENV), { verified: true, reason: 'keys ok' });
});

test('purchase order: a wrong app_key or access_token is refused', () => {
  const { json } = parseBody(fixture('purchase_order.json'));
  assert.equal(verifyPurchaseOrder({ ...json, app_key: 'x' }, ENV).reason, 'app_key mismatch');
  assert.equal(verifyPurchaseOrder({ ...json, access_token: 'x' }, ENV).reason, 'access_token mismatch');
});

test('purchase order: a token, if sent, must match too', () => {
  const { json } = parseBody(fixture('purchase_order.json'));
  assert.equal(verifyPurchaseOrder({ ...json, token: 'test-webhook-token' }, ENV).reason, 'keys ok, token ok');
  assert.equal(verifyPurchaseOrder({ ...json, token: 'x' }, ENV).reason, 'token mismatch');
});

test('purchase order: refused while the server keys are not configured', () => {
  const { json } = parseBody(fixture('purchase_order.json'));
  assert.equal(verifyPurchaseOrder(json, { PETPOOJA_WEBHOOK_TOKEN: 'x' }).reason, 'server keys not set');
});

test('blankSecrets removes every key value and leaves every other byte alone', () => {
  const raw = fixture('purchase_order.json');
  const out = blankSecrets(raw);
  for (const secret of ['test-app-key', 'test-access-token', 'test-app-secret']) {
    assert.ok(!out.includes(secret), `${secret} still present`);
  }
  assert.equal(out.match(/"\[removed\]"/g).length, 3);
  // Everything except the three values is unchanged.
  const strip = (s) => s.replace(/"(app_key|access_token|app_secret)"\s*:\s*"[^"]*"/g, '"$1":""');
  assert.equal(strip(out), strip(raw));
  assert.equal(JSON.parse(out).data.poNumber, 'PO0046839231');
});

test('blankSecrets handles both token spellings, odd spacing and escaped quotes', () => {
  assert.equal(blankSecrets('{"Token":"abc"}'), '{"Token":"[removed]"}');
  assert.equal(blankSecrets('{"token" :  "a\\"b", "x":1}'), '{"token" :  "[removed]", "x":1}');
  assert.equal(blankSecrets('{"tokenish":"keep"}'), '{"tokenish":"keep"}');
  assert.ok(!blankSecrets(fixture('order_aggregator.json')).includes('test-webhook-token'));
});

test('the fingerprint is of the original body, so a repeat is recognisable', () => {
  const raw = fixture('order_basic.json');
  assert.equal(sha256Hex(raw), sha256Hex(raw));
  assert.notEqual(sha256Hex(raw), sha256Hex(blankSecrets(raw)));
});

test('safeEqual: equal, unequal, different lengths, non-strings', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual(undefined, 'abc'), false);
});

test('sourceIp takes the first x-forwarded-for hop', () => {
  assert.equal(sourceIp(new Headers({ 'x-forwarded-for': '13.1.2.3, 10.0.0.1' })), '13.1.2.3');
  assert.equal(sourceIp(new Headers({ 'x-real-ip': '13.1.2.4' })), '13.1.2.4');
  assert.equal(sourceIp(new Headers()), null);
});
