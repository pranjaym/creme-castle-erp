// Serves one day's dashboard HTML, gated by login. The middleware already blocks
// anonymous requests; requireUser here is defence in depth. The bytes come from
// the private spine bucket via the service role, so the file is never exposed by a
// public or signed URL, only through this authenticated route.
import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/session';
import { getDashboardHtml } from '@/lib/dashboards';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ date: string }> }
) {
  await requireUser();
  const { date } = await params;
  const html = await getDashboardHtml(date);
  if (html === null) {
    return new NextResponse('Not found', { status: 404 });
  }
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Do not let a shared cache hold internal sales data.
      'Cache-Control': 'private, no-store',
    },
  });
}
