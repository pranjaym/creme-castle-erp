// CSV of the questions list, same filters as the page, every column. One row
// per question with its latest answer; the row snapshot is flattened to
// "Label: value | Label: value" so it reads in a spreadsheet.
import { NextResponse } from 'next/server';
import { getSessionUser, portalAccess } from '@/lib/session';
import { parseListFilters, listQuestions, statusWord } from '@/lib/questions';

export const dynamic = 'force-dynamic';

function csv(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export async function GET(req: Request) {
  const u = await getSessionUser();
  if (!u || !portalAccess(u).questions.view) return new NextResponse('Not allowed', { status: 403 });
  const url = new URL(req.url);
  const f = parseListFilters(Object.fromEntries(url.searchParams.entries()));
  const rows = await listQuestions(u, f, null);
  const head = ['id', 'status', 'asked_by', 'asked_at', 'store', 'area_manager', 'page', 'page_date', 'section', 'platform',
    'business_date', 'row', 'question', 'due_at', 'answered_by', 'answered_at', 'what_happened', 'cause', 'person', 'person_role',
    'prevention', 'push_backs', 'closed_by', 'closed_at'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([r.id, statusWord(r), r.raised_by_name ?? r.raised_by, r.raised_at_iso, r.outlet_code, r.am, r.page, r.page_date,
      r.section, r.platform, r.business_date, r.row_snapshot.map(x => `${x.label}: ${x.value}`).join(' | '), r.prompt, r.due_at_iso,
      r.answered_by_name, r.answered_at_iso, r.what_happened, r.cause_label ?? r.cause, r.person_name, r.person_role, r.prevention,
      r.push_backs, r.closed_by_name, r.closed_at_iso].map(csv).join(','));
  }
  const name = `questions_${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse('﻿' + lines.join('\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` } });
}
