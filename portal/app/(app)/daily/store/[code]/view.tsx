import { redirect } from 'next/navigation';
import {
  getDashAll, getStoreDetail, getStoreReasons, getStoreSwiggy,
  inr, n0, n1, clockTime, dShort, type Receipt,
} from '@/lib/daily';
import {
  DashHead, DashScript, SecHead, HBar,
  Chart, Verdict, Period, Fold, Rows, Tag, Words, Basket,
} from '../../ui';
import { AppTag, AppFilter, AppRows, FaultTag } from '../../swiggy-ui';

// Why Petpooja will not agree with this page, in one place so the three pages
// and the three mails can never drift apart. Updated 30 Aug 2026 when Swiggy
// joined the page (before that the difference was "this page is Zomato only").
const RECONCILE = '<b>Reading this next to Petpooja?</b> Differences are definitions, not errors. Petpooja still shows more orders because walk-in and website are not here. Zomato files an order under the calendar day it was placed and Swiggy under the midnight-to-midnight day, while Petpooja uses the trading night, so post-midnight orders sit on different days. Swiggy splits a multi-cake order into separate deliveries with new order numbers: Petpooja bills the split children while Swiggy&rsquo;s report keeps the combined parent, so order-by-order matching never reaches 100%. And rank 1 means the best-RUN store of the day, never the busiest.';

// The store page, approved design v3 (25 Aug 2026), merged with Swiggy on
// 30 Aug 2026 (Pranjay: one page, one day, both apps; every row tagged Z or
// S). The locked rules stand: labelled Yesterday then Last 7 days blocks, no
// number without its orders, verdicts with goals, folds, complaint filters
// from ORDER tags. New locked rules from the merge: outlet-mistake reasons
// read red; Swiggy baskets carry quantities; ratings one row per rated ORDER;
// speed stays Zomato-only (Swiggy publishes no timing); "What customers said"
// is its own section; unhappy and turned-away carry % of orders for impact.

export default async function StoreView({ code, date, latest }:
  { code: string; date: string; latest: string }) {
  const [all, det, reasons, sw] = await Promise.all([
    getDashAll(date), getStoreDetail(code, date), getStoreReasons(code, date),
    getStoreSwiggy(code, date),
  ]);
  const me = all.stores.find(s => s.code === code);
  if (!me) redirect('/daily');
  const day = me.day, wk = me.wk;
  const sday = sw.mapped ? sw.day : null;

  const tLabels = det.trend.map(t =>
    new Date(t.d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }));
  const weekLabel = `Last 7 days (${new Date(det.week_start + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} to ${new Date(date + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`;
  const dayLabel = `Yesterday (${new Date(date + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`;

  // The merged day, both apps.
  const sOrders = sday?.orders ?? 0;
  const totOrders = (day.orders ?? 0) + sOrders;
  const sLowDay = sw.mapped ? sw.rated_day.filter(r => (r.rating ?? 9) <= 2).length : 0;
  const unhappyDay = (det.complaints_day.length) + sLowDay;
  const unhappyPct = totOrders ? (100 * unhappyDay) / totOrders : null;
  const sCancDayVal = sw.canc_day.reduce((t, c) => t + (c.val ?? 0), 0);
  const turnDay = (day.srej ?? 0) + sw.canc_day.length;
  const turnPct = totOrders ? (100 * turnDay) / (totOrders + turnDay) : null;
  const sCancWkVal = sw.canc_wk.reduce((t, c) => t + (c.val ?? 0), 0);
  const lossWk = det.refunds_wk + det.stockout_wk + sCancWkVal;
  const sTrend = sw.trend ?? [];
  const sTLabels = sTrend.map(t => dShort(t.d));

  // Filter chips come from the tags the week's own rows carry; Swiggy 1-2 star
  // orders join the same fold under their own tag (approved 30 Aug).
  const S_TAG = 'Swiggy 1-2 stars';
  const tagCounts = new Map<string, number>();
  for (const r of det.complaints_wk) {
    const t = r.tag ?? 'reason not tagged by Zomato';
    tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const sLowWkEarlier = sw.low_wk.filter(r => r.d !== date);
  if (sLowWkEarlier.length) tagCounts.set(S_TAG, sLowWkEarlier.length);
  const chips = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

  const things: React.ReactNode[] = [];
  if (unhappyDay > 0) things.push(
    <li key="u"><b>{unhappyDay} unhappy order{unhappyDay === 1 ? '' : 's'} yesterday
      ({n1(unhappyPct)}% of {n0(totOrders)} orders)</b>: {det.complaints_day.length} Zomato complaint{det.complaints_day.length === 1 ? '' : 's'}
      {sLowDay ? <> and {sLowDay} Swiggy order{sLowDay === 1 ? '' : 's'} rated 1-2 stars</> : null}. Sections 3 and 6 name each one.</li>);
  if (det.stockout_day + sCancDayVal > 0) things.push(
    <li key="s"><b>{inr(det.stockout_day + sCancDayVal)} of orders were turned away or cancelled on the store
      yesterday.</b> Section 2 lists each one with its reason; stockouts get fixed today.</li>);
  if ((wk.fr ?? 0) > 0) things.push(
    <li key="f"><b>&quot;Ready&quot; was pressed early on {n0(wk.fr)} Zomato orders this week</b> while the rider stood
      waiting. Press ready only when the bag is sealed.</li>);
  if (!things.length) things.push(<li key="g"><b>A clean day on both apps.</b> Keep it there.</li>);

  // Staffing: both apps together.
  const meal: Record<string, number> = { ...(det.mealtime_wk ?? {}) };
  if (sw.mapped) for (const [k, v] of Object.entries(sw.slot_wk ?? {})) {
    const key = k === 'Late Night' ? 'Late night' : k;
    meal[key] = (meal[key] ?? 0) + v;
  }
  const mealTotal = Object.values(meal).reduce((a, b) => a + b, 0);
  const mealNames: [string, string][] = [['Dinner', 'Dinner (7 to 11 pm)'], ['Lunch', 'Lunch (11 am to 4 pm)'],
    ['Snacks', 'Snacks (4 to 7 pm)'], ['Late night', 'Late night (11 pm to 7 am)'], ['Breakfast', 'Breakfast (7 to 11 am)']];

  const league = [...all.stores].sort((a, b) => (a.dayRank ?? 99) - (b.dayRank ?? 99));
  const leagueShown = league.slice(0, 5).concat((me.dayRank ?? 99) > 5 ? [me] : []);
  const sLeagueShown = sw.league ?? [];

  const R = (r: Receipt, ...cells: React.ReactNode[]) => cells;

  return (
    <main className="dashroot">
      <DashHead title={`Store Daily: ${code}`}
        subtitle={`${det.locality ?? ''}${det.city ? ', ' + det.city : ''} · Area manager: ${det.am ?? '-'} · Zomato + Swiggy${sw.mapped ? '' : ' (no Swiggy outlet mapped for this store)'}`}
        date={date} latest={latest} basePath={`/daily/store/${encodeURIComponent(code)}`} />

      <div className="dctx">
        <div className="dtile"><div className="dlabel">Orders</div><div className="dvalue">{n0(totOrders)}</div>
          <div className="ddelta"><AppTag app="Z" />{n0(day.orders)} &nbsp;<AppTag app="S" />{n0(sOrders)}
            {day.avgord || sday?.avg7 ? <> &middot; own 7-day average {n0((day.avgord ?? 0) + (sday?.avg7 ?? 0))}</> : null}</div></div>
        <div className="dtile"><div className="dlabel">Delivered</div>
          <div className="dvalue">{n0((day.delivered ?? 0) + sOrders)} <small>of {n0(totOrders)}</small></div>
          <div className="ddelta">Swiggy&apos;s sheets count delivered orders only</div></div>
        <div className="dtile"><div className="dlabel">Unhappy orders</div>
          <div className="dvalue">{n0(unhappyDay)}{unhappyPct !== null && unhappyDay > 0
            ? <small> &nbsp;{n1(unhappyPct)}% of orders</small> : null}</div>
          <div className="ddelta"><AppTag app="Z" />{det.complaints_day.length} complaints
            &nbsp;<AppTag app="S" />{sLowDay} low-starred</div></div>
        <div className="dtile"><div className="dlabel">Ratings</div>
          <div className="dvalue"><AppTag app="Z" />{day.rating ? n1(day.rating) : '-'}
            &nbsp;<AppTag app="S" />{sday?.rating != null ? n1(sday.rating) : '-'}</div>
          <div className="ddelta">{det.rated_day.length + (sw.rated_day?.length ?? 0)} orders rated</div></div>
        <div className="dtile"><div className="dlabel">Network rank</div>
          <div className="dvalue"><AppTag app="Z" />{me.dayRank ?? '-'} <small>of {all.stores.length}</small>
            &nbsp;<AppTag app="S" />{sw.rank ?? '-'} <small>of {sw.rank_of ?? '-'}</small></div>
          <div className="ddelta">best-RUN store of the day, not the busiest</div></div>
      </div>

      <div className="attention"><h2>Things for today</h2><ol>{things.slice(0, 3)}</ol></div>

      <SecHead num="1">Were you open?</SecHead>
      <div className="dcard">
        <Period label={dayLabel}>
          <div className="krow">
            <div className="kpi"><div className="dlabel"><AppTag app="Z" />Online time</div>
              <div className="dvalue">{day.online === null ? '-' : n1(day.online) + '%'}</div>
              <Verdict ok={(day.online ?? 0) >= 99.9} good="full day online" bad={`offline ${n0(day.offmin)} min`} /></div>
            {sday ? (
              <div className="kpi"><div className="dlabel"><AppTag app="S" />Open hours</div>
                <div className="dvalue">{n1((sday.ih ?? 0) - (sday.short ?? 0))} <small>of {n1(sday.ih)}</small></div>
                <Verdict ok={(sday.open_pct ?? 0) >= 97} good={`${n1(sday.open_pct)}% of the expected window`}
                  bad={`${n1(sday.short)} hours missing from the expected window`} /></div>
            ) : null}
          </div>
          <p className="note">Zomato reports minutes offline per day; Swiggy reports hours open against its expected
            window. Neither says the clock time: if a day shows time missing, ask the store what happened.</p>
        </Period>
        <Period label={weekLabel}>
          <div className="chartrow">
            <Chart series={det.trend.map(t => t.offmin)} labels={tLabels}
              title="Zomato: minutes offline per day (0 = fully online)" unit=" min" lo={0} />
            {sw.mapped && sTrend.length ? (
              <Chart series={sTrend.map(t => t.short)} labels={sTLabels}
                title="Swiggy: hours not open per day (0 = fully open)" unit="" lo={0} />
            ) : null}
          </div>
        </Period>
      </div>

      <SecHead num="2">Did you deliver what came?</SecHead>
      <div className="dcard">
        <Period label={dayLabel}>
          <div className="krow"><div className="kpi"><div className="dlabel">Turned away or cancelled on the store</div>
            <div className="dvalue">{n0(turnDay)}{turnPct !== null && turnDay > 0
              ? <small> &nbsp;{n1(turnPct)}% of what came</small> : null}</div>
            <Verdict ok={turnDay === 0} good="accepted and delivered everything"
              bad={`${inr(det.stockout_day + sCancDayVal)} of orders lost`} /></div></div>
          <AppRows id="turn-day" cols={['Time', 'App', 'Reason', 'What the customer had ordered', 'Value lost']}
            rows={[
              ...det.rejections_day.map(r => ({ app: 'Z' as const, cells: [r.time, <AppTag key="a" app="Z" />,
                <FaultTag key="t" why={r.reason ?? 'no reason'} />, <Basket key="b" text={r.basket} />, inr(r.value)] })),
              ...sw.canc_day.map(c => ({ app: 'S' as const, cells: [clockTime(c.t), <AppTag key="a" app="S" />,
                <FaultTag key="t" why={c.why} />, <Basket key="b" text={c.basket} />,
                c.val === null ? 'n/a' : inr(c.val)] })),
            ]}
            empty="Nothing was turned away on either app yesterday." />
        </Period>
        <Period label={weekLabel}>
          <div className="krow"><div className="kpi"><div className="dlabel">Turned away this week</div>
            <div className="dvalue">{n0((wk.srej ?? 0) + sw.canc_wk.length)}</div>
            <div className="ddelta">{inr(det.stockout_wk + sCancWkVal)} of orders lost, both apps</div></div></div>
          <Chart series={det.trend.map(t => t.srej)} labels={tLabels}
            title="Zomato: store-caused rejections per day" lo={0} />
          <Fold label="Earlier this week, both apps" count={det.rejections_wk.length + sw.canc_wk.filter(c => c.d !== date).length}>
            <AppRows id="turn-wk" cols={['Day', 'Time', 'App', 'Reason', 'What the customer had ordered', 'Value lost']}
              rows={[
                ...det.rejections_wk.map(r => ({ app: 'Z' as const, cells: [r.dlabel, r.time, <AppTag key="a" app="Z" />,
                  <FaultTag key="t" why={r.reason ?? 'no reason'} />, <Basket key="b" text={r.basket} />, inr(r.value)] })),
                ...sw.canc_wk.filter(c => c.d !== date).map(c => ({ app: 'S' as const, cells: [dShort(c.d), clockTime(c.t),
                  <AppTag key="a" app="S" />, <FaultTag key="t" why={c.why} />,
                  <Basket key="b" text={c.basket} />, c.val === null ? 'n/a' : inr(c.val)] })),
              ]} />
          </Fold>
          <p className="note">Customer- and rider-caused cancellations are not listed and not counted against the
            store ({det.other_cancels_wk} on Zomato this week). Swiggy values and baskets come from the billed
            Petpooja order, matched on Swiggy&apos;s own order number.</p>
        </Period>
      </div>

      <SecHead num="3">Was it right?</SecHead>
      <div className="dcard">
        <Period label={dayLabel}>
          <div className="krow">
            <div className="kpi"><div className="dlabel">Complaints (Zomato official)</div>
              <div className="dvalue">{n0(day.comps)}</div>
              <Verdict ok={(day.comps ?? 0) === 0} good="no complaints"
                bad={`${n0(day.comps)} on ${n0(day.orders)} Zomato orders (${n1(day.cpct)}%)`} /></div>
            <div className="kpi"><div className="dlabel">Customers reporting an issue</div>
              <div className="dvalue">{det.complaints_day.length}</div>
              <div className="ddelta">Zomato counts only some as official complaints</div></div>
          </div>
          <div className="tlabel">Every order with an issue yesterday, with its tag</div>
          <Rows cols={['Time', 'Tag on the order', 'What was in the order', 'What the customer wrote', 'Refunded']}
            rows={det.complaints_day.map(r => R(r, r.time, <Tag reason={r.tag ?? ''} />, r.basket ?? '-',
              <Words text={r.review} />, r.refund ? inr(r.refund) : '-'))} empty="No issues reported yesterday." />
          <p className="note">Swiggy publishes no complaint feed; its unhappy signal is the 1-2 star ratings, in the
            filterable list below and in section 6 with the customer&apos;s words.</p>
        </Period>
        <Period label={weekLabel}>
          <div className="krow">
            <div className="kpi"><div className="dlabel">Complaints this week (Zomato official)</div>
              <div className="dvalue">{n0(reasons.comps)}</div></div>
            <div className="kpi"><div className="dlabel">Orders with a reported issue</div>
              <div className="dvalue">{det.complaints_day.length + det.complaints_wk.length + sLowWkEarlier.length}</div>
              <div className="ddelta">including Swiggy&apos;s {sLowWkEarlier.length} low-starred earlier this week</div></div>
          </div>
          <Chart series={det.trend.map(t => t.comps)} labels={tLabels} title="Zomato complaints per day" lo={0} />
          <div className="tlabel">Zomato&apos;s reason counts for the week (their own daily figures)</div>
          <HBar rows={[{ name: 'Poor taste or quality', value: reasons.quality ?? 0 },
            { name: 'Poor packaging or spillage', value: reasons.packaging ?? 0 },
            { name: 'Items missing', value: reasons.missing ?? 0 },
            { name: 'Wrong items', value: reasons.wrong ?? 0 },
            { name: 'Delivered late', value: reasons.late ?? 0 }].filter(r => r.value > 0)} />
          <div className="tlabel">Orders before yesterday, grouped by the tag on the order. Click a tag, or narrow to one app.</div>
          <AppFilter target="comp-wk" />
          <div className="rfilters">
            {chips.map(([t, c]) => (
              <button key={t} className="rfilter" data-reason={t} data-target="comp-wk" type="button">{t}: <b>{c}</b></button>
            ))}
            <button className="rfilter on" data-reason="" data-target="comp-wk" type="button">Show all</button>
          </div>
          <details className="fold" open>
            <summary>Orders with issues earlier this week ({det.complaints_wk.length + sLowWkEarlier.length}) &rsaquo; tap to close</summary>
            <div className="scroll-x">
              <table id="comp-wk">
                <thead><tr><th>Day</th><th>Time</th><th>App</th><th>Tag on the order</th><th>What was in the order</th><th>What the customer wrote</th><th>Refunded</th></tr></thead>
                <tbody>
                  {det.complaints_wk.map((r, i) => (
                    <tr key={`z${i}`} data-app="Z" data-reason={r.tag ?? 'reason not tagged by Zomato'}>
                      <td>{r.dlabel}</td><td>{r.time}</td><td><AppTag app="Z" /></td><td><Tag reason={r.tag ?? ''} /></td>
                      <td>{r.basket ?? '-'}</td><td><Words text={r.review} /></td>
                      <td>{r.refund ? inr(r.refund) : '-'}</td>
                    </tr>
                  ))}
                  {sLowWkEarlier.map((r, i) => (
                    <tr key={`s${i}`} data-app="S" data-reason={S_TAG}>
                      <td>{dShort(r.d)}</td><td>{clockTime(r.t)}</td><td><AppTag app="S" /></td>
                      <td><span className="rchip r-taste">{r.rating} star{r.rating === 1 ? '' : 's'}</span></td>
                      <td><Basket text={r.basket} /></td><td><Words text={r.words} /></td><td>-</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="note">Two counts, two sources, both true: Zomato&apos;s official complaint figure comes from their
            daily report, while the list is every order where a customer raised something, plus every 1-2 star Swiggy
            order. Zomato tags a reason on only some orders; untagged orders are listed too.</p>
        </Period>
      </div>

      <SecHead num="4">Was it fast, and was &quot;ready&quot; honest? <AppTag app="Z" /><small>Zomato only</small></SecHead>
      <div className="dcard">
        <Period label={dayLabel}>
          <div className="krow">
            <div className="kpi"><div className="dlabel">Avg rider wait at counter</div>
              <div className="dvalue">{day.wait === null ? '-' : n1(day.wait)} <small>min</small></div>
              <Verdict ok={(day.wait ?? 9) < 1.5} good="riders picked up fast (goal: under 1.5 min)"
                bad="riders waited too long (goal: under 1.5 min)" /></div>
            <div className="kpi"><div className="dlabel">Rider waited 3+ min</div>
              <div className="dvalue">{n0(det.waits3_day)} <small>of {n0(det.delivered_day)} timed</small></div>
              <div className="ddelta">counted only on orders where Zomato timestamped the rider</div>
              <Verdict ok={det.waits3_day <= Math.max(2, det.delivered_day * 0.03)}
                good="within the normal 3%" bad="above the normal 3% of orders" /></div>
            <div className="kpi"><div className="dlabel">&quot;Ready&quot; pressed early, rider left waiting</div>
              <div className="dvalue">{det.false_ready_day.length}</div>
              <Verdict ok={det.false_ready_day.length === 0} good="the ready button was honest"
                bad="pressed ready before the food was ready" /></div>
          </div>
          <Fold label="Yesterday's false ready-presses, order by order" count={det.false_ready_day.length} open>
            <Rows cols={['Time', 'Marked ready after', 'Rider then waited', 'What was in the order']}
              rows={det.false_ready_day.map(r => R(r, r.time, `${r.ready_secs} sec`, `${r.waited_min} min`, r.basket ?? '-'))} />
          </Fold>
        </Period>
        <Period label={weekLabel}>
          <div className="krow">
            <div className="kpi"><div className="dlabel">False ready-presses this week</div>
              <div className="dvalue">{n0(wk.fr)}</div>
              <Verdict ok={(wk.fr ?? 0) <= 5} good="rare" bad="a habit, not an accident: raise it with the team" /></div>
            <div className="kpi"><div className="dlabel">Riders kept waiting 3+ min</div>
              <div className="dvalue">{n0(det.waits3_wk)}</div></div>
          </div>
          <Chart series={det.trend.map(t => t.wait)} labels={tLabels} title="Average rider wait per day" unit=" min" lo={0} />
          <Fold label="Worst false ready-presses earlier this week" count={det.false_ready_wk.length}>
            <Rows cols={['Day', 'Time', 'Marked ready after', 'Rider then waited', 'What was in the order']}
              rows={det.false_ready_wk.map(r => R(r, r.dlabel, r.time, `${r.ready_secs} sec`, `${r.waited_min} min`, r.basket ?? '-'))} />
          </Fold>
          <p className="note">Swiggy&apos;s report publishes no preparation or rider timing at all, so this section
            cannot exist for Swiggy. On Zomato, rider wait is the honest speed measure, cross-checked across two
            independent feeds; kitchen preparation time only measures how fast the tablet button is pressed.</p>
        </Period>
      </div>

      <SecHead num="5">What did mistakes cost?</SecHead>
      <div className="dcard">
        <Period label="Yesterday and the week together">
          <Rows cols={['What cost money', 'App', 'Yesterday', 'Last 7 days', 'What it means']}
            rows={[
              ['Refunds to customers', <AppTag key="a" app="Z" />, inr(det.refunds_day), inr(det.refunds_wk), 'charged back to the restaurant for complaints'],
              ['Orders turned away', <AppTag key="a" app="Z" />, inr(det.stockout_day), inr(det.stockout_wk), 'value of store-rejected orders (section 2 lists them)'],
              ['Orders cancelled on the store', <AppTag key="a" app="S" />, inr(sCancDayVal), inr(sCancWkVal), 'billed value of the orders in section 2'],
            ]} />
          <div className="krow" style={{ marginTop: 10 }}>
            <div className="kpi"><div className="dlabel">Total avoidable loss, 7 days, both apps</div>
              <div className="dvalue">{inr(lossWk)}</div>
              <Verdict ok={lossWk < 1000} good="small"
                bad="this is the number to bring down: every line is store-controllable" /></div>
          </div>
          <p className="note">Every rupee ties to a specific order listed in sections 2 and 3; nothing is an estimate.
            Swiggy&apos;s report carries no refund column, so Swiggy complaint refunds (if any) are not here yet.</p>
        </Period>
      </div>

      <SecHead num="6">What customers said</SecHead>
      <div className="dcard">
        <Period label={dayLabel}>
          <div className="krow"><div className="kpi"><div className="dlabel">Ratings yesterday</div>
            <div className="dvalue"><AppTag app="Z" />{day.rating ? n1(day.rating) : '-'}
              &nbsp;<AppTag app="S" />{sday?.rating != null ? n1(sday.rating) : '-'} <small>/ 5</small></div>
            <div className="ddelta">{det.rated_day.length + (sw.rated_day?.length ?? 0)} orders rated; every one is
              listed so none hides</div></div></div>
          <Rows cols={['Time', 'App', 'Stars', 'What was in the order', 'The customer’s words']}
            rows={[
              ...det.rated_day.map(r => R(r, r.time, <AppTag key="a" app="Z" />, r.rating, r.basket ?? '-', <Words text={r.review} />)),
              ...(sw.rated_day ?? []).map(r => [clockTime(r.t), <AppTag key="a" app="S" />,
                r.rating == null ? '-' : n0(r.rating), <Basket key="b" text={r.basket} />, <Words key="w" text={r.words} />]),
            ]}
            empty="No orders rated yesterday on either app." />
        </Period>
        <Period label={weekLabel}>
          <div className="chartrow">
            <Chart series={det.trend.map(t => (t.rating && t.rating > 0 ? t.rating : null))} labels={tLabels}
              title="Zomato rating per day (few orders are rated, so this swings)" lo={1} hi={5} />
            {sw.mapped && sTrend.length ? (
              <Chart series={sTrend.map(t => t.rating)} labels={sTLabels}
                title="Swiggy rating per day" lo={1} hi={5} />
            ) : null}
          </div>
          {sw.comments_wk?.length ? (
            <>
              <div className="tlabel">Every written Swiggy comment of the week, in the customer&apos;s own words
                (Zomato reviews appear in the lists above and below)</div>
              <Rows cols={['Day', 'Time', 'Stars', 'Items', 'The customer’s words']}
                rows={sw.comments_wk.map(r => [dShort(r.d), clockTime(r.t),
                  r.rating == null ? '-' : n0(r.rating), <Basket key="b" text={r.basket} />, <Words key="w" text={r.words} />])} />
            </>
          ) : null}
          <Fold label="Every 1 and 2-star order of the week, both apps"
            count={det.low_ratings_wk.length + sw.low_wk.length}>
            <AppRows id="low-wk" cols={['Day', 'Time', 'App', 'Stars', 'What was in the order', 'The customer’s words', 'Tag if any']}
              rows={[
                ...det.low_ratings_wk.map(r => ({ app: 'Z' as const, cells: [r.dlabel, r.time, <AppTag key="a" app="Z" />, r.rating,
                  r.basket ?? '-', <Words key="w" text={r.review} />, r.tag ? <Tag key="t" reason={r.tag} /> : '-'] })),
                ...sw.low_wk.map(r => ({ app: 'S' as const, cells: [dShort(r.d), clockTime(r.t), <AppTag key="a" app="S" />,
                  r.rating == null ? '-' : n0(r.rating), <Basket key="b" text={r.basket} />,
                  <Words key="w" text={r.words} />, '-'] })),
              ]} />
          </Fold>
        </Period>
      </div>

      <SecHead num="7">Scoreboard</SecHead>
      <div className="dcard">
        <Period label={`${dayLabel}, one league per app (their metrics are not comparable)`}>
          <div className="tlabel"><AppTag app="Z" />Zomato league: ranked by complaints + rejections + offline,
            lower is better. Top 5 plus this store (bold).</div>
          <Rows cols={['#', 'Store', 'AM', 'Orders', 'Complaints', 'Online %', 'Rating']}
            rows={leagueShown.map(s => [s.dayRank ?? '-',
              s.code === code ? <b>{s.code}</b> : s.code, s.am ?? '', n0(s.day.orders), n0(s.day.comps),
              s.day.online === null ? '-' : n1(s.day.online), s.day.rating ? n1(s.day.rating) : '-'])} />
          {sw.mapped && sLeagueShown.length ? (
            <>
              <div className="tlabel" style={{ marginTop: 14 }}><AppTag app="S" />Swiggy league: ranked by
                store-caused cancellations + 1-2 star orders + hours offline, lower is better.</div>
              <Rows cols={['#', 'Store', 'Orders', 'Cancelled on store', 'Hrs offline', 'Rating']}
                rows={sLeagueShown.map(l => [l.rank,
                  l.code === code ? <b>{l.code}</b> : l.code, n0(l.orders), n0(l.cancels),
                  n1(l.short), l.rating === null ? '-' : n1(l.rating)])} />
            </>
          ) : null}
        </Period>
      </div>

      {mealTotal > 0 ? (
        <>
          <SecHead num="+">When your orders come (staffing and prep)</SecHead>
          <div className="dcard">
            <HBar rows={mealNames.map(([k, label]) => ({ name: label, value: Math.round(100 * (meal[k] ?? 0) / mealTotal) }))} />
            <p className="note">Share of this store&apos;s orders over the 7 days, both apps together.</p>
          </div>
        </>
      ) : null}

      <div className="dfoot">
        <p><b>Does an old day update?</b> Yes. This page reads the live database: the Zomato pulls refresh recent
          days each morning, and Swiggy&apos;s file restates the whole month daily, so ratings and complaints that
          arrive late appear when you come back.</p>
        <p>Sales, discounts, ads and the order funnel are deliberately absent; they live in the sales dashboards.
          Toing orders ride inside the Swiggy numbers (Swiggy counts both menus as one outlet). Every number here is
          reproducible from the database.</p>
        <p dangerouslySetInnerHTML={{ __html: RECONCILE }} />
        <p>Zomato item lists come from Zomato&apos;s item export with the evening feed as fallback. Swiggy
          cancellation values and baskets are the billed Petpooja orders, matched on Swiggy&apos;s own order number,
          never on a name.</p>
      </div>
      <DashScript />
    </main>
  );
}
