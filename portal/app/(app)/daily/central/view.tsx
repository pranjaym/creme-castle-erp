import {
  getDashAll, getCentralDetail,
  inr, lakh, n0, n1, type StoreStats, type CentralReceipt,
} from '@/lib/daily';
import {
  DashHead, DashScript, SecHead, Period, Fold, Rows, Tag, Basket, Chart, DipCard,
  Lead, VTile, CentralStores, CentralAreas, Funnel, ShutShop, type CentralArea,
} from '../ui';

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
  const [all, D] = await Promise.all([getDashAll(date), getCentralDetail(date)]);
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

  const compCols = ['Store', 'AM', 'Time', 'Tag on the order', 'What was in the order', 'Refunded'];
  const compColsWk = ['Store', 'AM', 'Day', 'Time', 'Tag on the order', 'What was in the order', 'Refunded'];

  return (
    <main className="dashroot central">
      <DashHead title="The whole network" subtitle={`${stores.length} stores, ${areas.length} areas. Zomato operations.`}
        date={date} latest={latest} basePath="/daily/central" />

      <p className="note" style={{ marginTop: -4 }}>
        Central&apos;s question is not &ldquo;what happened here&rdquo; but &ldquo;where do I put pressure, and which
        lever do I pull&rdquo;, so every number below names its outlet AND its area manager, and every lever lists the
        stores behind it.
      </p>

      <div className="dctx">
        <VTile label="Orders" value={n0(ordersDay)} delta={`${n0(avgDayOrders)} a day across the week`}
          ok={ordersDay >= avgDayOrders}
          verdict={`${ordersDay >= avgDayOrders ? '+' : ''}${Math.round(100 * (ordersDay - avgDayOrders) / (avgDayOrders || 1))}% on the week's daily average`} />
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
        <VTile label="Money lost, week" value={inr(moneyWk)} delta="stockouts + refunds"
          ok={moneyWk === 0} verdict="goal is zero: every rupee ties to an order" />
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
      </div>

      <SecHead num="3">All {stores.length} stores</SecHead>
      <Lead>One line per store. Worst first, because the top of this table is the work.</Lead>
      <div className="dcard">
        <Period label={`${dshort}, ranked worst-first`}>
          <CentralStores stores={stores} date={date} money={money} view="day" />
          <p className="note">Ranked by clean-day score: complaints % + rejections % + offline penalty, lower is
            better (ties by rating, then orders). Red marks a number worth a question, not a verdict. Store names
            open the store page for the same day.</p>
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
        {D.online_dips.length
          ? <div className="minigrid">{D.online_dips.map(d => <DipCard key={d.code} dip={d} />)}</div>
          : <p className="note">Every store was fully online on this day.</p>}
        <p className="note">
          {D.online_dips.length} of {stores.length} stores dipped, {n0(offminDay)} minutes of trading lost between
          them on this day alone. Zomato reports total minutes offline per day, never the clock times, so the page
          cannot say when it happened; the store can.
        </p>
      </Period></div>

      <SecHead num="5">Orders turned away because the shop was shut</SecHead>
      <Lead>The one number on this page that should be zero. A store cannot be sent an order unless Zomato thinks
        it is open, so each of these is a listing that was live while the shop could not serve. Section 4 is the
        opposite case, the listing itself going down.</Lead>
      <ShutShop block={D} dshort={dshort} wkLabel={wkLabel} showAm />

      <SecHead num="6">Rejected orders</SecHead>
      <Lead>A rejection is a customer who wanted to buy and was told no. Each row is one of them.</Lead>
      <div className="dcard">
        <Period label={dshort}>
          <Rows cols={['Store', 'AM', 'Time', 'Reason', 'What the customer had ordered', 'Value lost']}
            rows={rejT.map(r => [r.code, r.am, r.time, <Tag key="t" reason={r.reason ?? ''} />,
              <Basket key="b" text={r.basket} />, inr(r.value)])}
            empty="No store-caused rejections on this day." />
          <p className="note">{inr(rejValDay)} of trade turned away on this day.</p>
        </Period>
        <Period label={wkLabel}>
          <Fold label="Rejections earlier this week" count={rejW.length}>
            <Rows cols={['Store', 'AM', 'Day', 'Time', 'Reason', 'What the customer had ordered', 'Value lost']}
              rows={rejW.map(r => [r.code, r.am, r.dlabel, r.time, <Tag key="t" reason={r.reason ?? ''} />,
                <Basket key="b" text={r.basket} />, inr(r.value)])} />
          </Fold>
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
                <Basket key="b" text={r.basket} />, r.refund ? inr(r.refund) : '-'])} />
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
          <Fold label={`Low-rated orders on ${dshort}`} count={lowT.length} open={lowT.length <= 40}>
            <Rows cols={['Store', 'AM', 'Time', 'Stars', 'What was in the order', 'Complaint tag if any']}
              rows={lowT.map(r => [r.code, r.am, r.time, r.rating, <Basket key="b" text={r.basket} />,
                r.tag ? <Tag key="t" reason={r.tag} /> : '-'])} />
          </Fold>
        </Period>
        <Period label={wkLabel}>
          <Fold label={`Low-rated orders earlier this week (newest ${lowW.length} of ${lowWAll})`} count={lowW.length}>
            <Rows cols={['Store', 'AM', 'Day', 'Time', 'Stars', 'What was in the order', 'Complaint tag if any']}
              rows={lowW.map(r => [r.code, r.am, r.dlabel, r.time, r.rating, <Basket key="b" text={r.basket} />,
                r.tag ? <Tag key="t" reason={r.tag} /> : '-'])} />
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
        <Rows cols={['Store', 'AM', 'Turned-away orders', 'Rejections', 'Refunds', 'Complaints', 'Total lost']}
          rows={D.money_stores.map(m2 => [m2.code, m2.am, inr(m2.stockout_wk), n0(m2.rej_wk), inr(m2.refunds_wk),
            n0(m2.comp_wk), <b key="t">{inr(m2.total_wk)}</b>])}
          empty="Nothing lost to rejections or refunds this week." />
        <p className="note">{inr(moneyWk)} across {D.money_stores.length} stores. Every rupee here ties to an order
          listed in sections 6 and 7. Nothing on this line is an estimate, and offline minutes are NOT included:
          what a closed store would have sold cannot be measured, only guessed.</p>
      </Period></div>

      <SecHead num="12">Central levers (never shown to a store or an area manager)</SecHead>
      <Lead>Discounts, ads and the funnel. This is the block that separates the central page from the area page:
        these are the numbers only central can move, and each one lists the stores it came from.</Lead>
      <div className="dcard">
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
        <p>Every figure on this page comes from the spine functions <b>dash_all</b> and <b>dash_central_detail</b>
          {' '}and is reproducible by query. Kitchen preparation time is excluded permanently (verified 23 Aug 2026:
          it measures tablet button-pressing, not kitchen work). Rider wait is the verified speed measure, identical
          across two independent Zomato feeds.</p>
        <p>The page shows settled data only, two days behind, because Zomato keeps revising fresher days: ratings and
          complaint counts on a day still move for several days after it. Online time and rejections do not move.
          Nothing on this page is an estimate and no number is produced by AI.</p>
        <p>Hover any shortened item list to read it in full. Store and area manager names open their own pages.</p>
      </div>
      <DashScript />
    </main>
  );
}
