import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getDashAll, getLatestDate, aggregateAreas, inr, lakh, n0, n1 } from '@/lib/daily';
import { DashHead, DashScript, Tile, V, D, HBar, SecHead, StoresTables, AreasTables } from '../ui';

export default async function CentralDaily({ searchParams }:
  { searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser();
  // Store and area accounts have their own pages; the network view is central's.
  if (user.role === 'store') redirect('/daily');
  if (user.role === 'area_manager') redirect('/daily');

  const latest = await getLatestDate();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! <= latest ? sp.date! : latest;
  const d = await getDashAll(date);
  const areas = aggregateAreas(d.stores);

  const sum = (f: (s: typeof d.stores[number]) => number | null | undefined) =>
    d.stores.reduce((t, s) => t + (f(s) ?? 0), 0);
  const ordersDay = sum(s => s.day.orders), compsDay = sum(s => s.day.comps);
  const srejDay = sum(s => s.day.srej), avgDay = sum(s => s.day.avgord);
  const ordersWk = sum(s => s.wk.orders), compsWk = sum(s => s.wk.comps);
  const srejWk = sum(s => s.wk.srej), frWk = sum(s => s.wk.fr);
  const moneyWk = sum(s => s.wk.stockout) + sum(s => s.wk.refunds);
  const lev = d.levers;

  // Rule-based attention list: worst offline, worst complaints, false-ready
  // leader, worst area, plus one good-news line. Same data everyone else sees.
  const attention: React.ReactNode[] = [];
  const offline = d.stores.filter(s => (s.day.online ?? 100) < 97)
    .sort((a, b) => (a.day.online ?? 100) - (b.day.online ?? 100))[0];
  if (offline) attention.push(<li key="off"><b>{offline.code}</b> was online only {n1(offline.day.online)}% ({n0(offline.day.offmin)} min offline). Ask what happened at the tablet.</li>);
  const hotspot = d.stores.filter(s => (s.day.comps ?? 0) >= 3)
    .sort((a, b) => (b.day.cpct ?? 0) - (a.day.cpct ?? 0))[0];
  if (hotspot) attention.push(<li key="comp"><b>{hotspot.code}</b> is the day&apos;s complaint hotspot: {n0(hotspot.day.comps)} complaints on {n0(hotspot.day.orders)} orders ({n1(hotspot.day.cpct)}%).</li>);
  const frTop = [...d.stores].sort((a, b) => (b.wk.fr ?? 0) - (a.wk.fr ?? 0))[0];
  if (frTop && (frTop.wk.fr ?? 0) >= 20) attention.push(<li key="fr"><b>False ready-pressing</b>: {n0(frWk)} orders this week network-wide; worst is <b>{frTop.code}</b> with {n0(frTop.wk.fr)}.</li>);
  const worstArea = [...areas].reverse()[0];
  if (worstArea && (worstArea.day.cpct ?? 0) > 0) attention.push(<li key="area"><b>{worstArea.am}&apos;s area</b> has the day&apos;s highest complaint rate ({worstArea.day.cpct?.toFixed(2)}%).</li>);
  const best = d.stores.find(s => s.dayRank === 1);
  if (best) attention.push(<li key="good"><b>Good news:</b> {best.code} is the day&apos;s best-run store ({n0(best.day.orders)} orders, {n0(best.day.comps)} complaints, {n1(best.day.online)}% online).</li>);

  const r = d.reasons_wk;
  return (
    <main className="dashroot" data-view="y">
      <DashHead title="Network Daily: all dark stores" subtitle={`${d.stores.length} stores, ${areas.length} areas. Zomato operations.`}
        date={date} latest={latest} basePath="/daily/central" />

      <div className="dctx">
        <Tile label="Orders"
          y={<><V>{n0(ordersDay)}</V><D>{avgDay ? `vs ${n0(avgDay)} own 7-day average` : ''}</D></>}
          wk={<><V>{n0(ordersWk)}</V><D>{n0(Math.round(ordersWk / 7))} per day</D></>} />
        <Tile label="Net sales"
          y={<><V>{lakh(lev?.seg_day?.net_sales)}</V><D>subtotal {lakh(lev?.seg_day?.subtotal)}</D></>}
          wk={<><V>{lakh(lev?.seg_wk?.net_sales)}</V><D>subtotal {lakh(lev?.seg_wk?.subtotal)}</D></>} />
        <Tile label="Complaints"
          y={<><V>{n0(compsDay)} <small>({ordersDay ? (100 * compsDay / ordersDay).toFixed(1) : '-'}%)</small></V></>}
          wk={<><V>{n0(compsWk)} <small>({ordersWk ? (100 * compsWk / ordersWk).toFixed(1) : '-'}%)</small></V></>} />
        <Tile label="Store-caused rejections"
          y={<V>{n0(srejDay)}</V>} wk={<V>{n0(srejWk)}</V>} />
        <Tile label="Money lost, week" y={<V>{inr(moneyWk)}</V>} wk={<V>{inr(moneyWk)}</V>} />
        <Tile label="False ready-presses, week" y={<V>{n0(frWk)}</V>} wk={<V>{n0(frWk)}</V>} />
      </div>

      <div className="attention">
        <h2>What deserves central attention</h2>
        <ol>{attention.slice(0, 5)}</ol>
      </div>

      <SecHead num="1">Area versus area</SecHead>
      <div className="dcard"><AreasTables areas={areas} date={date} /></div>

      <SecHead num="2">All stores, ranked</SecHead>
      <div className="dcard"><StoresTables stores={d.stores} date={date} /></div>

      {r ? (
        <>
          <SecHead num="3">The week&apos;s complaint reasons, network-wide</SecHead>
          <div className="dcard">
            <HBar rows={[
              { name: 'Poor packaging or spillage', value: r.packaging ?? 0 },
              { name: 'Poor taste or quality', value: r.quality ?? 0 },
              { name: 'Delivered late', value: r.late ?? 0 },
              { name: 'Wrong items', value: r.wrong ?? 0 },
              { name: 'Items missing', value: r.missing ?? 0 },
            ].sort((a, b) => b.value - a.value)} />
            <p className="note">{n0(r.comps)} complaints in the 7 days; one complaint can carry several reason tags.</p>
          </div>
        </>
      ) : null}

      <SecHead num="4">Central levers (not shown to stores or area managers)</SecHead>
      <div className="dcard">
        <div className="dctx" style={{ margin: '4px 0 0' }}>
          <Tile label="Discounts given"
            y={<><V>{lakh(lev?.seg_day?.discount)}</V><D>{lev?.seg_day?.subtotal ? (100 * (lev.seg_day.discount ?? 0) / lev.seg_day.subtotal).toFixed(1) + '% of subtotal' : ''}</D></>}
            wk={<><V>{lakh(lev?.seg_wk?.discount)}</V><D>{lev?.seg_wk?.subtotal ? (100 * (lev.seg_wk.discount ?? 0) / lev.seg_wk.subtotal).toFixed(1) + '% of subtotal' : ''}</D></>} />
          <Tile label="Ad spend"
            y={<><V>{inr(lev?.ads_day?.spend)}</V><D>{lev?.ads_day?.spend ? 'ROI ' + ((lev.ads_day.ad_sales ?? 0) / lev.ads_day.spend).toFixed(1) : ''}</D></>}
            wk={<><V>{inr(lev?.ads_wk?.spend)}</V><D>{lev?.ads_wk?.spend ? 'ROI ' + ((lev.ads_wk.ad_sales ?? 0) / lev.ads_wk.spend).toFixed(1) : ''}</D></>} />
          <Tile label="Ad-attributed orders"
            y={<><V>{n0(lev?.ads_day?.ad_orders)}</V><D>as attributed by Zomato; directional</D></>}
            wk={<><V>{n0(lev?.ads_wk?.ad_orders)}</V><D>as attributed by Zomato; directional</D></>} />
          <Tile label="Funnel"
            y={<><V>{n0(lev?.seg_day?.impressions)} &#8594; {n0(lev?.seg_day?.menu_opens)} &#8594; {n0(lev?.seg_day?.orders)}</V><D>impressions to menu opens to orders</D></>}
            wk={<><V>{n0(lev?.seg_wk?.impressions)} &#8594; {n0(lev?.seg_wk?.menu_opens)} &#8594; {n0(lev?.seg_wk?.orders)}</V><D>impressions to menu opens to orders</D></>} />
        </div>
        <p className="note">Ad figures restate for days after the fact; treat recent ad numbers as provisional.</p>
      </div>

      <div className="dfoot">
        <p>Every figure comes from the spine (functions dash_all / dash_store_detail) and is reproducible by query.
        Kitchen preparation time is excluded permanently: verified 23 Aug 2026, it measures tablet button-pressing,
        not kitchen work. Rider wait is the verified speed measure, identical across two independent Zomato feeds.</p>
      </div>
      <DashScript />
    </main>
  );
}
