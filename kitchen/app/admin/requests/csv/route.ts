// CSV download for requests (same filters as the page).
import { NextRequest } from 'next/server';
import { spine } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const state = sp.get('state') ?? '';
  const maker = sp.get('maker') ?? '';

  const db = spine();
  let q = db.from('v_request_status').select('*').order('entered_at', { ascending: false }).limit(5000);
  if (['open', 'partial', 'fulfilled', 'cancelled'].includes(state)) q = q.eq('state', state);
  if (maker) q = q.eq('maker_code', maker);
  const { data: rows, error } = await q;
  if (error) return new Response(error.message, { status: 500 });

  const header = ['id', 'state', 'item', 'unit', 'asked_qty', 'sent_qty', 'requester', 'maker', 'needed_by', 'raised_at', 'raised_by', 'closed_reason'];
  const lines = [header.join(',')];
  for (const r of rows ?? []) {
    lines.push([
      r.id, r.state, esc(r.sku_name), r.uom, r.requested_qty, r.sent_qty,
      r.requester_name, r.maker_name, r.needed_by ?? '', r.entered_at, r.entered_by, r.cancel_reason ?? '',
    ].map(esc).join(','));
  }
  return new Response(lines.join('\n') + '\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': 'attachment; filename="kitchen-requests.csv"',
    },
  });
}
