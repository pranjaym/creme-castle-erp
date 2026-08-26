import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import {
  getDashAll, getAreaDetail, getLatestDate, aggregateAreas, allowedAms,
  inr, n0, n1, type AreaReceipt,
} from '@/lib/daily';
import {
  DashHead, DashScript, SecHead, Period, Fold, Rows, Tag, Basket,
  AreaStores, DipCard, AreasTables, ShutShop, Lead,
} from '../../ui';

// The area manager page, approved design v2 (25 Aug 2026). It answers a
// different question from the store page: not "what happened here" but "which
// of my stores needs me today, and what exactly do I say to that store". So
// every number names its outlet and lists the orders behind it.

export default async function AreaDaily({ params, searchParams }:
  { params: Promise<{ am: string }>; searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser();
  const { am: amRaw } = await params;
  const am = decodeURIComponent(amRaw);

  const latest = await getLatestDate();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! <= latest ? sp.date! : latest;

  const all = await getDashAll(date);
  if (!allowedAms(user, all.stores).includes(am)) redirect('/daily');
  const A = await getAreaDetail(am, date);
  const mine = all.stores.filter(s => A.stores.includes(s.code));
  if (!mine.length) redirect('/daily');
  const areas = aggregateAreas(all.stores);

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
  if (best?.dayRank) need.push(<li key="g"><b>Good news to pass on:</b> {best.code} ranks {best.dayRank} of
    {' '}{all.stores.length} network-wide for this day.</li>);

  return (
    <main className="dashroot">
      <DashHead title={`${am}'s area`} subtitle={`${mine.length} stores`}
        date={date} latest={latest} basePath={`/daily/area/${encodeURIComponent(am)}`} />

      <div className="dctx">
        <div className="dtile"><div className="dlabel">Orders</div>
          <div className="dvalue">{n0(sum(s => s.day.orders))}</div>
          <div className="ddelta">across {mine.length} stores</div></div>
        <div className="dtile"><div className="dlabel">Complaints</div>
          <div className="dvalue">{n0(sum(s => s.day.comps))}</div>
          <div className="ddelta">{compT.length} orders had an issue</div></div>
        <div className="dtile"><div className="dlabel">Store rejections</div>
          <div className="dvalue">{n0(sum(s => s.day.srej))}</div>
          <div className="ddelta">{rejT.length} orders turned away</div></div>
        <div className="dtile"><div className="dlabel">Money lost, week</div>
          <div className="dvalue">{inr(moneyWk)}</div>
          <div className="ddelta">stockouts + refunds</div></div>
      </div>

      <div className="attention"><h2>Where you are needed</h2><ol>{need.slice(0, 5)}</ol></div>

      <SecHead num="1">Your stores on {dshort}</SecHead>
      <div className="dcard"><Period label={`Ranked worst-first for ${dshort}`}>
        <AreaStores stores={mine} date={date} />
        <p className="note">Ranked by complaints + rejections + offline, lower is better. Red marks a number worth a
          question. Store names open the store page.</p>
      </Period></div>

      <SecHead num="2">Outlets not fully online</SecHead>
      <div className="dcard"><Period label={`${dshort} dips, with their 7-day line`}>
        {A.online_dips.length
          ? <div className="minigrid">{A.online_dips.map(d => <DipCard key={d.code} dip={d} />)}</div>
          : <p className="note">Every store was fully online on this day.</p>}
        <p className="note">Zomato reports total minutes offline per day, never the clock times.</p>
      </Period></div>

      <SecHead num="3">Orders turned away because the shop was shut</SecHead>
      <Lead>The one number on this page that should be zero. Zomato does not send an order to a store it thinks
        is closed, so each of these is a shop whose listing was live while it could not serve. Section 2 is the
        opposite case, the listing itself going down.</Lead>
      <ShutShop block={A} dshort={dshort} wkLabel={wkLabel} showAm={false} />

      <SecHead num="4">Rejected orders</SecHead>
      <div className="dcard">
        <Period label={dshort}>
          <Rows cols={['Store', 'Time', 'Reason', 'What the customer had ordered', 'Value lost']}
            rows={rejT.map(r => [r.code, r.time, <Tag key="t" reason={r.reason ?? ''} />,
              <Basket key="b" text={r.basket} />, inr(r.value)])}
            empty="No store-caused rejections on this day." />
        </Period>
        <Period label={wkLabel}>
          <Fold label="Rejections earlier this week" count={rejW.length}>
            <Rows cols={['Store', 'Day', 'Time', 'Reason', 'What the customer had ordered', 'Value lost']}
              rows={rejW.map(r => [r.code, r.dlabel, r.time, <Tag key="t" reason={r.reason ?? ''} />,
                <Basket key="b" text={r.basket} />, inr(r.value)])} />
          </Fold>
          <p className="note">Only store-caused rejections are listed; customer and rider cancellations are excluded.</p>
        </Period>
      </div>

      <SecHead num="5">Complaints</SecHead>
      <div className="dcard">
        <Period label={dshort}>
          {compT.length <= 25
            ? <Rows cols={['Store', 'Time', 'Tag on the order', 'What was in the order', 'Refunded']}
                rows={compT.map(r => [r.code, r.time, <Tag key="t" reason={r.tag ?? ''} />,
                  <Basket key="b" text={r.basket} />, r.refund ? inr(r.refund) : '-'])}
                empty="No issues reported on this day." />
            : <Fold label={`Every order with an issue on ${dshort}`} count={compT.length} open>
                <Rows cols={['Store', 'Time', 'Tag on the order', 'What was in the order', 'Refunded']}
                  rows={compT.map(r => [r.code, r.time, <Tag key="t" reason={r.tag ?? ''} />,
                    <Basket key="b" text={r.basket} />, r.refund ? inr(r.refund) : '-'])} />
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
                  <th>What was in the order</th><th>Refunded</th></tr></thead>
                <tbody>
                  {compW.map((r, i) => (
                    <tr key={i} data-reason={r.tag ?? ''}>
                      <td className="name">{r.code}</td><td>{r.dlabel}</td><td>{r.time}</td>
                      <td><Tag reason={r.tag ?? ''} /></td>
                      <td><Basket text={r.basket} /></td>
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
          <Rows cols={['Store', 'Time', 'Stars', 'What was in the order', 'Complaint tag if any']}
            rows={lowT.map(r => [r.code, r.time, r.rating, <Basket key="b" text={r.basket} />,
              r.tag ? <Tag key="t" reason={r.tag} /> : '-'])}
            empty="No low-rated orders on this day." />
        </Period>
        <Period label={wkLabel}>
          <Fold label="Low-rated orders earlier this week" count={lowW.length}>
            <Rows cols={['Store', 'Day', 'Time', 'Stars', 'What was in the order', 'Complaint tag if any']}
              rows={lowW.map(r => [r.code, r.dlabel, r.time, r.rating, <Basket key="b" text={r.basket} />,
                r.tag ? <Tag key="t" reason={r.tag} /> : '-'])} />
          </Fold>
          <p className="note">Only a small share of orders get rated, so treat each one as a specific customer, not a percentage.</p>
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
        <Rows cols={['Store', 'Turned-away orders', 'Rejections', 'Refunds', 'Complaints', 'Total lost']}
          rows={A.money_stores.map(m => [m.code, inr(m.stockout_wk), n0(m.rej_wk), inr(m.refunds_wk),
            n0(m.comp_wk), <b key="t">{inr(m.total_wk)}</b>])}
          empty="Nothing lost to rejections or refunds this week." />
        <p className="note">Every rupee ties to an order listed in sections 3 and 4. Nothing here is an estimate.</p>
      </Period></div>

      <SecHead num="10">Area versus area</SecHead>
      <div className="dcard"><AreasTables areas={areas} date={date} /></div>

      <div className="dfoot">
        <p>This page reads the live database and each morning&apos;s pull refreshes recent days, so late ratings and
          complaints appear when you come back. Hover any shortened item list to read it in full.</p>
      </div>
      <DashScript />
    </main>
  );
}
