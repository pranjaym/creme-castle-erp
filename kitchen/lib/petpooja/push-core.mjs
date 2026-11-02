// Petpooja push receivers: the pure parts (no clock, no network, no database).
// Used by lib/petpooja/receive.ts and tested in tests/petpooja-push.test.mjs.
// Design record: erp-plan/petpooja-webhooks-plan.md, migration 250.
import { createHash, timingSafeEqual } from 'node:crypto';

export const SECRET_KEYS = ['token', 'Token', 'app_key', 'app_secret', 'access_token'];

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Constant time string compare: both sides hashed first so lengths never leak. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = createHash('sha256').update(a, 'utf8').digest();
  const y = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(x, y);
}

/**
 * The body exactly as received, except the VALUE of every secret key is
 * replaced by "[removed]". Everything else (spacing, key order, other fields)
 * is left byte for byte, so the stored text stays faithful.
 */
export function blankSecrets(text) {
  const keys = SECRET_KEYS.join('|');
  const re = new RegExp(`("(?:${keys})"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|-?\\d+(?:\\.\\d+)?)`, 'g');
  return text.replace(re, '$1"[removed]"');
}

/** JSON.parse that never throws: { json, error }. Only a JSON object counts. */
export function parseBody(text) {
  try {
    const json = JSON.parse(text);
    if (json && typeof json === 'object' && !Array.isArray(json)) return { json, error: null };
    return { json: null, error: 'not a JSON object' };
  } catch (e) {
    return { json: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The static token, whichever spelling Petpooja used (their aggregator sample says "Token"). */
function bodyToken(json) {
  const t = json.token ?? json.Token;
  return typeof t === 'string' && t !== '' ? t : null;
}

/**
 * Global API bill: the body's token must equal PETPOOJA_WEBHOOK_TOKEN.
 * Returns { verified, reason }.
 */
export function verifyOrder(json, env) {
  if (!json) return { verified: false, reason: 'not JSON' };
  const expected = env.PETPOOJA_WEBHOOK_TOKEN;
  if (!expected) return { verified: false, reason: 'server token not set' };
  const got = bodyToken(json);
  if (!got) return { verified: false, reason: 'no token in body' };
  return safeEqual(got, expected)
    ? { verified: true, reason: 'token ok' }
    : { verified: false, reason: 'token mismatch' };
}

/**
 * Inventory API 8 purchase order: the echoed app_key and access_token must
 * equal PETPOOJA_APP_KEY and PETPOOJA_ACCESS_TOKEN; if the body also carries a
 * token, it must equal PETPOOJA_WEBHOOK_TOKEN. Returns { verified, reason }.
 */
export function verifyPurchaseOrder(json, env) {
  if (!json) return { verified: false, reason: 'not JSON' };
  if (!env.PETPOOJA_APP_KEY || !env.PETPOOJA_ACCESS_TOKEN) {
    return { verified: false, reason: 'server keys not set' };
  }
  if (!safeEqual(String(json.app_key ?? ''), env.PETPOOJA_APP_KEY)) {
    return { verified: false, reason: 'app_key mismatch' };
  }
  if (!safeEqual(String(json.access_token ?? ''), env.PETPOOJA_ACCESS_TOKEN)) {
    return { verified: false, reason: 'access_token mismatch' };
  }
  const got = bodyToken(json);
  if (got) {
    if (!env.PETPOOJA_WEBHOOK_TOKEN) return { verified: false, reason: 'token sent but server token not set' };
    if (!safeEqual(got, env.PETPOOJA_WEBHOOK_TOKEN)) return { verified: false, reason: 'token mismatch' };
    return { verified: true, reason: 'keys ok, token ok' };
  }
  return { verified: true, reason: 'keys ok' };
}

/** The caller's address as Vercel reports it (first hop of x-forwarded-for). */
export function sourceIp(headers) {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return headers.get('x-real-ip');
}
