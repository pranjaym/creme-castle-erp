import { redirect } from 'next/navigation';
import { requireAccess } from '@/lib/session';
import { getDashAll, getLatestDate, allowedAms } from '@/lib/daily';
import AreaView from './view';

// Auth and date-picking live here; the body is in view.tsx so it can be
// rendered in a local harness without a session, the same split as the store
// and central pages.
export default async function AreaDaily({ params, searchParams }:
  { params: Promise<{ am: string }>; searchParams: Promise<{ date?: string; q?: string; ask?: string; ok?: string; err?: string }> }) {
  // An area page lists every store in the area, so a store account (whose part
  // is its own store) is sent back to its own page. AMs see only their own area.
  const user = await requireAccess(a => a.storeList, '/daily');
  const { am: amRaw } = await params;
  const am = decodeURIComponent(amRaw);

  const latest = await getLatestDate();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! <= latest ? sp.date! : latest;

  const all = await getDashAll(date);
  if (!allowedAms(user, all.stores).includes(am)) redirect('/daily');
  return <AreaView am={am} date={date} latest={latest} user={user} sp={sp} />;
}
