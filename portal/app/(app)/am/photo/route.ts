// Receives one photo from the Area Manager app (migration 256). The phone has
// already shrunk it (about 1280 px, 200 to 400 KB). It goes into the private
// bucket am-photos and gets a row in am.photo; the screen then sends the photo
// id with the answer it belongs to, and the server checks the pairing.
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSessionUser, portalAccess } from '@/lib/session';
import { spine } from '@/lib/supabase/service';
import { one } from '@/lib/db';

export const dynamic = 'force-dynamic';
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' };
const MAX = 5 * 1024 * 1024;

export async function POST(req: Request) {
  const u = await getSessionUser();
  if (!u || !portalAccess(u).am.use) return NextResponse.json({ error: 'Not allowed for this role.' }, { status: 403 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: 'The photo did not arrive. Try again.' }, { status: 400 }); }
  const file = form.get('photo');
  const purpose = String(form.get('purpose') ?? '');
  const visitId = Number(form.get('visitId') ?? 0) || null;
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'No photo in the upload.' }, { status: 400 });
  if (!TYPES[file.type]) return NextResponse.json({ error: 'That file is not a photo.' }, { status: 400 });
  if (file.size > MAX) return NextResponse.json({ error: 'That photo is over 5 MB.' }, { status: 400 });
  if (!/^(front|stock_screen|audit:[A-Z][0-9]|order:(pp_po|pp_to|sn_po|sn_so))$/.test(purpose)) return NextResponse.json({ error: 'Unknown photo purpose.' }, { status: 400 });
  if (purpose !== 'front') {
    const v = await one<{ person: string; status: string }>('select person, status from am.visit where id = $1 and voided_at is null', [visitId]);
    if (!v || v.person !== u.id || v.status !== 'in_progress') return NextResponse.json({ error: 'Not allowed: this visit is not yours or is closed.' }, { status: 403 });
  }
  const path = `${visitId ?? 'checkin'}/${Date.now()}-${purpose.replace(':', '-')}-${randomUUID().slice(0, 8)}.${TYPES[file.type]}`;
  const { error } = await spine().storage.from('am-photos').upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (error) return NextResponse.json({ error: 'The photo did not save. Try again.' }, { status: 502 });
  const row = await one<{ id: string }>(
    'insert into am.photo (visit_id, purpose, storage_path, content_type, bytes, taken_by) values ($1,$2,$3,$4,$5,$6) returning id',
    [purpose === 'front' ? null : visitId, purpose, path, file.type, file.size, u.id]);
  return NextResponse.json({ ok: true, id: Number(row!.id) });
}
