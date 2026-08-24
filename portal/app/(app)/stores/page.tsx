import { requireUser } from '@/lib/session';
import { getDashAll, getLatestDate } from '@/lib/daily';
import { redirect } from 'next/navigation';
import { DashHead, DashScript, StoresTables } from '../daily/ui';

// Browse the stores (scoped by role) and open any store's page: this is also
// how admin and central preview exactly what a store manager sees.
export default async function StoresPage({ searchParams }:
  { searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser();
  if (user.role === 'store') redirect('/daily');

  const latest = await getLatestDate();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! <= latest ? sp.date! : latest;
  const d = await getDashAll(date);
  const mine = user.role === 'area_manager'
    ? d.stores.filter(s => user.outletCodes.includes(s.code))
    : d.stores;

  return (
    <main className="dashroot" data-view="y">
      <DashHead title={user.role === 'area_manager' ? 'My stores' : 'All stores'}
        subtitle="Click any store to open its full page, exactly what its manager sees."
        date={date} latest={latest} basePath="/stores" />
      <div className="dcard"><StoresTables stores={mine} date={date} /></div>
      <DashScript />
    </main>
  );
}
