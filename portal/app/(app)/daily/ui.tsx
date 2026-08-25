// Shared building blocks for the daily dashboard pages (server components).
// The interactivity (view toggle, sorting, sparklines) is /dash.js.
import Script from 'next/script';
import Link from 'next/link';
import { dateLabel, shiftDate } from '@/lib/daily';

export function DashHead({ title, subtitle, date, latest, basePath, toggle }:
  { title: string; subtitle: string; date: string; latest: string; basePath: string; toggle?: boolean }) {
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
        {toggle ? (
          <span className="views" role="tablist" aria-label="Period">
            <button className="on" data-view="y" type="button">Day</button>
            <button data-view="wk" type="button">Last 7 days</button>
          </span>
        ) : null}
      </div>
      <p className="note">
        Settled data only: the newest selectable day is 2 days back because Zomato keeps revising fresher days.
        Each section shows the selected day first, then the 7 days ending on it.
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

// ---- v3 store page components (approved design, 25 Aug 2026) ----

// A chart with real axes: day labels along the bottom (edge labels anchored so
// nothing clips), value ticks with gridlines. Server-rendered, no client JS.
export function Chart({ series, labels, title, unit = '', lo, hi, width = 430 }:
  { series: (number | null)[]; labels: string[]; title: string; unit?: string;
    lo?: number; hi?: number; width?: number }) {
  const vals = series.filter((v): v is number => v !== null && v !== undefined);
  if (!vals.length) return <p className="note">No data for these days.</p>;
  let LO = lo ?? Math.min(...vals);
  let HI = hi ?? Math.max(...vals);
  if (HI === LO) HI = LO + 1;
  const W = width, H = 116, L = 46, R = 26, T = 10, B = 24;
  const n = series.length;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(n - 1, 1);
  const y = (v: number) => T + ((HI - v) * (H - T - B)) / (HI - LO);
  const ticks = [LO, (LO + HI) / 2, HI];
  const fmt = (v: number) => (Math.abs(HI - LO) >= 5 ? Math.round(v).toString() : v.toFixed(1)) + unit;
  const pts = series.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`))
    .filter(Boolean).join(' ');
  return (
    <div className="chart">
      <div className="charttitle">{title}</div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((tv, i) => (
          <g key={i}>
            <line x1={L} y1={y(tv)} x2={W - R} y2={y(tv)} stroke="#EDE3E5" strokeWidth="1" />
            <text x={L - 5} y={y(tv) + 3.5} fontSize="10.5" fill="#7E6B6E" textAnchor="end">{fmt(tv)}</text>
          </g>
        ))}
        {labels.map((la, i) => (
          <text key={i} x={x(i)} y={H - 7} fontSize="10" fill="#7E6B6E"
            textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{la}</text>
        ))}
        <polyline points={pts} fill="none" stroke="#DB5436" strokeWidth="2"
          strokeLinejoin="round" strokeLinecap="round" />
        {series.map((v, i) => v === null ? null : (
          <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="#DB5436" stroke="#fff" strokeWidth="1.5">
            <title>{`${labels[i]}: ${v}${unit}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

// A KPI verdict: never a bare number, always what it means and the goal.
export function Verdict({ ok, good, bad }: { ok: boolean; good: string; bad: string }) {
  return <span className={ok ? 'chip okc' : 'chip watch'}>{ok ? '✓ ' : '▲ '}{ok ? good : bad}</span>;
}

// Labelled period block: "Yesterday" then "Last 7 days", never a hidden toggle.
export function Period({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="pblock"><div className="ptitle">{label}</div>{children}</div>;
}

// Long week lists fold behind one tap-to-open line, so the page stays short.
export function Fold({ label, count, open, children }:
  { label: string; count: number; open?: boolean; children: React.ReactNode }) {
  if (!count) return <p className="note">None.</p>;
  return (
    <details className="fold" open={open}>
      <summary>{label} ({count}) &rsaquo; tap to {open ? 'close' : 'open'}</summary>
      {children}
    </details>
  );
}

export function Rows({ cols, rows, empty }:
  { cols: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="note">{empty ?? 'Nothing to list.'}</p>;
  return (
    <div className="scroll-x">
      <table>
        <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// Complaint reason tag, coloured by family. The tag text comes from the ORDER
// row, never from Zomato's daily report (the two use different words).
export function Tag({ reason }: { reason: string }) {
  const r = reason.toLowerCase();
  const cls = r.includes('packag') || r.includes('spill') ? 'packing'
    : r.includes('taste') || r.includes('quality') ? 'taste'
    : r.includes('missing') ? 'missing'
    : r.includes('wrong') ? 'wrong' : 'other';
  return <span className={`rchip r-${cls}`}>{reason}</span>;
}
