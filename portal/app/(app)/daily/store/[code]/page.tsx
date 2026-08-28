import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getLatestDate, canSeeStore } from '@/lib/daily';
import StoreView from './view';

// Auth and date-picking live here; the view is in view.tsx so it can be
// rendered in a local harness without a session, which is how its design and
// its data are checked before anything ships. Same split as the central page.
export default async function StoreDaily({ params, searchParams }:
  { params: Promise<{ code: string }>; searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser();
  const { code: codeRaw } = await params;
  const code = decodeURIComponent(codeRaw);
  if (!canSeeStore(user, code)) redirect('/daily');

  const latest = await getLatestDate();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! <= latest ? sp.date! : latest;
  return <StoreView code={code} date={date} latest={latest} />;
}
