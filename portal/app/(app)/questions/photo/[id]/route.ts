// Serves one photo sent with an explanation or answer (migration 249). The
// middleware already blocks anonymous requests; this checks the viewer may see
// the question: central roles see every outlet, an area manager or a store
// only their own. The bytes come from the private spine bucket via the service
// role, never through a public or signed URL.
import { NextResponse } from 'next/server';
import { getSessionUser, portalAccess } from '@/lib/session';
import { getPhoto, PHOTO_BUCKET } from '@/lib/questions';
import { spine } from '@/lib/supabase/service';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const u = await getSessionUser();
  if (!u || !portalAccess(u).questions.view) return new NextResponse('Not allowed for this role.', { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return new NextResponse('Not found', { status: 404 });
  const p = await getPhoto(id);
  if (!p) return new NextResponse('Not found', { status: 404 });
  const field = u.role === 'area_manager' || u.role === 'store';
  if (field && !u.outletCodes.includes(p.outlet_code)) return new NextResponse('Not allowed for this outlet.', { status: 403 });
  const { data, error } = await spine().storage.from(PHOTO_BUCKET).download(p.storage_path);
  if (error || !data) return new NextResponse('Not found', { status: 404 });
  return new NextResponse(await data.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': p.content_type,
      // a photo never changes once sent; only this person's browser may keep it
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}
