// Serves one Area Manager app photo (migration 256) from the private bucket via
// the service role. The person who took it may see it; so may anyone with the
// review grant. Never a public or signed URL.
import { NextResponse } from 'next/server';
import { getSessionUser, portalAccess } from '@/lib/session';
import { spine } from '@/lib/supabase/service';
import { photoFor } from '@/lib/am';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getSessionUser();
  const acc = u ? portalAccess(u).am : null;
  if (!u || !acc || !(acc.use || acc.review)) return new NextResponse('Not allowed for this role.', { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new NextResponse('Not found', { status: 404 });
  const p = await photoFor(id);
  if (!p) return new NextResponse('Not found', { status: 404 });
  if (!acc.review && p.taken_by !== u.id) return new NextResponse('Not allowed for this photo.', { status: 403 });
  const { data, error } = await spine().storage.from('am-photos').download(p.storage_path);
  if (error || !data) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(await data.arrayBuffer(), {
    status: 200,
    headers: { 'Content-Type': p.content_type, 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
}
