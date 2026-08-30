import {
  getDashAll, getCentralDetail, getCentralSwiggy,
  inr, lakh, n0, n1, clockTime, dShort, type StoreStats, type CentralReceipt,
} from '@/lib/daily';
import {
  DashHead, DashScript, SecHead, Period, Fold, Rows, Tag, Basket, Chart, DipCard,
  Lead, VTile, CentralStores, CentralAreas, Funnel, ShutShop, Words, type CentralArea,
} from '../ui';
import { AppTag, AppTabs, AppRows, FaultTag, SwiggyStoresTable, ShortCard } from '../swiggy-ui';

// See the store page for why this note exists. Updated 30 Aug 2026 when
// Swiggy joined the page.
const RECONCILE = '<b>Reading this next to Petpooja?</b> Differences are definitions, not errors. Petpooja still shows more orders because walk-in and website are not here. Zomato files an order under the calendar day, Swiggy under the midnight-to-midnight day, Petpooja under the trading night, so post-midnight orders sit on different days. Swiggy splits multi-cake orders into separate deliveries with new order numbers, so order-by-order matching never reaches 100%; the daily bridge in section 12 quantifies it. And rank 1 means the best-RUN store of the day, never the busiest.';

// The central page, approved design v1 (26 Aug 2026). It asks a third
// question, not the store's "what happened here" and not the area's "which of
// my stores needs me today", but "where do I put pressure across the network,
// and which lever do I pull". Two things follow from that and run through the
// whole page: every receipt names its outlet AND its area manager, because
// central acts through the AM and never directly on the store; and every lever
// number lists the stores behind it, which is the "no number without its
// orders" rule expressed at the level central actually acts.

// A network week runs to several hundred complaint rows, so the two longest
// week lists are capped. The day's own lists are never capped, the cap is
// printed on the page, and each store page carries its own full list.
const COMPW_CAP = 120;
const LOWW_CAP = 100;

export default async function CentralView({ date, latest }: { date: string; latest: string }) {
  const [all, D, SW] = await Promise.all([getDashAll(date), getCentralDetail(date), getCentralSwiggy(date)]);
  const stores = all.stores;
  const lev = all.levers;
  const segd = lev?.seg_day ?? null, segw = lev?.seg_wk ?? null, adsw = lev?.ads_wk ?? null;
  const reasons = all.reasons_wk;

  const dshort = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const wkLabel = `Last 7 days (${new Date(D.week_start + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} to ${dshort})`;

  const sum = (f: (s: StoreStats) => number | null | undefined, xs: StoreStats[] = stores) =>
    xs.reduce((t, s) => t + (f(s) ?? 0), 0);

  // Money lost reads the CENTRAL function, not dash_all: dash_all still carries
  // the old store-caused rejection list (flag F32) and under-counts. Every money
  // figure on this page therefore uses one definition.
  const money = new Map(D.money_stores.map(m => [m.code, m.total_wk]));
  const moneyWk = D.money_stores.reduce((t, m) => t + m.total_wk, 0);

  const ordersDay = sum(s => s.day.orders), ordersWk = sum(s => s.wk.orders);
  const compsDay = sum(s => s.day.comps), compsWk = sum(s => s.wk.comps);
  const srejDay = sum(s => s.day.srej), srejWk = sum(s => s.wk.srej);
  const frWk = sum(s => s.wk.fr);
  const deliveredWk = sum(s => s.wk.delivered), waits3Wk = sum(s => s.wk.waits3);
  const offminDay = sum(s => s.day.offmin);
  const cpctDay = ordersDay ? (100 * compsDay) / ordersDay : null;
  const cpctWk = ordersWk ? (100 * compsWk) / ordersWk : null;
  const avgDayOrders = Math.round(ordersWk / 7);

  const trend = D.trend;
  const waits = trend.map(t => t.wait).filter((v): v is number => v !== null);
  const waitDay = trend.length ? trend[trend.length - 1].wait : null;
  const waitWk = waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null;
  const onlineDay = trend.length ? trend[trend.length - 1].online : null;
  const pct3 = deliveredWk ? (100 * waits3Wk) / deliveredWk : null;

  // Area rollups: plain arithmetic over the same store rows everyone else sees.
  const byAm = new Map<string, StoreStats[]>();
  for (const s of stores) {
    const am = s.am ?? 'Unassigned';
    if (!byAm.has(am)) byAm.set(am, []);
    byAm.get(am)!.push(s);
  }
  const mean = (xs: StoreStats[], f: (s: StoreStats) => number | null) => {
    const vs = xs.map(f).filter((v): v is number => !!v);
    return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  };
  const areas: CentralArea[] = [...byAm.entries()].map(([am, xs]) => {
    const dOrders = sum(s => s.day.orders, xs), dComps = sum(s => s.day.comps, xs);
    const wOrders = sum(s => s.wk.orders, xs), wComps = sum(s => s.wk.comps, xs);
    return {
      am, stores: xs.length,
      d_orders: dOrders, d_comps: dComps, d_cpct: dOrders ? (100 * dComps) / dOrders : null,
      d_srej: sum(s => s.day.srej, xs), d_off: sum(s => s.day.offmin, xs),
      d_rating: mean(xs, s => s.day.rating),
      w_orders: wOrders, w_comps: wComps, w_cpct: wOrders ? (100 * wComps) / wOrders : null,
      w_srej: sum(s => s.wk.srej, xs), w_off: sum(s => s.wk.offmin, xs),
      w_fr: sum(s => s.wk.fr, xs), w_wait: mean(xs, s => s.wk.wait),
      w_money: xs.reduce((t, s) => t + (money.get(s.code) ?? 0), 0),
    };
  });

  // The Swiggy half of the day (approved merged design, 30 Aug 2026).
  const SL = SW.levers;
  const sOrdersDay = SW.stores.reduce((t, s) => t + (s.orders ?? 0), 0);
  const totOrdersDay = ordersDay + sOrdersDay;
  const sLowDayN = SW.low_day.filter(r => (r.rating ?? 9) <= 2).length;
  const sCancDayVal = SW.canc_day.reduce((t, c) => t + (c.val ?? 0), 0);
  const sCancWkVal = SW.canc_wk.reduce((t, c) => t + (c.val ?? 0), 0) + sCancDayVal;
  const sMoneyByCode = new Map(SW.money_stores.map(m => [m.code, m.canc_val_wk]));
  const unhappyDay = compsDay + sLowDayN;
  const unhappyPct = totOrdersDay ? (100 * unhappyDay) / totOrdersDay : null;
  const turnDayN = srejDay + SW.canc_day.length;
  const turnPct = totOrdersDay ? (100 * turnDayN) / (totOrdersDay + turnDayN) : null;
  const roasDay = SL.burn_day ? (SL.adsg_day ?? 0) / SL.burn_day : null;
  const roasWk = SL.burn_wk ? (SL.adsg_wk ?? 0) / SL.burn_wk : null;
  const sByAm = new Map<string, { orders: number; low: number; canc: number; money: number }>();
  for (const s of SW.stores) {
    const k = s.am ?? 'Unassigned';
    const a = sByAm.get(k) ?? { orders: 0, low: 0, canc: 0, money: 0 };
    a.orders += s.orders ?? 0; a.low += s.low; a.canc += s.canc;
    a.money += sMoneyByCode.get(s.code) ?? 0;
    sByAm.set(k, a);
  }
  const sTrendLabels = SW.trend.map(t => t.d.slice(-2));
  const sTrendTips = SW.trend.map(t => new Date(t.d + 'T00:00:00')
    .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));

  const today = (r: CentralReceipt) => r.today === true;
  const earlier = (r: CentralReceipt) => r.today !== true;
  const rejT = D.rejections.filter(today), rejW = D.rejections.filter(earlier);
  const compT = D.complaints.filter(today), compW = D.complaints.filter(earlier).slice(0, COMPW_CAP);
  const compWAll = D.complaints.filter(earlier).length;
  const lowT = D.low_ratings.filter(today), lowW = D.low_ratings.filter(earlier).slice(0, LOWW_CAP);
  const lowWAll = D.low_ratings.filter(earlier).length;
  const rejValDay = rejT.reduce((t, r) => t + (r.value ?? 0), 0);
  const rejValWk = D.rejections.reduce((t, r) => t + (r.value ?? 0), 0);
  const untagged = compT.filter(r => r.tag === 'reason not tagged by Zomato').length;

  const tagCounts = new Map<string, number>();
  for (const r of compW) tagCounts.set(r.tag!, (tagCounts.get(r.tag!) ?? 0) + 1);
  const chips = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

  const labels = trend.map(t => t.d.slice(-2));
  const tips = trend.map(t => new Date(t.d + 'T00:00:00')
    .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));

  // Attention list: rule-based, every line naming the outlet and its AM and
  // pointing at the section that proves it.
  const att: React.ReactNode[] = [];
  const dip = D.online_dips[0];
  if (dip) att.push(<li key="o"><b>{dip.code} ({dip.am}&apos;s area) lost {n0(dip.offmin_day)} minutes of
    trading</b>: online {dip.online_day.toFixed(2)}% on {dshort}. Section 4 shows its week.</li>);
  const hot = stores.filter(s => (s.day.comps ?? 0) >= 3).sort((a, b) => (b.day.cpct ?? 0) - (a.day.cpct ?? 0))[0];
  if (hot) att.push(<li key="c"><b>{hot.code} ({hot.am}&apos;s area) is the day&apos;s complaint hotspot</b>:
    {' '}{n0(hot.day.comps)} complaints on {n0(hot.day.orders)} orders ({n1(hot.day.cpct)}%, against
    {' '}{cpctDay?.toFixed(2)}% for the network). Section 7 lists every one of them.</li>);
  const byCpct = [...areas].sort((a, b) => (a.d_cpct ?? 99) - (b.d_cpct ?? 99));
  if (byCpct.length > 1) {
    const worst = byCpct[byCpct.length - 1], best = byCpct[0];
    att.push(<li key="a"><b>{worst.am}&apos;s area has the day&apos;s worst complaint rate</b>
      {' '}({worst.d_cpct?.toFixed(2)}% on {n0(worst.d_orders)} orders across {worst.stores} stores) and
      {' '}{best.am}&apos;s the best ({best.d_cpct?.toFixed(2)}%). Section 2 puts the five side by side.</li>);
  }
  const fr = D.fr_stores[0];
  if (fr) att.push(<li key="f"><b>&quot;Ready&quot; is being pressed before the food exists</b>: {n0(frWk)} orders
    network-wide this week, worst is {fr.code} ({fr.am}&apos;s area) with {n0(fr.fr_wk)}, {n1(fr.pct)}% of
    everything it delivered. Section 10 names them.</li>);
  const m = D.money_stores[0];
  if (m) att.push(<li key="m"><b>{inr(moneyWk)} of trade was lost to rejections and refunds this week</b>; the
    largest single loser is {m.code} ({m.am}&apos;s area) at {inr(m.total_wk)}. Section 11 splits it per store.</li>);
  if (D.shut_orders.length) {
    const sv = D.shut_orders.reduce((t, r) => t + (r.value ?? 0), 0);
    const w = D.shut_stores[0];
    att.push(<li key="s"><b>{n0(D.shut_orders.length)} orders were turned away because the shop was shut</b>
      {' '}({inr(sv)} this week), worst is {w.code} ({w.am}&apos;s area) on {w.days} separate
      {w.days > 1 ? ' days' : ' day'}. Every one of those stores was showing as open on Zomato at the time.
      Section 5 lists them by store and by hour.</li>);
  }
  const best = stores.find(s => s.dayRank === 1);
  if (best) att.push(<li key="g"><b>Good news to pass on:</b> {best.code} ({best.am}&apos;s area) is the best-run
    store of the day: {n0(best.day.orders)} orders, {n0(best.day.comps)} complaints,
    {' '}{best.day.online?.toFixed(2)}% online.</li>);

  const compCols = ['Store', 'AM', 'Time', 'Tag on the order', 'What was in the order',
    'What the customer wrote', 'Refunded'];
  const compColsWk = ['Store', 'AM', 'Day', 'Time', 'Tag on the order', 'What was in the order',
    'What the customer wrote', 'Refunded'];

  return (
    <main className="dashroot central">
      <DashHead title="The whole network" subtitle={`${stores.length} stores, ${areas.length} areas. Zomato + Swiggy.`}
        date={date} latest={latest} basePath="/daily/central" />

      <p className="note" style={{ marginTop: -4 }}>
        Central&apos;s question is not &ldquo;what happened here&rdquo; but &ldquo;where do I put pressure, and which
        lever do I pull&rdquo;, so every number below names its outlet AND its area manager, and every lever lists the
        stores behind it.
      </p>

      <div className="dctx">
        <VTile label="Orders, both apps" value={n0(totOrdersDay)}
          delta={<><AppTag app="Z" />{n0(ordersDay)} &nbsp;<AppTag app="S" />{n0(sOrdersDay)}</>}
          ok={ordersDay >= avgDayOrders}
          verdict={`Zomato ${ordersDay >= avgDayOrders ? '+' : ''}${Math.round(100 * (ordersDay - avgDayOrders) / (avgDayOrders || 1))}% on its weekly daily average`} />
        <VTile label="Unhappy orders, both apps"
          value={<>{n0(unhappyDay)} <small>({unhappyPct === null ? '-' : n1(unhappyPct)}% of orders)</small></>}
          delta={<><AppTag app="Z" />{n0(compsDay)} complaints &nbsp;<AppTag app="S" />{sLowDayN} low-starred</>}
          ok={(unhappyPct ?? 0) <= 2} verdict="share of the day's orders that went wrong for a customer" />
        <VTile label="Turned away, both apps"
          value={<>{n0(turnDayN)} <small>({turnPct === null ? '-' : n1(turnPct)}% of what came)</small></>}
          delta={`${inr(rejValDay + sCancDayVal)} of orders lost yesterday`}
          ok={turnDayN === 0} verdict="goal is zero: each one is a customer told no" />
        <VTile label="Swiggy GMV" value={lakh(SL.gmv_day)}
          delta="gross: before discounts, GST included; bridge in section 12"
          ok={(SL.gmv_day ?? 0) >= (SL.gmv_wk ?? 0) / 7}
          verdict={`${(SL.gmv_day ?? 0) >= (SL.gmv_wk ?? 0) / 7 ? '+' : ''}${Math.round(100 * ((SL.gmv_day ?? 0) - (SL.gmv_wk ?? 0) / 7) / (((SL.gmv_wk ?? 0) / 7) || 1))}% on the week's daily average`} />
        <VTile label="Net sales" value={lakh(segd?.net_sales)} delta={`subtotal ${lakh(segd?.subtotal)}`}
          ok={(segd?.net_sales ?? 0) >= (segw?.net_sales ?? 0) / 7}
          verdict={`${(segd?.net_sales ?? 0) >= (segw?.net_sales ?? 0) / 7 ? '+' : ''}${Math.round(100 * ((segd?.net_sales ?? 0) - (segw?.net_sales ?? 0) / 7) / (((segw?.net_sales ?? 0) / 7) || 1))}% on the week's daily average`} />
        <VTile label="Complaints (Zomato's count)"
          value={<>{n0(compsDay)} <small>({cpctDay?.toFixed(2) ?? '-'}%)</small></>}
          delta={`${n0(compT.length)} order rows carry a complaint flag: section 7`}
          ok={(cpctDay ?? 0) <= (cpctWk ?? 0)} verdict={`against ${cpctWk?.toFixed(2) ?? '-'}% for the week`} />
        <VTile label="Store rejections (Zomato's count)" value={n0(srejDay)}
          delta={`${n0(rejT.length)} order rows name a store reason: section 6`}
          ok={srejDay === 0} verdict={`${n0(srejWk)} in the week, goal is zero`} />
        <VTile label="Rider wait" value={`${n1(waitDay)} min`} delta={`${n1(waitWk)} min across the week`}
          ok={(waitDay ?? 9) < 1.5} verdict="goal is under 1.5 min" />
        <VTile label="Online" value={`${onlineDay?.toFixed(2) ?? '-'}%`}
          delta={`${n0(offminDay)} min offline network-wide`}
          ok={offminDay === 0} verdict="goal is 100%: offline is a closed shop" />
        <VTile label="Money lost, week, both apps" value={inr(moneyWk + sCancWkVal)}
          delta={<><AppTag app="Z" />{inr(moneyWk)} &nbsp;<AppTag app="S" />{inr(sCancWkVal)}</>}
          ok={moneyWk + sCancWkVal === 0} verdict="goal is zero: every rupee ties to an order" />
        <VTile label="False ready, week" value={n0(frWk)}
          delta={`${n1(deliveredWk ? (100 * frWk) / deliveredWk : 0)}% of delivered orders`}
          ok={frWk === 0} verdict="goal is zero, the button means food is out" />
      </div>

      <div className="attention"><h2>What deserves central attention</h2><ol>{att.slice(0, 7)}</ol></div>

      <SecHead num="1">The network&apos;s own 7 days</SecHead>
      <Lead>Six lines, one idea each. This is the only place on the page where the network is a single number:
        everything below it names stores.</Lead>
      <div className="dcard"><Period label={wkLabel}>
        <div className="chartgrid">
          <Chart series={trend.map(t => t.orders)} labels={labels} tips={tips} title="Orders per day" />
          <Chart series={trend.map(t => t.cpct)} labels={labels} tips={tips}
            title="Complaints as a % of orders" unit="%" />
          <Chart series={trend.map(t => t.online)} labels={labels} tips={tips}
            title={`Online % (average of the ${stores.length} stores)`} unit="%"
            lo={Math.min(97, ...trend.map(t => t.online ?? 100)) - 0.2} hi={100} />
          <Chart series={trend.map(t => t.wait)} labels={labels} tips={tips}
            title="Rider wait, minutes" lo={0} />
          <Chart series={trend.map(t => t.rating)} labels={labels} tips={tips} title="Average food rating" />
          <Chart series={trend.map(t => t.discount_pct)} labels={labels} tips={tips}
            title="Discount as a % of subtotal" unit="%" />
          <Chart series={SW.trend.map(t => t.orders)} labels={sTrendLabels} tips={sTrendTips}
            title="Swiggy orders per day" lo={0} />
          <Chart series={SW.trend.map(t => (t.gmv === null ? null : Math.round(t.gmv / 1000)))}
            labels={sTrendLabels} tips={sTrendTips} title="Swiggy GMV per day (₹ thousands, gross)" lo={0} />
        </div>
        <p className="note">Day of the month along the bottom, the full date on hover. Rider wait is blank on any
          day the order-level feed does not reach; nothing is estimated. Ratings and complaints for the newest days
          still rise for a few days after the fact.</p>
      </Period></div>

      <SecHead num="2">Area versus area</SecHead>
      <Lead>Five areas, one row each. This is the level central actually acts at: a store is reached through its
        area manager.</Lead>
      <div className="dcard">
        <Period label={dshort}>
          <CentralAreas areas={areas} date={date} view="day" netCpct={cpctDay} />
          <p className="note">Ranked by complaint rate, best first. Red marks a number above the network&apos;s own
            figure for the same day, not a target miss.</p>
        </Period>
        <Period label={wkLabel}>
          <CentralAreas areas={areas} date={date} view="wk" netCpct={cpctWk} />
          <p className="note">Area manager names open that area&apos;s page, where every one of these numbers breaks
            into stores and then into orders.</p>
        </Period>
        <Period label={`${dshort}, both apps together`}>
          <Rows cols={['Area manager', 'Stores', 'Orders', 'By app', 'Unhappy', 'Turned away', 'Money lost, week']}
            rows={[...areas].map(a => {
              const s = sByAm.get(a.am) ?? { orders: 0, low: 0, canc: 0, money: 0 };
              return { a, s, tot: a.d_orders + s.orders };
            }).sort((x, y) => y.tot - x.tot).map(({ a, s, tot }) => [
              a.am, a.stores, n0(tot),
              <span key="b"><AppTag app="Z" />{n0(a.d_orders)} <AppTag app="S" />{n0(s.orders)}</span>,
              n0(a.d_comps + s.low), n0(a.d_srej + s.canc), inr(a.w_money + s.money)])} />
          <p className="note">Unhappy = Zomato complaints + Swiggy 1-2 star orders yesterday. Money lost is the
            7-day avoidable-loss total for that AM&apos;s stores, both apps.</p>
        </Period>
      </div>

      <SecHead num="3">All {stores.length} stores</SecHead>
      <Lead>One line per store. Worst first, because the top of this table is the work.</Lead>
      <div className="dcard">
        <Period label={`${dshort}, ranked worst-first`}>
          <AppTabs group="s3" />
          <div className="s1view" data-group="s3" data-view="z">
            <CentralStores stores={stores} date={date} money={money} view="day" />
          </div>
          <div className="s1view off" data-group="s3" data-view="s">
            <SwiggyStoresTable rows={SW.stores} date={date} showAm />
            <p className="note">Swiggy publishes no rider timing, so Wait is empty on this tab. # is the store&apos;s
              rank in the Swiggy league (cancellations + 1-2 star orders + hours offline), lower is better.</p>
          </div>
          <p className="note">Ranked by clean-day score: complaints % + rejections % + offline penalty, lower is
            better (ties by rating, then orders). Red marks a number worth a question, not a verdict. Store names
            open the store page for the same day.
            {SW.unmapped.length ? <> <b>{SW.unmapped.join(', ')} has no Swiggy outlet in the map</b> and appears
              only on the Zomato tab.</> : null}</p>
        </Period>
        <Period label={wkLabel}>
          <Fold label={`The same ${stores.length} stores ranked over the 7 days`} count={stores.length}>
            <CentralStores stores={stores} date={date} money={money} view="wk" />
          </Fold>
          <p className="note">The week ranking is the one to use for a conversation about habits; the day ranking
            is for a conversation about yesterday.</p>
        </Period>
      </div>

      <SecHead num="4">Outlets not fully online</SecHead>
      <Lead>A store that is offline sells nothing and is invisible in every other number on this page. This is the
        first section to read.</Lead>
      <div className="dcard"><Period label={`${dshort} dips, each with its own 7-day line`}>
        {(D.online_dips.length || SW.short_series.length)
          ? <div className="minigrid">
              {D.online_dips.map(d => <DipCard key={d.code} dip={d} />)}
              {SW.short_series.slice(0, 8).map(s => <ShortCard key={s.code} s={s} />)}
            </div>
          : <p className="note">Every store was fully online on both apps on this day.</p>}
        <p className="note">
          {D.online_dips.length} of {stores.length} stores dipped on Zomato, {n0(offminDay)} minutes of trading
          lost between them on this day alone.
          {SW.short_series.length > 8 ? ` Showing the worst 8 Swiggy offenders of ${SW.short_series.length} with
          missing hours this week.` : ''} Zomato reports total minutes offline per day and Swiggy hours open
          against its expected window; neither says the clock times, the store can.
        </p>
      </Period></div>

      <SecHead num="5">Orders turned away because the shop was shut</SecHead>
      <Lead>The one number on this page that should be zero. A store cannot be sent an order unless Zomato thinks
        it is open, so each of these is a listing that was live while the shop could not serve. Section 4 is the
        opposite case, the listing itself going down.</Lead>
      <ShutShop block={D} dshort={dshort} wkLabel={wkLabel} showAm />

      <SecHead num="6">Turned away or cancelled on the store</SecHead>
      <Lead>A rejection or a store-charged cancellation is a customer who wanted to buy and was told no. Each row
        is one of them, from either app.</Lead>
      <div className="dcard">
        <Period label={dshort}>
          <AppRows id="turn-day" cols={['Store', 'AM', 'Time', 'App', 'Reason', 'What the customer had ordered', 'Value lost']}
            rows={[
              ...rejT.map(r => ({ app: 'Z' as const, cells: [r.code, r.am, r.time, <AppTag key="a" app="Z" />,
                <FaultTag key="t" why={r.reason ?? 'no reason'} />,
                <Basket key="b" text={r.basket} />, inr(r.value)] })),
              ...SW.canc_day.map(c => ({ app: 'S' as const, cells: [c.code ?? '', c.am ?? '', clockTime(c.t), <AppTag key="a" app="S" />,
                <FaultTag key="t" why={c.why} />, <Basket key="b" text={c.basket} />,
                c.val === null ? 'n/a' : inr(c.val)] })),
            ]}
            empty="Nothing was turned away on either app on this day." />
          <p className="note">{inr(rejValDay + sCancDayVal)} of trade turned away on this day, both apps.</p>
        </Period>
        <Period label={wkLabel}>
          <Fold label="Earlier this week, both apps" count={rejW.length + SW.canc_wk.length}>
            <AppRows id="turn-wk" cols={['Store', 'AM', 'Day', 'Time', 'App', 'Reason', 'What the customer had ordered', 'Value lost']}
              rows={[
                ...rejW.map(r => ({ app: 'Z' as const, cells: [r.code, r.am, r.dlabel, r.time, <AppTag key="a" app="Z" />,
                  <FaultTag key="t" why={r.reason ?? 'no reason'} />,
                  <Basket key="b" text={r.basket} />, inr(r.value)] })),
                ...SW.canc_wk.map(c => ({ app: 'S' as const, cells: [c.code ?? '', c.am ?? '', dShort(c.d), clockTime(c.t),
                  <AppTag key="a" app="S" />, <FaultTag key="t" why={c.why} />,
                  <Basket key="b" text={c.basket} />, c.val === null ? 'n/a' : inr(c.val)] })),
              ]} />
          </Fold>
          <p className="note">Swiggy values and baskets come from the billed Petpooja order, matched on
            Swiggy&apos;s own order number, never on a name. {inr(sCancWkVal)} of Swiggy orders were cancelled on
            stores across the 7 days.</p>
          <p className="note">{inr(rejValWk)} across the 7 days, every rupee of it an order a customer tried to
            place. Only store-caused rejections are listed, in the order feed&apos;s own words: <b>items out of
            stock, kitchen is full, restaurant is closed, timeout, unavailable to accept</b>. Customer and rider
            cancellations are excluded.</p>
          <p className="note">Two counts, as with complaints. Zomato&apos;s daily report counts {n0(srejWk)} store
            rejections for the week; {n0(D.rejections.length)} order rows carry one of those reasons. The list is
            the shorter of the two because only orders that reached the store appear in the order feed. Both are
            true; never add them together.</p>
        </Period>
      </div>

      <SecHead num="7">Complaints</SecHead>
      <Lead>Two vocabularies exist and they are never mixed: the tags on the order rows drive the tables and the
        filters; Zomato&apos;s daily report is shown separately at the bottom as a read-only summary.</Lead>
      <div className="dcard">
        <Period label={dshort}>
          <Fold label={`Every order with an issue on ${dshort}`} count={compT.length} open={compT.length <= 40}>
            <Rows cols={compCols}
              rows={compT.map(r => [r.code, r.am, r.time, <Tag key="t" reason={r.tag ?? ''} />,
                <Basket key="b" text={r.basket} />, <Words key="w" text={r.review} />,
                r.refund ? inr(r.refund) : '-'])} />
          </Fold>
        </Period>
        <Period label={wkLabel}>
          <div className="rfilters">
            {chips.map(([t, c]) => (
              <button key={t} className="rfilter" data-reason={t} data-target="cent-cw" type="button">{t}: <b>{c}</b></button>
            ))}
            <button className="rfilter on" data-reason="" data-target="cent-cw" type="button">Show all</button>
          </div>
          <Fold label={`Complaints earlier this week (newest ${compW.length} of ${compWAll})`} count={compW.length}>
            <div className="scroll-x">
              <table id="cent-cw" className="tight">
                <thead><tr>{compColsWk.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {compW.map((r, i) => (
                    <tr key={i} data-reason={r.tag ?? ''}>
                      <td className="name">{r.code}</td><td>{r.am}</td><td>{r.dlabel}</td><td>{r.time}</td>
                      <td><Tag reason={r.tag ?? ''} /></td>
                      <td><Basket text={r.basket} /></td>
                      <td><Words text={r.review} /></td>
                      <td>{r.refund ? inr(r.refund) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Fold>
          <p className="note">Filters are built from the tags these ORDER rows actually carry, so a chip always
            returns rows. The newest {compW.length} are listed here; each store page carries its own full list.</p>
          {reasons ? (
            <div className="pblock">
              <div className="ptitle">Zomato&apos;s own count, for comparison only</div>
              <Rows cols={["Zomato's own reason counts, 7 days", 'Complaints']}
                rows={[
                  { name: 'Delivered late', v: reasons.late },
                  { name: 'Poor taste or quality', v: reasons.quality },
                  { name: 'Poor packaging or spillage', v: reasons.packaging },
                  { name: 'Wrong items', v: reasons.wrong },
                  { name: 'Items missing', v: reasons.missing },
                ].sort((a, b) => (b.v ?? 0) - (a.v ?? 0)).map(r => [r.name, n0(r.v)])} />
              <p className="note">Two counts, two sources, both true. Zomato&apos;s official complaint figure comes
                from their daily report ({n0(reasons.comps)} for the week); the tables above list every order where
                a customer raised something ({n0(D.complaints_total)} for the week). Zomato tags a reason on only
                some of them, so the tag counts are smaller than their daily totals, and {n0(untagged)} of
                the {n0(compT.length)} orders on {dshort} carry no tag at all. Nothing is hidden: the untagged
                orders are in the list too. Never add the two sources together.</p>
            </div>
          ) : null}
        </Period>
      </div>

      <SecHead num="8">1, 2 and 3-star orders</SecHead>
      <Lead>A rating is the only place the customer speaks in their own time. These are the ones who were unhappy
        enough to say so.</Lead>
      <div className="dcard">
        <Period label={dshort}>
          <Fold label={`Low-rated orders on ${dshort}, both apps`} count={lowT.length + SW.low_day.length}
            open={lowT.length + SW.low_day.length <= 40}>
            <AppRows id="low-day" cols={['Store', 'AM', 'Time', 'App', 'Stars', 'What was in the order', 'What the customer wrote',
              'Complaint tag if any']}
              rows={[
                ...lowT.map(r => ({ app: 'Z' as const, cells: [r.code, r.am, r.time, <AppTag key="a" app="Z" />, r.rating,
                  <Basket key="b" text={r.basket} />, <Words key="w" text={r.review} />,
                  r.tag ? <Tag key="t" reason={r.tag} /> : '-'] })),
                ...SW.low_day.map(r => ({ app: 'S' as const, cells: [r.code ?? '', r.am ?? '', clockTime(r.t), <AppTag key="a" app="S" />,
                  r.rating == null ? '-' : n0(r.rating), <Basket key="b" text={r.basket} />,
                  <Words key="w" text={r.words} />, '-'] })),
              ]} />
          </Fold>
        </Period>
        <Period label={wkLabel}>
          <Fold label={`Low-rated orders earlier this week (newest ${lowW.length} of ${lowWAll} Zomato, all ${SW.low_wk.length} Swiggy)`}
            count={lowW.length + SW.low_wk.length}>
            <AppRows id="low-wk" cols={['Store', 'AM', 'Day', 'Time', 'App', 'Stars', 'What was in the order',
              'What the customer wrote', 'Complaint tag if any']}
              rows={[
                ...lowW.map(r => ({ app: 'Z' as const, cells: [r.code, r.am, r.dlabel, r.time, <AppTag key="a" app="Z" />, r.rating,
                  <Basket key="b" text={r.basket} />, <Words key="w" text={r.review} />,
                  r.tag ? <Tag key="t" reason={r.tag} /> : '-'] })),
                ...SW.low_wk.map(r => ({ app: 'S' as const, cells: [r.code ?? '', r.am ?? '', dShort(r.d), clockTime(r.t),
                  <AppTag key="a" app="S" />, r.rating == null ? '-' : n0(r.rating),
                  <Basket key="b" text={r.basket} />, <Words key="w" text={r.words} />, '-'] })),
              ]} />
          </Fold>
          <p className="note">{n0(D.low_ratings_total)} low-rated orders in the 7 days. Only a small share of orders
            are rated at all, so treat each row as one specific customer, never as a percentage. Ratings for the
            newest days keep arriving for several days afterwards.</p>
        </Period>
      </div>

      <SecHead num="9">Where riders wait</SecHead>
      <Lead>Every minute a rider stands in a store is a minute the order is late and the rider is not paid. This is
        the one speed number the data can prove.</Lead>
      <div className="dcard"><Period label={`Worst first, ${wkLabel.toLowerCase()}`}>
        <Rows cols={['Store', 'AM', `Wait on ${dshort}`, 'Wait, week', 'Orders kept 3+ min', 'Delivered', 'Share 3+ min']}
          rows={D.wait_stores.filter(w => w.delivered_wk > 0).map(w => [w.code, w.am,
            (w.wait_day ?? 0) >= 2 ? <span key="a" className="flag">{n1(w.wait_day)}</span> : n1(w.wait_day),
            (w.wait_wk ?? 0) >= 2 ? <span key="b" className="flag">{n1(w.wait_wk)}</span> : n1(w.wait_wk),
            n0(w.waits3_wk), n0(w.delivered_wk),
            w.pct3 === null ? '-'
              : w.pct3 >= 15 ? <span key="c" className="flag">{w.pct3}%</span> : `${w.pct3}%`])} />
        <p className="note">Network average {n1(waitWk)} min, {n0(waits3Wk)} of {n0(deliveredWk)} delivered orders
          kept a rider waiting 3 minutes or more ({n1(pct3)}%). Goal is under 1.5 minutes average and under 3% of
          orders. Rider wait is the verified speed measure: Zomato&apos;s kitchen preparation time is excluded
          permanently because it only tracks how fast the tablet button is pressed.</p>
      </Period></div>

      <SecHead num="10">&quot;Ready&quot; pressed before the food was ready</SecHead>
      <Lead>Pressing ready early makes the store&apos;s Zomato numbers look good and makes the rider wait. It is a
        habit, and habits are a central conversation, not a store one.</Lead>
      <div className="dcard">
        <Period label="By store, worst first">
          <Rows cols={['Store', 'AM', `On ${dshort}`, 'This week', 'Delivered', 'Share of orders']}
            rows={D.fr_stores.map(f => [f.code, f.am, n0(f.fr_day), n0(f.fr_wk), n0(f.delivered_wk),
              f.pct === null ? '-'
                : f.pct >= 5 ? <span key="p" className="flag">{f.pct}%</span> : `${f.pct}%`])}
            empty="No false ready-presses this week." />
          <p className="note">{n0(frWk)} orders network-wide this week,
            {' '}{n1(deliveredWk ? (100 * frWk) / deliveredWk : 0)}% of everything delivered.</p>
        </Period>
        <Period label={`The worst ${D.fr_orders.length} orders of the week`}>
          <Fold label="Order by order" count={D.fr_orders.length}>
            <Rows cols={['Store', 'AM', 'Day', 'Time', 'Marked ready after', 'Rider then waited', 'What was in the order']}
              rows={D.fr_orders.map(r => [r.code, r.am, r.dlabel, r.time, `${r.ready_secs} sec`,
                `${r.waited_min} min`, <Basket key="b" text={r.basket} />])} />
          </Fold>
          <p className="note">These are orders marked ready within a minute of being accepted where the rider then
            waited 3 minutes or more. Both facts come from the order&apos;s own timestamps.</p>
        </Period>
      </div>

      <SecHead num="11">Money lost, by store</SecHead>
      <Lead>The only place on the page where operational failure is priced.</Lead>
      <div className="dcard"><Period label={wkLabel}>
        {(() => {
          const codes = new Set([...D.money_stores.map(m2 => m2.code), ...SW.money_stores.map(m2 => m2.code)]);
          const rows = [...codes].map(c => {
            const z = D.money_stores.find(m2 => m2.code === c);
            const sVal = sMoneyByCode.get(c) ?? 0;
            const am = z?.am ?? SW.money_stores.find(m2 => m2.code === c)?.am ?? '';
            return { c, am, z, sVal, total: (z?.total_wk ?? 0) + sVal };
          }).sort((a, b) => b.total - a.total);
          return (
            <Rows cols={['Store', 'AM', 'Z turned-away', 'Z refunds', 'S cancelled on store', 'Total lost']}
              rows={rows.map(r => [r.c, r.am, inr(r.z?.stockout_wk ?? 0), inr(r.z?.refunds_wk ?? 0),
                inr(r.sVal), <b key="t">{inr(r.total)}</b>])}
              empty="Nothing lost this week, on either app." />
          );
        })()}
        <p className="note">{inr(moneyWk + sCancWkVal)} network-wide, both apps. Every rupee here ties to an order
          listed in sections 6, 7 and 8. Nothing on this line is an estimate, and offline minutes are NOT included:
          what a closed store would have sold cannot be measured, only guessed.</p>
      </Period></div>

      <SecHead num="12">Central levers (never shown to a store or an area manager)</SecHead>
      <Lead>Discounts, ads and the funnel, on both apps. This is the block that separates the central page from the
        area page: these are the numbers only central can move, and each one lists the stores it came from.</Lead>
      <div className="dcard">
        <Period label={`Swiggy money, ${dshort} (the block the store sheets deliberately do not have)`}>
          <div className="dctx" style={{ margin: '4px 0 2px' }}>
            <VTile label="Swiggy GMV" value={lakh(SL.gmv_day)} delta={`week ${lakh(SL.gmv_wk)}`}
              ok={(SL.gmv_day ?? 0) >= (SL.gmv_wk ?? 0) / 7}
              verdict="gross: before discounts, GST included" />
            <VTile label="Coupon discounts" value={lakh(SL.cd_day)}
              delta={<>you funded {inr(SL.rtd_day)} &middot; Swiggy funded {inr(SL.std_day)}</>}
              ok={false} verdict={`week ${lakh(SL.cd_wk)}: you ${inr(SL.rtd_wk)}, Swiggy ${inr(SL.std_wk)}`} />
            <VTile label="Ads return" value={roasDay === null ? '-' : `${n1(roasDay)}x`}
              delta={`${inr(SL.burn_day)} burnt for ${inr(SL.adsg_day)} of ad-driven sales`}
              ok={(roasDay ?? 0) >= 5}
              verdict={`goal 5x, red below 3x; week ${roasWk === null ? '-' : n1(roasWk) + 'x'}`} />
            <VTile label="Menu-to-order" value={SL.conv_day === null ? '-' : `${n1(SL.conv_day)}%`}
              delta="of Swiggy menu visits network-wide" ok={true} verdict="the Swiggy funnel's one number" />
            <VTile label="New customers" value={n0(SL.ntr_day)}
              delta={`of ${n0((SL.ntr_day ?? 0) + (SL.rtr_day ?? 0))} Swiggy orders yesterday`}
              ok={true} verdict="Swiggy's own new-to-restaurant count" />
          </div>
          <p className="note"><b>The Petpooja bridge, printed daily:</b> Swiggy reports {lakh(SL.gmv_day)} GMV for
            this day; Petpooja billed {n0(SL.bridge.pp_n)} delivered Swiggy + Toing orders worth
            {' '}{lakh(SL.bridge.pp_g)} in the same gross terms
            {SL.gmv_day ? <>, a gap of {inr(Math.abs((SL.bridge.pp_g ?? 0) - SL.gmv_day))}
              ({n1(100 * Math.abs((SL.bridge.pp_g ?? 0) - SL.gmv_day) / SL.gmv_day)}%)</> : null}, explained by
            split multi-cake deliveries and the midnight boundary.</p>
          <div className="tlabel">Swiggy coupons this week, biggest first</div>
          <Rows cols={['Coupon', 'Orders', 'Customer discount']}
            rows={SL.top_coupons.map(c => [c.code, n0(c.n), inr(c.cd)])} />
          <div className="tlabel">Swiggy by store, last 7 days (stores running ads)</div>
          <Rows cols={['Store', 'AM', 'GMV, week', 'Ads burnt', 'Return']}
            rows={SL.store_levers.map(l => [l.code, l.am ?? '', inr(l.gmv_wk), inr(l.burn_wk),
              l.burn_wk ? (l.adsg_wk / l.burn_wk < 3
                ? <span key="r" className="flag">{n1(l.adsg_wk / l.burn_wk)}x</span>
                : `${n1(l.adsg_wk / l.burn_wk)}x`) : '-'])} />
        </Period>
        <div className="tlabel" style={{ marginTop: 14 }}><AppTag app="Z" />Zomato levers, as before</div>
        <div className="dctx" style={{ margin: '4px 0 2px' }}>
          <VTile label={`Discounts given, ${dshort}`} value={lakh(segd?.discount)}
            delta={`${n1(segd?.subtotal ? (100 * (segd.discount ?? 0)) / segd.subtotal : null)}% of subtotal`}
            ok={(segd?.subtotal ? (segd.discount ?? 0) / segd.subtotal : 0)
              <= (segw?.subtotal ? (segw.discount ?? 0) / segw.subtotal : 0)}
            verdict={`against ${n1(segw?.subtotal ? (100 * (segw.discount ?? 0)) / segw.subtotal : null)}% for the week`} />
          <VTile label="Discounts given, week" value={lakh(segw?.discount)}
            delta={`${n1(segw?.subtotal ? (100 * (segw.discount ?? 0)) / segw.subtotal : null)}% of subtotal`}
            ok={false} verdict={`${lakh(segw?.discount)} of margin, the largest single lever on this page`} />
          <VTile label="Ad spend, week" value={lakh(adsw?.spend)}
            delta={`${n0(adsw?.ad_orders)} ad-attributed orders`}
            ok={(adsw?.spend ? (adsw.ad_sales ?? 0) / adsw.spend : 0) >= 4}
            verdict={`${n1(adsw?.spend ? (adsw.ad_sales ?? 0) / adsw.spend : null)}x return on the week`} />
          <VTile label="Orders with an offer"
            value={`${n1(segw?.orders ? (100 * (segw.offer_orders ?? 0)) / segw.orders : null)}%`}
            delta={`${n0(segw?.offer_orders)} of ${n0(segw?.orders)} orders in the week`}
            ok={false} verdict="nine orders in ten carry a discount" />
        </div>
        <Period label={`The funnel, ${wkLabel.toLowerCase()}`}>
          <Funnel impressions={segw?.impressions ?? null} opens={segw?.menu_opens ?? null}
            orders={segw?.orders ?? null} />
          <p className="note">Impressions and menu opens are Zomato&apos;s own counts of its listing pages. Per
            store, the last three columns of the table below.</p>
        </Period>
        <Period label={`Where the discount and the ad money went, ${wkLabel.toLowerCase()}`}>
          <Rows cols={['Store', 'AM', 'Subtotal', 'Discount', 'Disc %', 'Orders w/ offer', 'Ad spend', 'ROI',
            'Impressions', 'Menu opens', 'Opens to orders']}
            rows={[...D.lever_stores].sort((a, b) => b.disc_wk - a.disc_wk).map(l => {
              const netDisc = segw?.subtotal ? (100 * (segw.discount ?? 0)) / segw.subtotal : 0;
              // A store with no segment rows that week returns nulls; print a
              // dash rather than the word "null" with a percent sign after it.
              const pc = (v: number | null, dp = 1) => v === null ? '-' : `${v.toFixed(dp)}%`;
              return [l.code, l.am, inr(l.sub_wk), inr(l.disc_wk),
                (l.disc_pct_wk ?? 0) > netDisc
                  ? <span key="d" className="flag">{pc(l.disc_pct_wk)}</span> : pc(l.disc_pct_wk),
                pc(l.offer_pct_wk), inr(l.spend_wk),
                l.roi_wk === null ? '-'
                  : l.roi_wk < 4 ? <span key="r" className="flag">{n1(l.roi_wk)}</span> : n1(l.roi_wk),
                n0(l.impr_wk), pc(l.open_pct_wk, 2), pc(l.conv_pct_wk)];
            })} />
          <p className="note">Red discount % marks a store discounting harder than the network. Red ROI marks under
            4x. Ad ROI is Zomato&apos;s own attribution and is directional, not audited.</p>
        </Period>
        <Period label="Why the daily ad number cannot be read">
          <Rows cols={['Day', 'Ad spend', 'ROI', '']}
            rows={(() => {
              const base = [...trend].map(t => t.spend ?? 0).sort((a, b) => a - b)[Math.floor(trend.length / 2)] || 1;
              return trend.map(t => [
                new Date(t.d + 'T00:00:00').toLocaleDateString('en-IN',
                  { weekday: 'short', day: 'numeric', month: 'short' }),
                inr(t.spend), n1(t.roi),
                (t.spend ?? 0) > 3 * base ? 'the weekly charge lands'
                  : (t.spend ?? 0) > 1.5 * base ? 'the tail of it' : '']);
            })()} />
          <p className="note">Ad spend is not posted daily. It arrives in a lump, on a Sunday in most weeks, with a
            smaller tail on the Monday, while ad-attributed sales stay flat through the spike. Verified over seven
            weeks on 26 Aug 2026. So a single day&apos;s ad spend and a single day&apos;s ROI are meaningless: only
            the 7-day figure is. That is why the tiles above quote the week and there is no day tile.</p>
        </Period>
      </div>

      <div className="dfoot">
        <p>Every figure on this page comes from the spine functions <b>dash_all</b>, <b>dash_central_detail</b> and
          {' '}<b>dash_central_swiggy</b> and is reproducible by query. Kitchen preparation time is excluded permanently (verified 23 Aug 2026:
          it measures tablet button-pressing, not kitchen work). Rider wait is the verified speed measure, identical
          across two independent Zomato feeds.</p>
        <p>The page shows settled data only, two days behind, because Zomato keeps revising fresher days: ratings and
          complaint counts on a day still move for several days after it. Online time and rejections do not move.
          Nothing on this page is an estimate and no number is produced by AI.</p>
        <p>Hover any shortened item list to read it in full. Store and area manager names open their own pages.</p>
        <p dangerouslySetInnerHTML={{ __html: RECONCILE }} />
        <p>Item lists come from Zomato&apos;s item export, and fall back to the evening order feed when that export is missing, so a rejection or a complaint always names what the customer wanted.</p>
      </div>
      <DashScript />
    </main>
  );
}
