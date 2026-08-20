// CSV download for the day ledger (same filters as the page; the OMS rule:
// every table downloads as CSV).
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
  const from = ymd.test(sp.get('from') ?? '') ? sp.get('from')! : ymdAddDays(today, -1);
  const to = ymd.test(sp.get('to') ?? '') ? sp.get('to')! : today;
  const dept = sp.get('dept') ?? '';

  const db = spine();
  let q = db.from('v_dept_day_ledger').select('*')
    .gte('business_date', from).lte('business_date', to)
    .order('business_date').order('dept_code').order('sku_code').limit(5000);
  if (dept) q = q.eq('dept_code', dept);
  const { data: rows, error } = await q;
  if (error) return new Response(error.message, { status: 500 });

  const header = ['date', 'department', 'item', 'unit', 'planned', 'opening', 'made', 'received', 'receipts_pending', 'sent', 'wasted', 'closing', 'gap'];
  const lines = [header.join(',')];
  for (const r of rows ?? []) {
    lines.push([
      r.business_date, r.dept_code, esc(r.sku_name), r.uom,
      r.planned ?? '', r.opening ?? '', r.made, r.received, r.receipts_pending, r.sent, r.wasted, r.closing ?? '', r.gap ?? '',
    ].map(esc).join(','));
  }
  return new Response(lines.join('\n') + '\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="kitchen-ledger-${from}-to-${to}${dept ? `-${dept}` : ''}.csv"`,
    },
  });
}
