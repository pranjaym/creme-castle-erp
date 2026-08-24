import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { getDashAll, getLatestDate, aggregateAreas, inr, lakh, n0, n1 } from '@/lib/daily';
import { V, D } from './daily/ui';

// Home: the compass. Role-aware, every number is a door (the OMS principle).
// Central and admin land on the network read; an area manager on their area;
// a store on their own numbers. All figures are the latest loaded day.
export default async function Home() {
  const user = await requireUser();
  const latest = await getLatestDate();
  const d = await getDashAll(latest);
  const dateLabel = new Date(latest + 'T00:00:00').toLocaleDateString('en-IN',
    { weekday: 'long', day: 'numeric', month: 'long' });

  const mine = (user.role === 'store' || user.role === 'area_manager')
    ? d.stores.filter(s => user.outletCodes.includes(s.code))
    : d.stores;
  const areas = aggregateAreas(d.stores);

  const sum = (f: (s: typeof d.stores[number]) => number | null | undefined) =>
    mine.reduce((t, s) => t + (f(s) ?? 0), 0);
  const orders = sum(s => s.day.orders);
  const comps = sum(s => s.day.comps);
  const srej = sum(s => s.day.srej);
  const frWk = sum(s => s.wk.fr);
  const moneyWk = sum(s => s.wk.stockout) + sum(s => s.wk.refunds);

  const greeting = `Welcome, ${user.fullName || user.email}`;

  // Store account: their tiles plus the door to their page.
  if (user.role === 'store' && mine.length === 1) {
    const s = mine[0];
    const href = `/daily/store/${encodeURIComponent(s.code)}`;
    return (
      <main className="dashroot" data-view="y">
        <h1 className="page">{greeting}</h1>
        <p className="freshline">{s.code} · data up to {dateLabel}</p>
        <div className="dctx">
          <Link href={href} className="dtile"><div className="dlabel">Orders</div><V>{n0(s.day.orders)}</V></Link>
          <Link href={href} className="dtile"><div className="dlabel">Complaints</div><V>{n0(s.day.comps)}</V></Link>
          <Link href={href} className="dtile"><div className="dlabel">Online</div><V>{s.day.online === null ? '-' : n1(s.day.online) + '%'}</V></Link>
          <Link href={href} className="dtile"><div className="dlabel">Network rank</div><V>{s.dayRank ?? '-'} <small>of {d.stores.length}</small></V></Link>
        </div>
        <Link className="primary" href={href} style={{ display: 'inline-block', textDecoration: 'none' }}>
          Open my store page
        </Link>
      </main>
    );
  }

  const lev = d.levers;
  const worst = [...mine].sort((a, b) => (b.dayRank ?? 0) - (a.dayRank ?? 0)).slice(0, 3);
  const best = [...mine].sort((a, b) => (a.dayRank ?? 99) - (b.dayRank ?? 99)).slice(0, 3);
  const dailyHref = user.role === 'area_manager' ? '/daily' : '/daily/central';

  return (
    <main className="dashroot" data-view="y">
      <h1 className="page">{greeting}</h1>
      <p className="freshline">
        Showing <b>{dateLabel}</b>, the newest settled day (Zomato keeps revising the last 2 days, so they are hidden on purpose). Every number below opens the page that explains it.
      </p>

      <div className="dctx">
        <Link href={dailyHref} className="dtile"><div className="dlabel">Orders</div>
          <V>{n0(orders)}</V><D>{mine.length} stores</D></Link>
        {user.role !== 'area_manager' ? (
          <Link href={dailyHref} className="dtile"><div className="dlabel">Net sales</div>
            <V>{lakh(lev?.seg_day?.net_sales)}</V><D>subtotal {lakh(lev?.seg_day?.subtotal)}</D></Link>
        ) : null}
        <Link href={dailyHref} className="dtile"><div className="dlabel">Complaints</div>
          <V>{n0(comps)} <small>({orders ? (100 * comps / orders).toFixed(1) : '-'}%)</small></V></Link>
        <Link href={dailyHref} className="dtile"><div className="dlabel">Store rejections</div>
          <V>{n0(srej)}</V></Link>
        <Link href={dailyHref} className="dtile"><div className="dlabel">False ready-presses, week</div>
          <V>{n0(frWk)}</V></Link>
        <Link href={dailyHref} className="dtile"><div className="dlabel">Money lost, week</div>
          <V>{inr(moneyWk)}</V><D>stockouts + refunds</D></Link>
      </div>

      {user.role !== 'area_manager' ? (
        <>
          <h2 className="section">Areas</h2>
          <div className="homegrid">
            {areas.map((a, i) => (
              <Link key={a.am} className="homecard" href={`/daily/area/${encodeURIComponent(a.am)}`}>
                <div className="t">{i + 1}. {a.am}</div>
                <div className="d">{a.stores} stores · {n0(a.day.orders)} orders · {n0(a.day.comps)} complaints
                  ({a.day.cpct?.toFixed(1) ?? '-'}%) · {n0(a.wk.fr)} false-ready this week</div>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <h2 className="section">Needs a look</h2>
      <div className="homegrid">
        {worst.map(s => (
          <Link key={s.code} className="homecard" href={`/daily/store/${encodeURIComponent(s.code)}`}>
            <div className="t">{s.code} <span className="flag">rank {s.dayRank ?? '-'}</span></div>
            <div className="d">{n0(s.day.orders)} orders · {n0(s.day.comps)} complaints ·
              online {s.day.online === null ? '-' : n1(s.day.online) + '%'} · {n0(s.wk.fr)} false-ready wk</div>
          </Link>
        ))}
      </div>

      <h2 className="section">Running well</h2>
      <div className="homegrid">
        {best.map(s => (
          <Link key={s.code} className="homecard" href={`/daily/store/${encodeURIComponent(s.code)}`}>
            <div className="t">{s.code} <span className="goodv">rank {s.dayRank ?? '-'}</span></div>
            <div className="d">{n0(s.day.orders)} orders · {n0(s.day.comps)} complaints ·
              online {s.day.online === null ? '-' : n1(s.day.online) + '%'}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
