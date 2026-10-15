// CSV of the Issues to Ask list, same filters as the page, every column, with
// the row's question status and key so it can be matched back to /questions.
import { NextResponse } from 'next/server';
import { getSessionUser, portalAccess } from '@/lib/session';
import { getLatestDate } from '@/lib/daily';
import { parseIssueFilters, listIssues, inScope } from '@/lib/issues';
import { questionsForOutlets, statusWord } from '@/lib/questions';

export const dynamic = 'force-dynamic';

function csv(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export async function GET(req: Request) {
  const u = await getSessionUser();
  if (!u || !portalAccess(u).network || !portalAccess(u).questions.ask) return new NextResponse('Not allowed', { status: 403 });
  const url = new URL(req.url);
  const latest = await getLatestDate();
  const f = parseIssueFilters(Object.fromEntries(url.searchParams.entries()), latest);
  const rows = (await listIssues(f.from, f.to)).filter(r => inScope(r, f) && r.issue_kind !== 'Listed, not trading');
  const qmap = await questionsForOutlets([...new Set(rows.map(r => r.outlet_code))]);
  const head = ['day', 'time', 'app', 'region', 'city', 'area_manager', 'outlet', 'issue_type', 'issue', 'detail', 'order_no',
    'ordered', 'customer_asked_for', 'customer_words', 'value', 'refund', 'must_answer', 'status', 'question_id', 'explained_unasked', 'row_key'];
  const lines = [head.join(',')];
  for (const r of rows) {
    const qr = qmap.get(r.anchor_key);
    const status = qr ? statusWord(qr) : 'not asked';
    if (f.status && !((f.status === 'none' && !qr) || (qr && (f.status === status || (f.status === 'unasked' && qr.started_by_field && qr.status === 'answered'))))) continue;
    lines.push([r.business_date, r.order_time, r.platform === 'Z' ? 'Zomato' : 'Swiggy', r.region, r.city, r.am, r.outlet_code,
      r.issue_type, r.issue_kind, r.detail, r.order_id, r.basket, r.customer_asked, r.customer_words, r.value, r.refund,
      r.must_answer ? 'yes' : 'no', status, qr?.id, qr?.started_by_field ? 'yes' : 'no', r.anchor_key].map(csv).join(','));
  }
  const name = `issues_${f.from}_to_${f.to}.csv`;
  return new NextResponse('﻿' + lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` } });
}
