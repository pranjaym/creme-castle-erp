// The one handler behind both Petpooja push addresses (migration 250).
// Public on purpose: Petpooja cannot sign in. What guards it instead is the
// key check below; a delivery with a wrong key is still SAVED (flagged not
// verified) and answered 401. The keys are never stored: their values are
// blanked before the body reaches the database.
import 'server-only';
import { spine } from '@/lib/supabase/server';
import {
  blankSecrets, parseBody, sha256Hex, sourceIp, verifyOrder, verifyPurchaseOrder,
} from '@/lib/petpooja/push-core.mjs';

export type PushFeed = 'orders' | 'purchase_orders';

const MAX_BYTES = 1_000_000; // a bill or a PO is a few KB

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function receivePush(req: Request, feed: PushFeed): Promise<Response> {
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return reply(413, { status: 'error', message: 'Body too large.' });
  const text = new TextDecoder('utf-8').decode(buf);

  const { json } = parseBody(text);
  const check = feed === 'orders' ? verifyOrder(json, process.env) : verifyPurchaseOrder(json, process.env);

  const { data, error } = await spine().rpc('petpooja_push_receive', {
    p_feed: feed,
    p_source_ip: sourceIp(req.headers),
    p_user_agent: req.headers.get('user-agent'),
    p_content_type: req.headers.get('content-type'),
    p_body_bytes: buf.byteLength,
    p_body_sha256: sha256Hex(text),
    p_body_text: blankSecrets(text),
    p_verified: check.verified,
    p_verify_reason: check.reason,
  });
  // Not saved: answer an error so Petpooja sends it again.
  if (error) return reply(500, { status: 'error', message: 'Not saved, please retry.' });

  const saved = data as { event_id: number; result: string };
  if (!json) return reply(400, { status: 'error', message: 'Body is not a JSON object.', event_id: saved.event_id });
  if (!check.verified) return reply(401, { status: 'error', message: 'Not allowed.', event_id: saved.event_id });
  return reply(200, { status: 'success', event_id: saved.event_id, result: saved.result });
}
