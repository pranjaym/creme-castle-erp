import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import {
  getDashAll, getLatestDate, getStoreDetail, getStoreReasons, canSeeStore,
  inr, n0, n1, type Receipt,
} from '@/lib/daily';
import { DashHead, DashScript, Tile, V, D, Spark, HBar, SecHead, StoresTables } from '../../ui';

function ReceiptTable({ rows, cols, caption }:
  { rows: Receipt[]; cols: { key: string; label: string; fmt?: (v: unknown) => string }[]; caption?: string }) {
  if (!rows.length) return <p className="note">Nothing to list.</p>;
  return (
    <div className="scroll-x">
      <table className="sheet sortable">
        <thead><tr>{cols.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map(c => <td key={c.key}>{c.fmt ? c.fmt(r[c.key]) : String(r[c.key] ?? '-')}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {caption ? <p className="note">{caption}</p> : null}
    </div>
  );
}

export default async function StoreDaily({ params, searchParams }:
  { params: Promise<{ code: string }>; searchParams: Promise<{ date?: string }> }) {
  const user = await requireUser();
  const { code: codeRaw } = await params;
  const code = decodeURIComponent(codeRaw);
  if (!canSeeStore(user, code)) redirect('/daily');

  const latest = await getLatestDate();
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? '') && sp.date! <= latest ? sp.date! : latest;

  const [all, detail, reasons] = await Promise.all([
    getDashAll(date), getStoreDetail(code, date), getStoreReasons(code, date),
  ]);
  const me = all.stores.find(s => s.code === code);
  if (!me) redirect('/daily');

  const day = me.day, wk = me.wk;
  const trendDays = detail.trend.map(t =>
    new Date(t.d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }));
  const hasOrderDetail = detail.trend.length > 0 && (wk.wait !== null || detail.false_ready_wk.length > 0
    || detail.complaints_day.length > 0 || wk.stockout !== null);

  const meal = detail.mealtime_wk;
  const mealTotal = Object.values(meal).reduce((a, b) => a + b, 0);
  const mealRows = [
    ['Dinner', 'Dinner (7 to 11 pm)'], ['Lunch', 'Lunch (11 am to 4 pm)'],
    ['Snacks', 'Snacks (4 to 7 pm)'], ['Late night', 'Late night (11 pm to 7 am)'],
    ['Breakfast', 'Breakfast (7 to 11 am)'],
  ].map(([k, label]) => ({ name: label, value: meal[k] ?? 0 }))
    .sort((a, b) => b.value - a.value);

  const attention: React.ReactNode[] = [];
  const rTop = [
    ['packaging', 'packaging and spillage'], ['quality', 'taste or quality'],
    ['missing', 'missing items'], ['wrong', 'wrong items'], ['late', 'late delivery'],
  ].map(([k, label]) => ({ label, v: (reasons as Record<string, number>)[k] ?? 0 }))
    .sort((a, b) => b.v - a.v)[0];
  if (rTop && rTop.v >= 3) attention.push(<li key="r"><b>Top complaint reason this week: {rTop.label}</b> ({rTop.v} tags). Worth one physical check of how orders go out.</li>);
  if ((wk.stockout ?? 0) > 0) attention.push(<li key="s"><b>Stockouts cost {inr(wk.stockout)} this week</b> ({detail.rejections_wk.length} rejected orders, listed below). Check stock before the dinner rush.</li>);
  if ((wk.fr ?? 0) > 0) attention.push(<li key="f"><b>&quot;Ready&quot; was pressed early on {n0(wk.fr)} orders this week</b> while the rider stood waiting. Press ready only when the bag is sealed.</li>);
  if ((day.comps ?? 0) === 0 && (day.srej ?? 0) === 0 && (day.online ?? 0) >= 99.9) {
    attention.push(<li key="g"><b>A clean day:</b> no complaints, no rejections, fully online. That is the standard.</li>);
  }

  return (
    <main className="dashroot" data-view="y">
      <DashHead title={`Store Daily: ${code}`}
        subtitle={`${detail.locality ?? ''}${detail.city ? ', ' + detail.city : ''} · Area manager: ${detail.am ?? '-'}`}
        date={date} latest={latest} basePath={`/daily/store/${encodeURIComponent(code)}`} />

      <div className="dctx">
        <Tile label="Orders"
          y={<><V>{n0(day.orders)}</V><D>{day.avgord ? `own 7-day average ${n0(day.avgord)}` : ''}</D></>}
          wk={<><V>{n0(wk.orders)}</V><D>{wk.orders ? `${n0(Math.round(wk.orders / 7))} per day` : ''}</D></>} />
        <Tile label="Delivered"
          y={<V>{n0(day.delivered)} <small>of {n0(day.orders)}</small></V>}
          wk={<V>{n0(wk.delivered)} <small>of {n0(wk.orders)}</small></V>} />
        <Tile label="Food rating"
          y={<><V>{day.rating ? n1(day.rating) : '-'} <small>/ 5</small></V><D>{detail.rated_day.length} orders rated</D></>}
          wk={<><V>{wk.rating ? n1(wk.rating) : '-'} <small>/ 5</small></V><D>average of the daily ratings</D></>} />
        <Tile label="Network rank"
          y={<><V>{me.dayRank ?? '-'} <small>of {all.stores.length}</small></V><D>for the day</D></>}
          wk={<><V>{me.wkRank ?? '-'} <small>of {all.stores.length}</small></V><D>for the 7 days</D></>} />
      </div>

      {attention.length ? (
        <div className="attention"><h2>Things for today</h2><ol>{attention.slice(0, 3)}</ol></div>
      ) : null}

      <SecHead num="1">Were you open?</SecHead>
      <div className="dcard">
        <div className="krow">
          <div className="kpi"><div className="dlabel">Online time</div>
            <span className="only-y"><V>{day.online === null ? '-' : n1(day.online) + '%'}</V>
              {day.online !== null && day.online >= 99.9 ? <span className="chip okc">&#10003; full day online</span> : null}</span>
            <span className="only-wk"><V>{wk.online === null ? '-' : n1(wk.online) + '%'}</V></span></div>
          <div className="kpi"><div className="dlabel">Time offline</div>
            <span className="only-y"><V>{n0(day.offmin)} <small>min</small></V></span>
            <span className="only-wk"><V>{n0(wk.offmin)} <small>min</small></V></span></div>
          <Spark points={detail.trend.map(t => t.online)} labels={trendDays} min={95} max={100} suffix="%"
            caption="online % per day, the 7 days ending on the selected date" />
        </div>
      </div>

      <SecHead num="2">Did you accept what came?</SecHead>
      <div className="dcard">
        <div className="krow">
          <div className="kpi"><div className="dlabel">Rejected by the store</div>
            <span className="only-y"><V>{n0(day.srej)}</V>
              {(day.srej ?? 0) === 0 ? <span className="chip okc">&#10003; clean day</span> : null}</span>
            <span className="only-wk"><V>{n0(wk.srej)}</V></span></div>
          <Spark points={detail.trend.map(t => t.srej)} labels={trendDays} min={0}
            caption="store-caused rejections per day" />
        </div>
        <div className="only-wk">
          <ReceiptTable rows={detail.rejections_wk}
            cols={[{ key: 'label', label: 'When' }, { key: 'reason', label: 'Reason' },
                   { key: 'basket', label: 'What the customer had ordered' },
                   { key: 'value', label: 'Value lost', fmt: v => inr(Number(v)) }]}
            caption={`This week's store-caused rejections. Not counted against the store: ${n0(detail.other_cancels_wk)} further orders were cancelled from the customer or rider side.`} />
        </div>
      </div>

      <SecHead num="3">Was it right?</SecHead>
      <div className="dcard">
        <div className="krow">
          <div className="kpi"><div className="dlabel">Complaints</div>
            <span className="only-y"><V>{n0(day.comps)} <small>{day.cpct !== null ? `(${n1(day.cpct)}% of orders)` : ''}</small></V></span>
            <span className="only-wk"><V>{n0(wk.comps)}</V></span></div>
          <Spark points={detail.trend.map(t => t.comps)} labels={trendDays} min={0}
            caption="complaints per day" />
        </div>
        {(reasons.comps ?? 0) > 0 ? (
          <>
            <div className="dlabel" style={{ margin: '10px 0 6px' }}>Complaint reasons this week (one complaint can carry several)</div>
            <HBar rows={[
              { name: 'Poor taste or quality', value: reasons.quality ?? 0 },
              { name: 'Packaging or spillage', value: reasons.packaging ?? 0 },
              { name: 'Items missing', value: reasons.missing ?? 0 },
              { name: 'Delivered late', value: reasons.late ?? 0 },
              { name: 'Wrong items', value: reasons.wrong ?? 0 },
            ].filter(r => r.value > 0).sort((a, b) => b.value - a.value)} />
          </>
        ) : null}
        <div className="only-y" style={{ marginTop: 10 }}>
          <ReceiptTable rows={detail.complaints_day}
            cols={[{ key: 'label', label: 'When' }, { key: 'basket', label: 'What was in the order' },
                   { key: 'tag', label: 'Tag' }]}
            caption="Orders where the customer reported an issue on the selected day. Zomato's official complaint count can be lower; both are shown." />
        </div>
      </div>

      <SecHead num="4">Was it fast, and was &quot;ready&quot; honest?</SecHead>
      <div className="dcard">
        <div className="krow">
          <div className="kpi"><div className="dlabel">Avg rider wait at counter</div>
            <span className="only-y"><V>{day.wait === null ? '-' : n1(day.wait) + ' min'}</V>
              {day.wait !== null && day.wait < 1 ? <span className="chip okc">&#10003; under 1 min</span> : null}</span>
            <span className="only-wk"><V>{wk.wait === null ? '-' : n1(wk.wait) + ' min'}</V></span></div>
          <div className="kpi"><div className="dlabel">Rider waited 3+ min</div>
            <span className="only-y"><V>{day.fr === null && day.wait === null ? '-' : n0(day.fr)}</V><D>ready pressed early</D></span>
            <span className="only-wk"><V>{n0(wk.waits3)}</V><D>of {n0(wk.delivered)} delivered</D></span></div>
          <div className="kpi"><div className="dlabel">&quot;Ready&quot; pressed early, rider left waiting</div>
            <span className="only-y"><V>{day.fr === null ? '-' : n0(day.fr)}</V><D>{n0(wk.fr)} this week, listed below</D></span>
            <span className="only-wk"><V>{n0(wk.fr)}</V></span></div>
        </div>
        <ReceiptTable rows={detail.false_ready_wk}
          cols={[{ key: 'label', label: 'When' },
                 { key: 'ready_secs', label: 'Marked ready after', fmt: v => `${v} sec` },
                 { key: 'waited_min', label: 'Rider then waited', fmt: v => `${v} min` },
                 { key: 'basket', label: 'What was in the order' }]}
          caption='Orders where "food ready" was pressed within a minute of accepting, yet the rider waited 3+ minutes. Cross-verified across two independent Zomato feeds.' />
        <div className="callout"><b>Why there is no kitchen preparation time here:</b> verified across 20 months,
          Zomato&apos;s KPT only measures how quickly the tablet button is pressed, and its daily average has produced
          impossible values. It is excluded as meaningless, not missing.</div>
      </div>

      <SecHead num="5">What did mistakes cost?</SecHead>
      <div className="dcard">
        <div className="krow">
          <div className="kpi"><div className="dlabel">Refunded</div>
            <span className="only-y"><V>{inr(detail.refunds_day)}</V></span>
            <span className="only-wk"><V>{inr(detail.refunds_wk)}</V></span></div>
          <div className="kpi"><div className="dlabel">Lost to stockouts, week</div><V>{inr(detail.stockout_wk)}</V></div>
        </div>
      </div>

      <SecHead num="6">Scoreboard</SecHead>
      <div className="dcard">
        <div className="krow">
          <div className="kpi"><div className="dlabel">Rating</div>
            <span className="only-y"><V>{day.rating ? n1(day.rating) : '-'}</V></span>
            <span className="only-wk"><V>{wk.rating ? n1(wk.rating) : '-'}</V><D>few orders are rated, so this swings</D></span></div>
          <Spark points={detail.trend.map(t => (t.rating && t.rating > 0 ? t.rating : null))}
            labels={trendDays} min={1} max={5} caption="avg rating per day" />
        </div>
        <div className="only-y">
          <ReceiptTable rows={detail.rated_day}
            cols={[{ key: 'label', label: 'When' }, { key: 'rating', label: 'Stars' },
                   { key: 'basket', label: 'What was in the order' }]} />
        </div>
        <div className="only-wk">
          <ReceiptTable rows={detail.low_ratings_wk}
            cols={[{ key: 'label', label: '1 and 2-star orders this week' },
                   { key: 'rating', label: 'Stars' },
                   { key: 'basket', label: 'What was in the order' },
                   { key: 'tag', label: 'Complaint tag' }]} />
        </div>
        <div className="dlabel" style={{ margin: '16px 0 6px' }}>Network league (all stores)</div>
        <StoresTables stores={all.stores} date={date} highlight={code} />
      </div>

      {mealTotal > 0 ? (
        <>
          <SecHead num="+">When your orders come (for staffing and prep)</SecHead>
          <div className="dcard">
            <HBar rows={mealRows.map(r => ({ name: r.name, value: Math.round(100 * r.value / mealTotal) }))} />
            <p className="note">Share (%) of this store&apos;s orders in the 7 days, using Zomato&apos;s daypart definitions.</p>
          </div>
        </>
      ) : null}

      {!hasOrderDetail ? (
        <p className="hint warn">Order-level detail (receipts, rider wait, false-ready) exists from August 2026 onward;
          earlier dates show the daily quality numbers only.</p>
      ) : null}

      <div className="dfoot">
        <p>Ads, discounts, offers and customer types are managed centrally and are deliberately absent from this page.
        Zomato may revise the last 3 days of figures. Every number is reproducible from the spine.</p>
      </div>
      <DashScript />
    </main>
  );
}
