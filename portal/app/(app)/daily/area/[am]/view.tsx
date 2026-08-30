import { redirect } from 'next/navigation';
import {
  getDashAll, getAreaDetail, getAreaSwiggy, aggregateAreas,
  inr, n0, n1, clockTime, dShort, type AreaReceipt,
} from '@/lib/daily';
import {
  DashHead, DashScript, SecHead, Period, Fold, Rows, Tag, Basket,
  AreaStores, DipCard, AreasTables, ShutShop, Lead, Words,
} from '../../ui';
import { AppTag, AppTabs, AppRows, FaultTag, SwiggyStoresTable, ShortCard } from '../../swiggy-ui';

// See the store page for why this note exists: differences from Petpooja
// that are definitions, not errors. Updated 30 Aug 2026 when Swiggy joined.
const RECONCILE = '<b>Reading this next to Petpooja?</b> Differences are definitions, not errors. Petpooja still shows more orders because walk-in and website are not here. Zomato files an order under the calendar day, Swiggy under the midnight-to-midnight day, Petpooja under the trading night, so post-midnight orders sit on different days. Swiggy splits multi-cake orders into separate deliveries with new order numbers, so order-by-order matching never reaches 100%. And rank 1 means the best-RUN store of the day, never the busiest.';

// The area manager page, approved design v2 (25 Aug 2026). It answers a
// different question from the store page: not "what happened here" but "which
// of my stores needs me today, and what exactly do I say to that store". So
// every number names its outlet and lists the orders behind it.

export default async function AreaView({ am, date, latest }:
  { am: string; date: string; latest: string }) {
  const all = await getDashAll(date);
  const [A, SW] = await Promise.all([getAreaDetail(am, date), getAreaSwiggy(am, date)]);
  const mine = all.stores.filter(s => A.stores.includes(s.code));
  if (!mine.length) redirect('/daily');
  const areas = aggregateAreas(all.stores);

  // The Swiggy half of the day (approved merged design, 30 Aug 2026).
  const sOrdersDay = SW.stores.reduce((t, s) => t + (s.orders ?? 0), 0);
  const sLowDayN = SW.low_day.filter(r => (r.rating ?? 9) <= 2).length;
  const sCancDayVal = SW.canc_day.reduce((t, c) => t + (c.val ?? 0), 0);
  const sCancWkVal = SW.canc_wk.reduce((t, c) => t + (c.val ?? 0), 0) + sCancDayVal;

  const dshort = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const wkLabel = `Last 7 days (${new Date(A.week_start + 'T00:00:00')
    .toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} to ${dshort})`;
  const sum = (f: (s: typeof mine[number]) => number | null | undefined) =>
    mine.reduce((t, s) => t + (f(s) ?? 0), 0);

  const today = (r: AreaReceipt) => r.today === true;
  const earlier = (r: AreaReceipt) => r.today !== true;
  const rejT = A.rejections.filter(today), rejW = A.rejections.filter(earlier);
  const compT = A.complaints.filter(today), compW = A.complaints.filter(earlier).slice(0, 60);
  const lowT = A.low_ratings.filter(today), lowW = A.low_ratings.filter(earlier);
  const moneyWk = A.money_stores.reduce((t, m) => t + m.total_wk, 0);

  const tagCounts = new Map<string, number>();
  for (const r of compW) tagCounts.set(r.tag!, (tagCounts.get(r.tag!) ?? 0) + 1);
  const chips = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]);

  const need: React.ReactNode[] = [];
  if (A.online_dips.length) {
    const w = A.online_dips[0];
    need.push(<li key="o"><b>{w.code} was not fully online</b> ({n1(w.online_day)}%, {n0(w.offmin_day)} min offline).
      Ask what happened at the tablet; section 2 shows the week.</li>);
  }
  if (A.fr_stores.length) {
    const f = A.fr_stores[0];
    need.push(<li key="f"><b>{f.code} pressed &quot;ready&quot; early on {n0(f.fr_wk)} orders this week</b> ({f.pct}% of
      its delivered orders). Section 8 lists the worst ones.</li>);
  }
  if (A.money_stores.length) {
    const m = A.money_stores[0];
    need.push(<li key="m"><b>{m.code} lost {inr(m.total_wk)} this week</b> ({inr(m.stockout_wk)} turned-away orders
      + {inr(m.refunds_wk)} refunds). Section 9 has the split per store.</li>);
  }
  if (A.shut_orders.length) {
    const w = A.shut_stores[0];
    const sv = A.shut_orders.reduce((t, r) => t + (r.value ?? 0), 0);
    need.push(<li key="s"><b>{w.code} turned away {n0(w.orders)} orders because the shop was shut</b>
      {' '}on {w.days} separate {w.days > 1 ? 'days' : 'day'}, and it was showing as open on Zomato each time.
      {' '}{inr(sv)} across your area this week. Section 3 gives the times of day.</li>);
  }
  const best = [...mine].sort((a, b) => (a.dayRank ?? 99) - (b.dayRank ?? 99))[0];
  if (best?.dayRank) need.push(<li key="g"><b>Good news to pass on:</b> {best.code} is the {best.dayRank}
    {best.dayRank === 1 ? 'st' : best.dayRank === 2 ? 'nd' : best.dayRank === 3 ? 'rd' : 'th'} best-RUN store of
    {' '}{all.stores.length} for this day (fewest complaints, rejections and offline minutes; not the busiest).</li>);

  return (
    <main className="dashroot">
      <DashHead title={`${am}'s area`} subtitle={`${mine.length} stores · Zomato + Swiggy`}
        date={date} latest={latest} basePath={`/daily/area/${encodeURIComponent(am)}`} />

      <div className="dctx">
        <div className="dtile"><div className="dlabel">Orders</div>
          <div className="dvalue">{n0(sum(s => s.day.orders) + sOrdersDay)}</div>
          <div className="ddelta"><AppTag app="Z" />{n0(sum(s => s.day.orders))}
            &nbsp;<AppTag app="S" />{n0(sOrdersDay)} &middot; {mine.length} stores</div></div>
        <div className="dtile"><div className="dlabel">Unhappy orders</div>
          <div className="dvalue">{n0(sum(s => s.day.comps) + sLowDayN)}
            {(sum(s => s.day.orders) + sOrdersDay) > 0 && (sum(s => s.day.comps) + sLowDayN) > 0
              ? <small> &nbsp;{n1(100 * (sum(s => s.day.comps) + sLowDayN) / (sum(s => s.day.orders) + sOrdersDay))}% of orders</small>
              : null}</div>
          <div className="ddelta"><AppTag app="Z" />{n0(sum(s => s.day.comps))} complaints
            &nbsp;<AppTag app="S" />{sLowDayN} low-starred</div></div>
        <div className="dtile"><div className="dlabel">Turned away / cancelled on store</div>
          <div className="dvalue">{n0(sum(s => s.day.srej) + SW.canc_day.length)}
            {(sum(s => s.day.orders) + sOrdersDay) > 0 && (sum(s => s.day.srej) + SW.canc_day.length) > 0
              ? <small> &nbsp;{n1(100 * (sum(s => s.day.srej) + SW.canc_day.length) / (sum(s => s.day.orders) + sOrdersDay + sum(s => s.day.srej) + SW.canc_day.length))}% of what came</small>
              : null}</div>
          <div className="ddelta"><AppTag app="Z" />{rejT.length} &nbsp;<AppTag app="S" />{SW.canc_day.length}</div></div>
        <div className="dtile"><div className="dlabel">Money lost, week</div>
          <div className="dvalue">{inr(moneyWk + sCancWkVal)}</div>
          <div className="ddelta"><AppTag app="Z" />{inr(moneyWk)} &nbsp;<AppTag app="S" />{inr(sCancWkVal)}</div></div>
      </div>

      <div className="attention"><h2>Where you are needed</h2><ol>{need.slice(0, 5)}</ol></div>

      <SecHead num="1">Your stores on {dshort}</SecHead>
      <div className="dcard"><Period label={`Ranked worst-first for ${dshort}`}>
        <AppTabs group="s1" />
        <div className="s1view" data-group="s1" data-view="z">
          <AreaStores stores={mine} date={date} />
        </div>
        <div className="s1view off" data-group="s1" data-view="s">
          <SwiggyStoresTable rows={SW.stores} date={date} />
          <p className="note">Swiggy publishes no rider wait, so that column is empty on this tab. Canc counts only
            cancellations charged to the store; 1-2&#9733; is Swiggy&apos;s unhappy-customer signal (it has no
            complaint feed).</p>
        </div>
        <p className="note"># is the store&apos;s rank in that app&apos;s own league for this day, lower is better.
          Red marks a number worth a question. Store names open the store page.
          {SW.unmapped.length ? <> <b>{SW.unmapped.join(', ')} has no Swiggy outlet in the map</b>, so it appears
            only on the Zomato tab; if it does trade on Swiggy, that is a mapping gap to fix, not a quiet zero.</> : null}</p>
      </Period></div>

      <SecHead num="2">Outlets not fully online</SecHead>
      <div className="dcard"><Period label={`${dshort} dips, with their 7-day line`}>
        {(A.online_dips.length || SW.short_series.length)
          ? <div className="minigrid">
              {A.online_dips.map(d => <DipCard key={d.code} dip={d} />)}
              {SW.short_series.map(s => <ShortCard key={s.code} s={s} />)}
            </div>
          : <p className="note">Every store was fully online on both apps on this day.</p>}
        <p className="note">Zomato reports total minutes offline per day; Swiggy reports hours open against its
          expected window. Neither gives clock times.</p>
      </Period></div>

      <SecHead num="3">Orders turned away because the shop was shut</SecHead>
      <Lead>The one number on this page that should be zero. Zomato does not send an order to a store it thinks
        is closed, so each of these is a shop whose listing was live while it could not serve. Section 2 is the
        opposite case, the listing itself going down.</Lead>
      <ShutShop block={A} dshort={dshort} wkLabel={wkLabel} showAm={false} />

      <SecHead num="4">Turned away or cancelled on the store</SecHead>
      <div className="dcard">
        <Period label={dshort}>
          <AppRows id="turn-day" cols={['Store', 'Time', 'App', 'Reason', 'What the customer had ordered', 'Value lost']}
            rows={[
              ...rejT.map(r => ({ app: 'Z' as const, cells: [r.code, r.time, <AppTag key="a" app="Z" />,
                <FaultTag key="t" why={r.reason ?? 'no reason'} />,
                <Basket key="b" text={r.basket} />, inr(r.value)] })),
              ...SW.canc_day.map(c => ({ app: 'S' as const, cells: [c.code ?? '', clockTime(c.t), <AppTag key="a" app="S" />,
                <FaultTag key="t" why={c.why} />, <Basket key="b" text={c.basket} />,
                c.val === null ? 'n/a' : inr(c.val)] })),
            ]}
            empty="Nothing was turned away on either app on this day." />
        </Period>
        <Period label={wkLabel}>
          <Fold label="Earlier this week, both apps" count={rejW.length + SW.canc_wk.length}>
            <AppRows id="turn-wk" cols={['Store', 'Day', 'Time', 'App', 'Reason', 'What the customer had ordered', 'Value lost']}
              rows={[
                ...rejW.map(r => ({ app: 'Z' as const, cells: [r.code, r.dlabel, r.time, <AppTag key="a" app="Z" />,
                  <FaultTag key="t" why={r.reason ?? 'no reason'} />,
                  <Basket key="b" text={r.basket} />, inr(r.value)] })),
                ...SW.canc_wk.map(c => ({ app: 'S' as const, cells: [c.code ?? '', dShort(c.d), clockTime(c.t), <AppTag key="a" app="S" />,
                  <FaultTag key="t" why={c.why} />, <Basket key="b" text={c.basket} />,
                  c.val === null ? 'n/a' : inr(c.val)] })),
              ]} />
          </Fold>
          <p className="note">Only what is charged to the store is listed; customer and rider cancellations are
            excluded. Swiggy values and baskets come from the billed Petpooja order, matched on Swiggy&apos;s own
            order number.</p>
        </Period>
      </div>

      <SecHead num="5">Complaints</SecHead>
      <div className="dcard">
        <Period label={dshort}>
          {compT.length <= 25
            ? <Rows cols={['Store', 'Time', 'Tag on the order', 'What was in the order', 'What the customer wrote', 'Refunded']}
                rows={compT.map(r => [r.code, r.time, <Tag key="t" reason={r.tag ?? ''} />,
                  <Basket key="b" text={r.basket} />, <Words key="w" text={r.review} />,
                  r.refund ? inr(r.refund) : '-'])}
                empty="No issues reported on this day." />
            : <Fold label={`Every order with an issue on ${dshort}`} count={compT.length} open>
                <Rows cols={['Store', 'Time', 'Tag on the order', 'What was in the order', 'What the customer wrote', 'Refunded']}
                  rows={compT.map(r => [r.code, r.time, <Tag key="t" reason={r.tag ?? ''} />,
                    <Basket key="b" text={r.basket} />, <Words key="w" text={r.review} />,
                    r.refund ? inr(r.refund) : '-'])} />
              </Fold>}
        </Period>
        <Period label={wkLabel}>
          <div className="rfilters">
            {chips.map(([t, c]) => (
              <button key={t} className="rfilter" data-reason={t} data-target="area-cw" type="button">{t}: <b>{c}</b></button>
            ))}
            <button className="rfilter on" data-reason="" data-target="area-cw" type="button">Show all</button>
          </div>
          <Fold label="Complaints earlier this week (newest 60)" count={compW.length}>
            <div className="scroll-x">
              <table id="area-cw" className="tight">
                <thead><tr><th>Store</th><th>Day</th><th>Time</th><th>Tag on the order</th>
                  <th>What was in the order</th><th>What the customer wrote</th><th>Refunded</th></tr></thead>
                <tbody>
                  {compW.map((r, i) => (
                    <tr key={i} data-reason={r.tag ?? ''}>
                      <td className="name">{r.code}</td><td>{r.dlabel}</td><td>{r.time}</td>
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
          <p className="note">Tags come from the order itself; Zomato leaves many untagged, and those are listed too.</p>
        </Period>
      </div>

      <SecHead num="6">1, 2 and 3-star orders</SecHead>
      <div className="dcard">
        <Period label={dshort}>
          <AppRows id="low-day" cols={['Store', 'Time', 'App', 'Stars', 'What was in the order', 'What the customer wrote', 'Complaint tag if any']}
            rows={[
              ...lowT.map(r => ({ app: 'Z' as const, cells: [r.code, r.time, <AppTag key="a" app="Z" />, r.rating,
                <Basket key="b" text={r.basket} />, <Words key="w" text={r.review} />,
                r.tag ? <Tag key="t" reason={r.tag} /> : '-'] })),
              ...SW.low_day.map(r => ({ app: 'S' as const, cells: [r.code ?? '', clockTime(r.t), <AppTag key="a" app="S" />,
                r.rating == null ? '-' : n0(r.rating), <Basket key="b" text={r.basket} />,
                <Words key="w" text={r.words} />, '-'] })),
            ]}
            empty="No low-rated orders on this day, on either app." />
        </Period>
        <Period label={wkLabel}>
          <Fold label="Low-rated orders earlier this week, both apps" count={lowW.length + SW.low_wk.length}>
            <AppRows id="low-wk" cols={['Store', 'Day', 'Time', 'App', 'Stars', 'What was in the order', 'What the customer wrote', 'Complaint tag if any']}
              rows={[
                ...lowW.map(r => ({ app: 'Z' as const, cells: [r.code, r.dlabel, r.time, <AppTag key="a" app="Z" />, r.rating,
                  <Basket key="b" text={r.basket} />, <Words key="w" text={r.review} />,
                  r.tag ? <Tag key="t" reason={r.tag} /> : '-'] })),
                ...SW.low_wk.map(r => ({ app: 'S' as const, cells: [r.code ?? '', dShort(r.d), clockTime(r.t), <AppTag key="a" app="S" />,
                  r.rating == null ? '-' : n0(r.rating), <Basket key="b" text={r.basket} />,
                  <Words key="w" text={r.words} />, '-'] })),
              ]} />
          </Fold>
          <p className="note">Only a small share of orders get rated, so treat each one as a specific customer, not a
            percentage. Swiggy baskets show quantities from its item sheet.</p>
        </Period>
      </div>

      <SecHead num="7">Where riders wait</SecHead>
      <div className="dcard"><Period label={`Worst first, ${wkLabel.toLowerCase()}`}>
        <Rows cols={['Store', `Wait on ${dshort}`, 'Wait, week', 'Orders kept 3+ min', 'Delivered', 'Share 3+ min']}
          rows={A.wait_stores.map(w => [w.code,
            (w.wait_day ?? 0) >= 2 ? <span key="a" className="flag">{n1(w.wait_day)}</span> : n1(w.wait_day),
            (w.wait_wk ?? 0) >= 2 ? <span key="b" className="flag">{n1(w.wait_wk)}</span> : n1(w.wait_wk),
            n0(w.waits3_wk), n0(w.delivered_wk),
            (w.pct3 ?? 0) >= 15 ? <span key="c" className="flag">{w.pct3}%</span> : `${w.pct3}%`])} />
        <p className="note">Goal is under 1.5 minutes average and under 3% of orders kept waiting. Rider wait is the
          verified speed measure; Zomato&apos;s kitchen time is excluded because it only tracks how fast the tablet
          button is pressed.</p>
      </Period></div>

      <SecHead num="8">&quot;Ready&quot; pressed before the food was ready</SecHead>
      <div className="dcard">
        <Period label="By store, worst first">
          <Rows cols={['Store', `On ${dshort}`, 'This week', 'Delivered', 'Share of orders']}
            rows={A.fr_stores.map(f => [f.code, n0(f.fr_day), n0(f.fr_wk), n0(f.delivered_wk),
              (f.pct ?? 0) >= 5 ? <span key="p" className="flag">{f.pct}%</span> : `${f.pct}%`])}
            empty="No false ready-presses this week." />
        </Period>
        <Period label="The worst 20 orders of the week">
          <Fold label="Order by order" count={A.fr_orders.length}>
            <Rows cols={['Store', 'Day', 'Time', 'Marked ready after', 'Rider then waited', 'What was in the order']}
              rows={A.fr_orders.map(r => [r.code, r.dlabel, r.time, `${r.ready_secs} sec`,
                `${r.waited_min} min`, <Basket key="b" text={r.basket} />])} />
          </Fold>
          <p className="note">These are orders marked ready within a minute of accepting where the rider then waited 3+ minutes.</p>
        </Period>
      </div>

      <SecHead num="9">Money lost, by store</SecHead>
      <div className="dcard"><Period label={wkLabel}>
        {(() => {
          const sVal = new Map(SW.money_stores.map(m => [m.code, m.canc_val_wk]));
          const codes = new Set([...A.money_stores.map(m => m.code), ...SW.money_stores.map(m => m.code)]);
          const rows = [...codes].map(c => {
            const z = A.money_stores.find(m => m.code === c);
            const s = sVal.get(c) ?? 0;
            return { c, z, s, total: (z?.total_wk ?? 0) + s };
          }).sort((a, b) => b.total - a.total);
          return (
            <Rows cols={['Store', 'Z turned-away', 'Z refunds', 'S cancelled on store', 'Total lost']}
              rows={rows.map(r => [r.c, inr(r.z?.stockout_wk ?? 0), inr(r.z?.refunds_wk ?? 0),
                inr(r.s), <b key="t">{inr(r.total)}</b>])}
              empty="Nothing lost this week, on either app." />
          );
        })()}
        <div className="krow" style={{ marginTop: 10 }}>
          <div className="kpi"><div className="dlabel">Area total, 7 days, both apps</div>
            <div className="dvalue">{inr(moneyWk + sCancWkVal)}</div></div>
        </div>
        <p className="note">Every rupee ties to an order listed in sections 3, 4 and 6. Nothing here is an estimate.</p>
      </Period></div>

      <SecHead num="10">Area versus area</SecHead>
      <div className="dcard">
        <Period label={dshort}>
          <AreasTables areas={areas} date={date} view="day" />
          <p className="note">Ranked by complaint rate for this day, best first. Money lost and false-ready are
            always the 7-day figures, because a single day of either is too small to read.</p>
        </Period>
        <Period label={wkLabel}>
          <AreasTables areas={areas} date={date} view="wk" />
          <p className="note">Area manager names open that area&apos;s page.</p>
        </Period>
      </div>

      <div className="dfoot">
        <p>This page reads the live database and each morning&apos;s pull refreshes recent days, so late ratings and
          complaints appear when you come back. Hover any shortened item list to read it in full.</p>
        <p dangerouslySetInnerHTML={{ __html: RECONCILE }} />
        <p>Item lists come from Zomato&apos;s item export, and fall back to the evening order feed when that export is missing, so a rejection or a complaint always names what the customer wanted.</p>
      </div>
      <DashScript />
    </main>
  );
}
