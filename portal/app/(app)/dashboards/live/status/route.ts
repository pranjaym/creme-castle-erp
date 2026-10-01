// The wall's newest paint, as a tiny JSON answer. The open Live status page asks
// every couple of minutes, so it can offer a newer paint without a reload.
import { NextResponse } from 'next/server';
import { getSessionUser, portalAccess } from '@/lib/session';
import { readStatus } from '@/lib/livewall';

export async function GET() {
  const u = await getSessionUser();
  if (!u || !portalAccess(u).sales) return new NextResponse('Not allowed for this role.', { status: 403 });
  const s = await readStatus();
  return NextResponse.json(
    s ? { file: s.latest.path, time: s.latest.time, date: s.latest.date } : { file: null },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
