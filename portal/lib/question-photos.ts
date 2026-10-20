// Photos sent with an explanation or an answer (migration 249, 20 Oct 2026).
// Up to four, optional. Checked BEFORE anything is saved, so a refused photo
// never leaves half a record; uploaded AFTER the answer is saved, because a
// photo belongs to that answer (ops.attach_photo ties it to the sender's
// latest answer on the question). Used by questions/actions.ts.
import 'server-only';
import { randomUUID } from 'node:crypto';
import { q } from '@/lib/db';
import { spine } from '@/lib/supabase/service';
import { PHOTO_BUCKET, MAX_PHOTOS } from '@/lib/questions';

const PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
};
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function pickedPhotos(form: FormData): { files: File[]; err: string | null } {
  // an empty file box still posts one nameless, empty file
  const files = form.getAll('photos').filter((v): v is File => typeof v !== 'string' && v.size > 0);
  if (files.length > MAX_PHOTOS) return { files, err: `Send at most ${MAX_PHOTOS} photos. Nothing was saved.` };
  for (const f of files) {
    if (!PHOTO_TYPES[f.type]) return { files, err: `${f.name || 'One file'} is not a photo. Nothing was saved.` };
    if (f.size > MAX_PHOTO_BYTES) return { files, err: `${f.name || 'One photo'} is over 5 MB. Nothing was saved.` };
  }
  return { files, err: null };
}

// Puts one file in the private bucket under the question's folder; returns its path.
export async function uploadPhoto(questionId: number, n: number, f: File): Promise<string> {
  const path = `${questionId}/${Date.now()}-${n}-${randomUUID().slice(0, 8)}.${PHOTO_TYPES[f.type]}`;
  const { error } = await spine().storage.from(PHOTO_BUCKET)
    .upload(path, await f.arrayBuffer(), { contentType: f.type, upsert: false });
  if (error) throw error;
  return path;
}

// Uploads each photo and records it against the sender's answer; returns how many failed.
export async function savePhotos(questionId: number, actor: string, actorName: string, files: File[]): Promise<number> {
  let failed = 0;
  for (const [i, f] of files.entries()) {
    try {
      const path = await uploadPhoto(questionId, i + 1, f);
      await q('select ops.attach_photo($1,$2,$3,$4,$5,$6,$7)', [questionId, actor, actorName, path, f.type, f.size, f.name]);
    } catch { failed++; }
  }
  return failed;
}
