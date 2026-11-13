// Old address of the AM visit app (13 Nov 2026); it moved to /area-manager-visit.
import { redirect } from 'next/navigation';
import { requireAccess } from '@/lib/session';

export default async function OldAm() {
  await requireAccess(a => a.am.use || a.am.review);
  redirect('/area-manager-visit');
}
