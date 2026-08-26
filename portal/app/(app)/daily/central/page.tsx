import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getLatestDate } from '@/lib/daily';
import CentralView from './view';

// The network page. Auth and date-picking live here; the view itself is in
// view.tsx so it can be rendered in a local harness without a session, which
// is how its design was checked before it shipped.
export default async function CentralDaily({ searchParams }:
  { searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser();
  // Store and area accounts have their own pages; the network view is central's.
  if (user.role === 'store' || user.role === 'area_manager') redirect('/daily');

  const latest = await getLatestDate();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! <= latest ? sp.date! : latest;
  return <CentralView date={date} latest={latest} />;
}
