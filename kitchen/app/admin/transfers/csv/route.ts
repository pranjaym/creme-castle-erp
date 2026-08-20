// CSV download for transfers: differences first, then unconfirmed sends.
import { NextRequest } from 'next/server';
import { spine } from '@/lib/supabase/server';
import { istCalendarDate, ymdAddDays } from '@/lib/business-day';

export const dynamic = 'force-dynamic';

const esc = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const today = istCalendarDate(new Date());
  const from = ymd.test(sp.get('from') ?? '') ? sp.get('from')! : ymdAddDays(today, -13);
  const to = ymd.test(sp.get('to') ?? '') ? sp.get('to')! : today;

  const db = spine();
  const [{ data: mismatches }, { data: pending }] = await Promise.all([
    db.from('v_transfer_mismatches').select('*').gte('business_date', from).lte('business_date', to)
      .order('received_at', { ascending: false }).limit(5000),
    db.from('v_pending_receipts').select('*').gte('business_date', from).lte('business_date', to)
      .order('sent_at', { ascending: false }).limit(5000),
  ]);

  const header = ['kind', 'day', 'item', 'unit', 'from', 'to', 'sent_qty', 'received_qty', 'difference', 'sent_by', 'confirmed_by', 'confirmed_at'];
  const lines = [header.join(',')];
  for (const m of mismatches ?? []) {
    lines.push(['difference', m.business_date, esc(m.sku_name), m.uom, m.from_name, m.to_name,
      m.sent_qty, m.received_qty, m.difference, m.sent_by, m.received_by, m.received_at].map(esc).join(','));
  }
  for (const p of pending ?? []) {
    lines.push(['unconfirmed', p.business_date, esc(p.sku_name), p.uom, p.from_name, p.to_name,
      p.sent_qty, '', '', p.sent_by, '', ''].map(esc).join(','));
  }
  return new Response(lines.join('\n') + '\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="kitchen-transfers-${from}-to-${to}.csv"`,
    },
  });
}
