import { redirect } from 'next/navigation';
import {
  getDashAll, getStoreDetail, getStoreReasons,
  inr, n0, n1, type Receipt,
} from '@/lib/daily';
import {
  DashHead, DashScript, SecHead, HBar,
  Chart, Verdict, Period, Fold, Rows, Tag, Words,
} from '../../ui';

// Why Petpooja will not agree with this page, in one place so the three pages
// and the three mails can never drift apart. Written after area manager Ajay
// Rana reported the dashboard as wrong on 27 Aug 2026: every one of his points
// was either a real bug (the clock, now fixed) or one of these three, which are
// definitions rather than errors and were simply never stated on the page.
const RECONCILE = '<b>Reading this next to Petpooja?</b> Three things differ by design, and none of them is an error. This page is <b>Zomato only</b>, so Petpooja will show roughly twice the orders once Swiggy and walk-in are included: compare against Petpooja&rsquo;s Zomato channel alone. Zomato files an order under the CALENDAR day it was placed while Petpooja files it under the trading night, so orders between midnight and 2am sit on different days in the two systems. And rank 1 means the best-RUN store of the day (fewest complaints, fewest rejections, fully online), never the busiest.';

// The store page, approved design v3 (25 Aug 2026). Rules, in order of the
// arguments that produced them:
//   1. No hidden day/week toggle: each section shows a labelled Yesterday block
//      then a labelled Last 7 days block.
//   2. No number without its orders.
//   3. Week lists exclude yesterday (already listed above); week TOTALS still
//      cover 7 days and say so. Times show clock only, because a post-midnight
//      order belongs to the previous business day.
//   4. Charts carry axes. 5. Every KPI carries a verdict and its goal.
//   6. Long lists fold. 7. Complaint filters are built from the tags the ORDER
//      rows carry, never from Zomato's daily-report words: they differ, and
//      mixing them made filters that returned nothing.

export default async function StoreView({ code, date, latest }:
  { code: string; date: string; latest: string }) {
  const [all, det, reasons] = await Promise.all([
    getDashAll(date), getStoreDetail(code, date), getStoreReasons(code, date),
  ]);
  const me = all.stores.find(s => s.code === code);
  if (!me) redirect('/daily');
  const day = me.day, wk = me.wk;

  const tLabels = det.trend.map(t =>
    new Date(t.d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }));
  const weekLabel = `Last 7 days (${new Date(det.week_start + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} to ${new Date(date + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`;
  const dayLabel = `Yesterday (${new Date(date + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})`;

  // Filter chips come from the tags the week's own rows carry.
  const tagCounts = new Map<string, number>();
  for (const r of det.complaints_wk) {
    const t = r.tag ?? 'reason not tagged by Zomato';
    tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const chips = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

  const things: React.ReactNode[] = [];
  const topReason = ([['packaging and spillage', reasons.packaging], ['taste or quality', reasons.quality],
    ['missing items', reasons.missing], ['wrong items', reasons.wrong], ['late delivery', reasons.late]] as const)
    .map(([n, v]) => ({ n, v: v ?? 0 })).sort((a, b) => b.v - a.v)[0];
  if (topReason && topReason.v >= 3) things.push(
    <li key="r"><b>Top complaint reason this week: {topReason.n}</b> ({topReason.v} tags). Worth one physical check of how orders go out.</li>);
  if (det.stockout_wk > 0) things.push(
    <li key="s"><b>Stockouts cost {inr(det.stockout_wk)} this week.</b> The rejected orders and their items are in section 2.</li>);
  if ((wk.fr ?? 0) > 0) things.push(
    <li key="f"><b>&quot;Ready&quot; was pressed early on {n0(wk.fr)} orders this week</b> while the rider stood waiting. Press ready only when the bag is sealed.</li>);
  if (!things.length) things.push(<li key="g"><b>A clean week.</b> Keep it there.</li>);

  const meal = det.mealtime_wk ?? {};
  const mealTotal = Object.values(meal).reduce((a, b) => a + b, 0);
  const mealNames: [string, string][] = [['Dinner', 'Dinner (7 to 11 pm)'], ['Lunch', 'Lunch (11 am to 4 pm)'],
    ['Snacks', 'Snacks (4 to 7 pm)'], ['Late night', 'Late night (11 pm to 7 am)'], ['Breakfast', 'Breakfast (7 to 11 am)']];

  const league = [...all.stores].sort((a, b) => (a.dayRank ?? 99) - (b.dayRank ?? 99));
  const leagueShown = league.slice(0, 5).concat((me.dayRank ?? 99) > 5 ? [me] : []);

  const R = (r: Receipt, ...cells: React.ReactNode[]) => cells;

  return (
    <main className="dashroot">
      <DashHead title={`Store Daily: ${code}`}
        subtitle={`${det.locality ?? ''}${det.city ? ', ' + det.city : ''} · Area manager: ${det.am ?? '-'} · Zomato orders only`}
        date={date} latest={latest} basePath={`/daily/store/${encodeURIComponent(code)}`} />

      <div className="dctx">
        <div className="dtile"><div className="dlabel">Orders</div><div className="dvalue">{n0(day.orders)}</div>
          <div className="ddelta">own 7-day average {n0(day.avgord)}</div></div>
        <div className="dtile"><div className="dlabel">Delivered</div>
          <div className="dvalue">{n0(day.delivered)} <small>of {n0(day.orders)}</small></div></div>
        <div className="dtile"><div className="dlabel">Food rating</div>
          <div className="dvalue">{day.rating ? n1(day.rating) : '-'} <small>/ 5</small></div>
          <div className="ddelta">{det.rated_day.length} orders rated</div></div>
        <div className="dtile"><div className="dlabel">Network rank</div>
          <div className="dvalue">{me.dayRank ?? '-'} <small>of {all.stores.length}</small></div>
          <div className="ddelta">best-RUN store of the day, not the busiest</div></div>
      </div>

      <div className="attention"><h2>Things for today</h2><ol>{things.slice(0, 3)}</ol></div>

      <SecHead num="1">Were you open?</SecHead>
      <div className="dcard">
        <Period label={dayLabel}>
          <div className="krow">
            <div className="kpi"><div className="dlabel">Online time</div>
              <div className="dvalue">{day.online === null ? '-' : n1(day.online) + '%'}</div>
              <Verdict ok={(day.online ?? 0) >= 99.9} good="full day online" bad={`offline ${n0(day.offmin)} min`} /></div>
            <div className="kpi"><div className="dlabel">Time offline</div>
              <div className="dvalue">{n0(day.offmin)} <small>min</small></div></div>
          </div>
          <p className="note">Zomato tells us the total minutes offline per day, never the clock times. If a day shows
            big offline minutes, ask the store what happened; the export cannot say when.</p>
        </Period>
        <Period label={weekLabel}>
          <Chart series={det.trend.map(t => t.offmin)} labels={tLabels}
            title="Minutes offline per day (0 = fully online)" unit=" min" lo={0} />
        </Period>
      </div>

      <SecHead num="2">Did you accept what came?</SecHead>
      <div className="dcard">
        <Period label={dayLabel}>
          <div className="krow"><div className="kpi"><div className="dlabel">Rejected by the store</div>
            <div className="dvalue">{n0(day.srej)}</div>
            <Verdict ok={(day.srej ?? 0) === 0} good="accepted everything"
              bad={`${inr(det.stockout_day)} of orders turned away`} /></div></div>
          <Rows cols={['Time', 'Why it was rejected', 'What the customer had ordered', 'Value lost']}
            rows={det.rejections_day.map(r => R(r, r.time, <Tag reason={r.reason ?? ''} />, r.basket ?? '-', inr(r.value)))}
            empty="No store-caused rejections yesterday." />
        </Period>
        <Period label={weekLabel}>
          <div className="krow"><div className="kpi"><div className="dlabel">Rejected this week</div>
            <div className="dvalue">{n0(wk.srej)}</div>
            <div className="ddelta">{inr(det.stockout_wk)} of orders turned away</div></div></div>
          <Chart series={det.trend.map(t => t.srej)} labels={tLabels} title="Store-caused rejections per day" lo={0} />
          <Fold label="Rejections earlier this week, before yesterday" count={det.rejections_wk.length}>
            <Rows cols={['Day', 'Time', 'Why', 'What the customer had ordered', 'Value lost']}
              rows={det.rejections_wk.map(r => R(r, r.dlabel, r.time, <Tag reason={r.reason ?? ''} />, r.basket ?? '-', inr(r.value)))} />
          </Fold>
          <p className="note">Cancellations caused by the customer or the rider are not listed here and are not counted
            against the store ({det.other_cancels_wk} this week).</p>
        </Period>
      </div>

      <SecHead num="3">Was it right?</SecHead>
      <div className="dcard">
        <Period label={dayLabel}>
          <div className="krow">
            <div className="kpi"><div className="dlabel">Complaints (Zomato official)</div>
              <div className="dvalue">{n0(day.comps)}</div>
              <Verdict ok={(day.comps ?? 0) === 0} good="no complaints"
                bad={`${n0(day.comps)} on ${n0(day.orders)} orders (${n1(day.cpct)}%)`} /></div>
            <div className="kpi"><div className="dlabel">Customers reporting an issue</div>
              <div className="dvalue">{det.complaints_day.length}</div>
              <div className="ddelta">Zomato counts only some as official complaints</div></div>
          </div>
          <div className="tlabel">Every order with an issue yesterday, with its tag</div>
          <Rows cols={['Time', 'Tag on the order', 'What was in the order', 'What the customer wrote', 'Refunded']}
            rows={det.complaints_day.map(r => R(r, r.time, <Tag reason={r.tag ?? ''} />, r.basket ?? '-',
              <Words text={r.review} />, r.refund ? inr(r.refund) : '-'))} empty="No issues reported yesterday." />
        </Period>
        <Period label={weekLabel}>
          <div className="krow">
            <div className="kpi"><div className="dlabel">Complaints this week (Zomato official)</div>
              <div className="dvalue">{n0(reasons.comps)}</div></div>
            <div className="kpi"><div className="dlabel">Orders with a reported issue</div>
              <div className="dvalue">{det.complaints_day.length + det.complaints_wk.length}</div>
              <div className="ddelta">{det.complaints_wk.length} of them before yesterday, listed below</div></div>
          </div>
          <Chart series={det.trend.map(t => t.comps)} labels={tLabels} title="Complaints per day" lo={0} />
          <div className="tlabel">Zomato&apos;s reason counts for the week (their own daily figures)</div>
          <HBar rows={[{ name: 'Poor taste or quality', value: reasons.quality ?? 0 },
            { name: 'Poor packaging or spillage', value: reasons.packaging ?? 0 },
            { name: 'Items missing', value: reasons.missing ?? 0 },
            { name: 'Wrong items', value: reasons.wrong ?? 0 },
            { name: 'Delivered late', value: reasons.late ?? 0 }].filter(r => r.value > 0)} />
          <div className="tlabel">Orders before yesterday that you can open, grouped by the tag on the order. Click a tag to filter.</div>
          <div className="rfilters">
            {chips.map(([t, c]) => (
              <button key={t} className="rfilter" data-reason={t} data-target="comp-wk" type="button">{t}: <b>{c}</b></button>
            ))}
            <button className="rfilter on" data-reason="" data-target="comp-wk" type="button">Show all</button>
          </div>
          <details className="fold" open>
            <summary>Orders with issues earlier this week ({det.complaints_wk.length}) &rsaquo; tap to close</summary>
            <div className="scroll-x">
              <table id="comp-wk">
                <thead><tr><th>Day</th><th>Time</th><th>Tag on the order</th><th>What was in the order</th><th>What the customer wrote</th><th>Refunded</th></tr></thead>
                <tbody>
                  {det.complaints_wk.map((r, i) => (
                    <tr key={i} data-reason={r.tag ?? 'reason not tagged by Zomato'}>
                      <td>{r.dlabel}</td><td>{r.time}</td><td><Tag reason={r.tag ?? ''} /></td>
                      <td>{r.basket ?? '-'}</td><td><Words text={r.review} /></td>
                      <td>{r.refund ? inr(r.refund) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="note">Two counts, two sources, both true: Zomato&apos;s official complaint figure comes from their
            daily report, while the list is every order where a customer raised something. Zomato tags a reason on only
            some orders, so the tag counts are smaller than their daily totals. Nothing is hidden: untagged orders are listed too.</p>
        </Period>
      </div>

      <SecHead num="4">Was it fast, and was &quot;ready&quot; honest?</SecHead>
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
          <p className="note">Why this matters: pressing ready early looks fast on Zomato&apos;s screens but makes riders
            wait, delays other orders and risks penalties. Kitchen preparation time is shown nowhere: we verified it only
            measures how fast the tablet button is pressed. Rider wait is the honest speed measure, cross-checked across
            two independent Zomato feeds.</p>
        </Period>
      </div>

      <SecHead num="5">What did mistakes cost?</SecHead>
      <div className="dcard">
        <Period label="Yesterday and the week together">
          <Rows cols={['What cost money', 'Yesterday', 'Last 7 days', 'What it means']}
            rows={[
              ['Refunds to customers', inr(det.refunds_day), inr(det.refunds_wk), 'charged back to the restaurant for complaints'],
              ['Orders turned away', inr(det.stockout_day), inr(det.stockout_wk), 'value of store-rejected orders (section 2 lists them)'],
            ]} />
          <div className="krow" style={{ marginTop: 10 }}>
            <div className="kpi"><div className="dlabel">Total avoidable loss, 7 days</div>
              <div className="dvalue">{inr(det.refunds_wk + det.stockout_wk)}</div>
              <Verdict ok={(det.refunds_wk + det.stockout_wk) < 1000} good="small"
                bad="this is the number to bring down: both lines are store-controllable" /></div>
          </div>
          <p className="note">Every rupee here ties to a specific order listed in sections 2 and 3; nothing is an estimate.</p>
        </Period>
      </div>

      <SecHead num="6">Scoreboard</SecHead>
      <div className="dcard">
        <Period label={dayLabel}>
          <div className="krow"><div className="kpi"><div className="dlabel">Food rating</div>
            <div className="dvalue">{day.rating ? n1(day.rating) : '-'} <small>/ 5</small></div>
            <div className="ddelta">{det.rated_day.length} orders rated; every rating is listed so none hides</div></div></div>
          <Rows cols={['Time', 'Stars', 'What was in the order', 'What the customer wrote']}
            rows={det.rated_day.map(r => R(r, r.time, r.rating, r.basket ?? '-', <Words text={r.review} />))}
            empty="No orders rated yesterday." />
          <div className="tlabel" style={{ marginTop: 14 }}>
            Network league for this day: top 5 plus this store (bold). Ranked by complaints + rejections + offline,
            lower is better. This is a cleanliness ranking, not a sales ranking: a small store with a spotless day
            outranks a busy store with one complaint.
          </div>
          <Rows cols={['#', 'Store', 'AM', 'Orders', 'Complaints', 'Online %', 'Rating']}
            rows={leagueShown.map(s => [s.dayRank ?? '-',
              s.code === code ? <b>{s.code}</b> : s.code, s.am ?? '', n0(s.day.orders), n0(s.day.comps),
              s.day.online === null ? '-' : n1(s.day.online), s.day.rating ? n1(s.day.rating) : '-'])} />
        </Period>
        <Period label={weekLabel}>
          <Chart series={det.trend.map(t => (t.rating && t.rating > 0 ? t.rating : null))} labels={tLabels}
            title="Average rating per day (few orders are rated, so this swings)" lo={1} hi={5} />
          <Fold label="Every 1 and 2-star order of the week" count={det.low_ratings_wk.length}>
            <Rows cols={['Day', 'Time', 'Stars', 'What was in the order', 'What the customer wrote', 'Complaint tag if any']}
              rows={det.low_ratings_wk.map(r => R(r, r.dlabel, r.time, r.rating, r.basket ?? '-',
                <Words text={r.review} />, r.tag ? <Tag reason={r.tag} /> : '-'))} />
          </Fold>
        </Period>
      </div>

      {mealTotal > 0 ? (
        <>
          <SecHead num="+">When your orders come (staffing and prep)</SecHead>
          <div className="dcard">
            <HBar rows={mealNames.map(([k, label]) => ({ name: label, value: Math.round(100 * (meal[k] ?? 0) / mealTotal) }))} />
            <p className="note">Share of this store&apos;s orders over the 7 days.</p>
          </div>
        </>
      ) : null}

      <div className="dfoot">
        <p><b>Does an old day update?</b> Yes. This page reads the live database, and each morning&apos;s pull refreshes
          recent days, so ratings and complaints that arrive late appear when you come back.</p>
        <p>Ads, discounts and customer types are managed centrally and are deliberately absent. Every number here is
          reproducible from the database.</p>
        <p dangerouslySetInnerHTML={{ __html: RECONCILE }} />
        <p>Item lists come from Zomato&apos;s item export, and fall back to the evening order feed when that export is missing, so a rejection or a complaint always names what the customer wanted.</p>
      </div>
      <DashScript />
    </main>
  );
}
