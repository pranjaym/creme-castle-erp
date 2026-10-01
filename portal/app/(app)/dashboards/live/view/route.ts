// Serves one painted spot check to the roles allowed the sales dashboard, the
// same gate as the daily dashboard's /view route. The HTML comes from the private
// spotcheck-live bucket via the service role, never through a public or signed URL.
import { NextResponse } from 'next/server';
import { getSessionUser, portalAccess } from '@/lib/session';
import { getPaintHtml } from '@/lib/livewall';

export async function GET(req: Request) {
  const u = await getSessionUser();
  if (!u || !portalAccess(u).sales) return new NextResponse('Not allowed for this role.', { status: 403 });
  const path = new URL(req.url).searchParams.get('f') ?? '';
  const html = await getPaintHtml(path);
  if (html === null) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Do not let a shared cache hold internal sales data.
      'Cache-Control': 'private, no-store',
    },
  });
}
