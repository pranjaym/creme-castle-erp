// Shared building blocks for the daily dashboard pages (server components).
// The interactivity (view toggle, sorting, sparklines) is /dash.js.
import Script from 'next/script';
import Link from 'next/link';
import { dateLabel, shiftDate } from '@/lib/daily';

export function DashHead({ title, subtitle, date, latest, basePath }:
  { title: string; subtitle: string; date: string; latest: string; basePath: string }) {
  const prev = shiftDate(date, -1);
  const next = shiftDate(date, 1);
  return (
    <div className="masthead">
      <h1 className="page">{title}</h1>
      <p className="hint" style={{ marginBottom: 8 }}>{subtitle}</p>
      <div className="datebar">
        <span className="datelabel">{dateLabel(date)}</span>
        <Link className="smallbtn ghost" href={`${basePath}?date=${prev}`}>&#8592; previous day</Link>
        {date < latest ? <Link className="smallbtn ghost" href={`${basePath}?date=${next}`}>next day &#8594;</Link> : null}
        <form method="get" action={basePath} className="dateform">
          <input className="mini txt" type="date" name="date" defaultValue={date} min="2025-01-01" max={latest} />
          <button className="smallbtn" type="submit">Go</button>
        </form>
        <span className="views" role="tablist" aria-label="Period">
          <button className="on" data-view="y" type="button">Day</button>
          <button data-view="wk" type="button">Last 7 days</button>
        </span>
      </div>
      <p className="note">
        Zomato may revise the last 3 days of figures slightly. Click any column heading to sort.
        &quot;Last 7 days&quot; = the 7 days ending on the selected date.
      </p>
    </div>
  );
}

export function DashScript() {
  return <Script src="/dash.js" strategy="lazyOnload" />;
}

export function Tile({ label, y, wk }: { label: string; y: React.ReactNode; wk: React.ReactNode }) {
  return (
    <div className="dtile">
      <div className="dlabel">{label}</div>
      <span className="only-y">{y}</span>
      <span className="only-wk">{wk}</span>
    </div>
  );
}

export function V({ children }: { children: React.ReactNode }) {
  return <div className="dvalue">{children}</div>;
}
export function D({ children }: { children: React.ReactNode }) {
  return <div className="ddelta">{children}</div>;
}

export function Spark({ points, labels, min, max, suffix, caption }:
  { points: (number | null)[]; labels: string[]; min?: number; max?: number; suffix?: string; caption: string }) {
  return (
    <div className="spark">
      <svg className="sparkline" width="252" height="56" role="img" aria-label={caption}
        data-points={JSON.stringify(points)} data-labels={JSON.stringify(labels)}
        data-min={min ?? ''} data-max={max ?? ''} data-suffix={suffix ?? ''} />
      <div className="cap">{caption}</div>
    </div>
  );
}

export function HBar({ rows }: { rows: { name: string; value: number }[] }) {
  const mx = Math.max(...rows.map(r => r.value), 1);
  return (
    <div className="hbar-block">
      {rows.map(r => (
        <div className="hbar" key={r.name}>
          <div className="name">{r.name}</div>
          <div className="track"><div className="fill" style={{ width: `${Math.round(100 * r.value / mx)}%` }} /></div>
          <div className="val">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

export function SecHead({ num, children }: { num: string; children: React.ReactNode }) {
  return (
    <div className="sec-head">
      <span className="secnum">{num}</span>
      <h2 className="section" style={{ margin: 0 }}>{children}</h2>
    </div>
  );
}

// The ranked stores table, one per view, sortable. Used by the central page
// (all stores) and the area page (their stores). Store names link to the
// store page for the same date: every number is a door.
import type { StoreStats } from '@/lib/daily';
import { inr, n1 } from '@/lib/daily';

function vsAvg(s: StoreStats): React.ReactNode {
  const o = s.day.orders, a = s.day.avgord;
  if (o === null || !a) return '-';
  const d = Math.round((100 * (o - a)) / a);
  const txt = (d >= 0 ? '+' : '') + d + '%';
  if (d >= 10) return <span className="goodv">{txt}</span>;
  if (d <= -15) return <span className="flag">{txt} &#9650;</span>;
  return txt;
}
const flag = (v: React.ReactNode, bad: boolean) => bad ? <span className="flag">{v} &#9650;</span> : v;

export function StoresTables({ stores, date, highlight }:
  { stores: StoreStats[]; date: string; highlight?: string }) {
  const link = (s: StoreStats) => (
    <Link href={`/daily/store/${encodeURIComponent(s.code)}?date=${date}`}>{s.code}</Link>
  );
  const dayRows = [...stores].sort((a, b) => (a.dayRank ?? 99) - (b.dayRank ?? 99));
  const wkRows = [...stores].sort((a, b) => (a.wkRank ?? 99) - (b.wkRank ?? 99));
  const head = (
    <thead><tr>
      <th>#</th><th>Store</th><th>Locality</th><th>AM</th><th>Orders</th><th className="alt-col">vs avg</th>
      <th>Online %</th><th>Rejections</th><th>Complaints</th><th>Rating</th><th>Rider wait</th>
      <th>False-ready wk</th><th>Money lost wk</th>
    </tr></thead>
  );
  return (
    <>
      <div className="scroll-x only-y"><table className="sheet sortable">{head}<tbody>
        {dayRows.map(s => (
          <tr key={s.code} className={s.code === highlight ? 'me' : undefined}>
            <td>{s.dayRank ?? '-'}</td>
            <td className="name">{link(s)}</td>
            <td>{s.locality ?? ''}</td><td>{s.am ?? ''}</td>
            <td>{s.day.orders ?? '-'}</td>
            <td>{vsAvg(s)}</td>
            <td>{flag(s.day.online === null ? '-' : n1(s.day.online), (s.day.online ?? 100) < 99)}</td>
            <td>{flag(s.day.srej ?? '-', (s.day.srej ?? 0) >= 2)}</td>
            <td>{flag(s.day.comps ?? '-', (s.day.comps ?? 0) >= 3)}</td>
            <td>{s.day.rating === null || s.day.rating === 0 ? '-'
              : flag(n1(s.day.rating), s.day.rating > 0 && s.day.rating <= 2)}</td>
            <td>{s.day.wait === null ? '-' : flag(`${n1(s.day.wait)} min`, s.day.wait >= 3)}</td>
            <td>{flag(s.wk.fr ?? '-', (s.wk.fr ?? 0) >= 40)}</td>
            <td>{inr((s.wk.stockout ?? 0) + (s.wk.refunds ?? 0))}</td>
          </tr>
        ))}
      </tbody></table></div>
      <div className="scroll-x only-wk"><table className="sheet sortable">{head}<tbody>
        {wkRows.map(s => (
          <tr key={s.code} className={s.code === highlight ? 'me' : undefined}>
            <td>{s.wkRank ?? '-'}</td>
            <td className="name">{link(s)}</td>
            <td>{s.locality ?? ''}</td><td>{s.am ?? ''}</td>
            <td>{s.wk.orders ?? '-'}</td>
            <td>{s.wk.orders ? Math.round(s.wk.orders / 7) + '/day' : '-'}</td>
            <td>{flag(s.wk.online === null ? '-' : n1(s.wk.online), (s.wk.online ?? 100) < 99)}</td>
            <td>{flag(s.wk.srej ?? '-', (s.wk.srej ?? 0) >= 4)}</td>
            <td>{flag(s.wk.comps ?? '-', (s.wk.comps ?? 0) >= 20)}</td>
            <td>{s.wk.rating === null ? '-' : n1(s.wk.rating)}</td>
            <td>{s.wk.wait === null ? '-' : flag(`${n1(s.wk.wait)} min`, s.wk.wait >= 2.2)}</td>
            <td>{flag(s.wk.fr ?? '-', (s.wk.fr ?? 0) >= 40)}</td>
            <td>{inr((s.wk.stockout ?? 0) + (s.wk.refunds ?? 0))}</td>
          </tr>
        ))}
      </tbody></table></div>
      <p className="note">
        Ranked by clean-day score: complaints % + rejections % + offline penalty, lower is better
        (ties by rating, then orders). Rider wait and false-ready come from per-order timestamps and
        exist from August 2026 onward. The &#9650; marks values worth a question, not verdicts.
      </p>
    </>
  );
}

export function AreasTables({ areas, date }:
  { areas: import('@/lib/daily').AreaAgg[]; date: string; }) {
  const wkSorted = [...areas].sort((a, b) => (a.wk.cpct ?? 99) - (b.wk.cpct ?? 99));
  const head = (
    <thead><tr>
      <th>#</th><th>Area manager</th><th>Stores</th><th>Orders</th><th>Complaints %</th>
      <th>Store rejections</th><th>Offline</th><th>False-ready wk</th><th>Money lost wk</th>
    </tr></thead>
  );
  const row = (a: import('@/lib/daily').AreaAgg, i: number, v: 'day' | 'wk') => (
    <tr key={a.am}>
      <td>{i + 1}</td>
      <td className="name"><Link href={`/daily/area/${encodeURIComponent(a.am)}?date=${date}`}>{a.am}</Link></td>
      <td>{a.stores}</td>
      <td>{v === 'day' ? a.day.orders : a.wk.orders}</td>
      <td>{(v === 'day' ? a.day.cpct : a.wk.cpct)?.toFixed(2) ?? '-'}</td>
      <td>{v === 'day' ? a.day.srej : a.wk.srej}</td>
      <td>{(v === 'day' ? a.day.offmin : a.wk.offmin)} min</td>
      <td>{a.wk.fr}</td>
      <td>{inr(a.wk.stockout + a.wk.refunds)}</td>
    </tr>
  );
  return (
    <>
      <div className="scroll-x only-y"><table className="sheet sortable">{head}<tbody>
        {areas.map((a, i) => row(a, i, 'day'))}
      </tbody></table></div>
      <div className="scroll-x only-wk"><table className="sheet sortable">{head}<tbody>
        {wkSorted.map((a, i) => row(a, i, 'wk'))}
      </tbody></table></div>
      <p className="note">Ranked by complaint rate for the selected period. Money lost = stockout rejections + refunds for the 7 days.</p>
    </>
  );
}
