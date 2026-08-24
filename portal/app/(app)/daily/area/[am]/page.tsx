import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getDashAll, getLatestDate, aggregateAreas, allowedAms, inr, n0, n1 } from '@/lib/daily';
import { DashHead, DashScript, Tile, V, D, SecHead, StoresTables, AreasTables } from '../../ui';

export default async function AreaDaily({ params, searchParams }:
  { params: Promise<{ am: string }>; searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser();
  const { am: amRaw } = await params;
  const am = decodeURIComponent(amRaw);

  const latest = await getLatestDate();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! <= latest ? sp.date! : latest;
  const d = await getDashAll(date);

  if (!allowedAms(user, d.stores).includes(am)) redirect('/daily');
  const mine = d.stores.filter(s => (s.am ?? 'Unassigned') === am);
  if (mine.length === 0) redirect('/daily');
  const areas = aggregateAreas(d.stores);
  const a = areas.find(x => x.am === am)!;

  const attention: React.ReactNode[] = [];
  const hotspot = mine.filter(s => (s.day.comps ?? 0) >= 2)
    .sort((x, y) => (y.day.cpct ?? 0) - (x.day.cpct ?? 0))[0];
  if (hotspot) attention.push(<li key="c"><b>{hotspot.code}</b>: {n0(hotspot.day.comps)} complaints on {n0(hotspot.day.orders)} orders ({n1(hotspot.day.cpct)}%). Ask what went out wrong.</li>);
  const frTop = [...mine].sort((x, y) => (y.wk.fr ?? 0) - (x.wk.fr ?? 0))[0];
  if (frTop && (frTop.wk.fr ?? 0) >= 15) attention.push(<li key="f"><b>{frTop.code}</b> pressed &quot;ready&quot; early on {n0(frTop.wk.fr)} orders this week while the rider waited. Remind them: press ready only when the bag is sealed.</li>);
  const offline = mine.filter(s => (s.day.offmin ?? 0) >= 15)
    .sort((x, y) => (y.day.offmin ?? 0) - (x.day.offmin ?? 0))[0];
  if (offline) attention.push(<li key="o"><b>{offline.code}</b> was offline {n0(offline.day.offmin)} minutes. Ask what happened at the tablet.</li>);
  const stockTop = [...mine].sort((x, y) => (y.wk.stockout ?? 0) - (x.wk.stockout ?? 0))[0];
  if (stockTop && (stockTop.wk.stockout ?? 0) >= 1500) attention.push(<li key="s"><b>{stockTop.code}</b> lost {inr(stockTop.wk.stockout)} to stockout rejections this week. Check its prep and stock list.</li>);
  const best = [...mine].sort((x, y) => (x.dayRank ?? 99) - (y.dayRank ?? 99))[0];
  if (best?.dayRank) attention.push(<li key="g"><b>Good news to pass on:</b> {best.code} ranks {best.dayRank} of {d.stores.length} network-wide for the day.</li>);

  return (
    <main className="dashroot" data-view="y">
      <DashHead title={`Area Daily: ${am}`}
        subtitle={`${mine.length} stores. Zomato operations.`}
        date={date} latest={latest} basePath={`/daily/area/${encodeURIComponent(am)}`} />

      <div className="dctx">
        <Tile label="Orders"
          y={<V>{n0(a.day.orders)}</V>}
          wk={<><V>{n0(a.wk.orders)}</V><D>{n0(Math.round(a.wk.orders / 7))} per day</D></>} />
        <Tile label="Complaints"
          y={<V>{n0(a.day.comps)} <small>({a.day.cpct?.toFixed(1) ?? '-'}%)</small></V>}
          wk={<V>{n0(a.wk.comps)} <small>({a.wk.cpct?.toFixed(1) ?? '-'}%)</small></V>} />
        <Tile label="Store-caused rejections"
          y={<V>{n0(a.day.srej)}</V>} wk={<V>{n0(a.wk.srej)}</V>} />
        <Tile label="Money lost, week"
          y={<><V>{inr(a.wk.stockout + a.wk.refunds)}</V><D>{inr(a.wk.stockout)} stockouts + {inr(a.wk.refunds)} refunds</D></>}
          wk={<><V>{inr(a.wk.stockout + a.wk.refunds)}</V><D>{inr(a.wk.stockout)} stockouts + {inr(a.wk.refunds)} refunds</D></>} />
      </div>

      <div className="attention">
        <h2>Where you are needed</h2>
        <ol>{attention.slice(0, 5)}</ol>
      </div>

      <SecHead num="1">Your stores, best rank first</SecHead>
      <div className="dcard"><StoresTables stores={mine} date={date} /></div>

      <SecHead num="2">Area versus area</SecHead>
      <div className="dcard"><AreasTables areas={areas} date={date} /></div>

      <div className="dfoot">
        <p>Click a store for its full page: complaints with the exact orders, rejections with baskets and value,
        and the false ready-presses one by one. Kitchen preparation time is excluded permanently
        (verified: it measures tablet button-pressing, not kitchen work).</p>
      </div>
      <DashScript />
    </main>
  );
}
