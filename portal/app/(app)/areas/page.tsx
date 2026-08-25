import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getDashAll, getLatestDate, aggregateAreas, inr, n0 } from '@/lib/daily';
import { DashHead, DashScript, AreasTables } from '../daily/ui';

// The five areas: cards plus the comparison table. Management view.
export default async function AreasPage({ searchParams }:
  { searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser();
  if (user.role === 'store' || user.role === 'area_manager') redirect('/daily');

  const latest = await getLatestDate();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! <= latest ? sp.date! : latest;
  const d = await getDashAll(date);
  const areas = aggregateAreas(d.stores);

  return (
    <main className="dashroot" data-view="y">
      <DashHead title="Areas" subtitle="Five area managers, compared. Click an area for its full page."
        date={date} latest={latest} basePath="/areas" toggle />
      <div className="homegrid" style={{ marginBottom: 22 }}>
        {areas.map((a, i) => (
          <Link key={a.am} className="homecard" href={`/daily/area/${encodeURIComponent(a.am)}?date=${date}`}>
            <div className="t">{i + 1}. {a.am}</div>
            <div className="d">{a.stores} stores · {n0(a.day.orders)} orders ·
              {' '}{n0(a.day.comps)} complaints ({a.day.cpct?.toFixed(1) ?? '-'}%) ·
              {' '}{inr(a.wk.stockout + a.wk.refunds)} lost this week</div>
          </Link>
        ))}
      </div>
      <div className="dcard"><AreasTables areas={areas} date={date} /></div>
      <DashScript />
    </main>
  );
}
