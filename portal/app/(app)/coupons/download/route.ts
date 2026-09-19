// CSV of the orders behind any coupon view: the same filters as the page, plus
// an optional coupon name. Fourteen columns, one row per aggregator order.
import { NextResponse } from 'next/server';
import { getSessionUser, couponPerms } from '@/lib/session';
import { parseFilters, ordersForExport } from '@/lib/coupons';

export const dynamic = 'force-dynamic';

function csv(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export async function GET(req: Request) {
  const u = await getSessionUser();
  if (!u || !couponPerms(u).view) return new NextResponse('Not allowed', { status: 403 });
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const f = parseFilters(sp);
  const code = sp.code || null;
  const rows = await ordersForExport(f, code);
  const head = ['Platform', 'Order no', 'Date', 'Outlet', 'City', 'Coupon', 'What it is', 'Bill', 'Discount shared', 'We paid', 'They paid', 'Extras (100% ours)', 'Our share %', 'Platform row found'];
  const lines = [head.join(',')];
  for (const r of rows as (typeof rows[number] & { platform: string; matched: boolean })[]) {
    lines.push([r.platform, r.order_no, r.business_date, r.outlet_code, r.city, r.code, r.construct, r.bill, r.burn, r.ours, r.theirs, r.extras, r.share_pct, r.matched ? 'yes' : 'no'].map(csv).join(','));
  }
  const name = `coupon_orders_${f.from}_to_${f.to}${code ? '_' + code.replace(/[^A-Za-z0-9]/g, '') : ''}${f.platform ? '_' + f.platform : ''}.csv`;
  return new NextResponse('﻿' + lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` } });
}
