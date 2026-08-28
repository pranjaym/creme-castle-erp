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
import { inr, n1, n0 } from '@/lib/daily';

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

export function AreasTables({ areas, date, view }:
  { areas: import('@/lib/daily').AreaAgg[]; date: string; view?: 'day' | 'wk' }) {
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
  // A page WITHOUT the day/week toggle asks for one view and labels it itself.
  if (view) {
    const rows = view === 'day' ? areas : wkSorted;
    return (
      <div className="scroll-x"><table className="sheet sortable">{head}<tbody>
        {rows.map((a, i) => row(a, i, view))}
      </tbody></table></div>
    );
  }
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
export function Chart({ series, labels, title, unit = '', lo, hi, width = 430, height = 116, tips }:
  { series: (number | null)[]; labels: string[]; title: string; unit?: string;
    lo?: number; hi?: number; width?: number; height?: number; tips?: string[] }) {
  const vals = series.filter((v): v is number => v !== null && v !== undefined);
  if (!vals.length) return <p className="note">No data for these days.</p>;
  let LO = lo ?? Math.min(...vals);
  let HI = hi ?? Math.max(...vals);
  if (HI === LO) HI = LO + 1;
  const W = width, H = height, L = 46, R = 26, T = 10, B = 24;
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
            <title>{`${(tips ?? labels)[i]}: ${v}${unit}`}</title>
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

// The customer's own words, where Zomato captured them. Truncated like a
// basket so the row stays one line, with the whole review on hover.
export function Words({ text }: { text?: string | null }) {
  if (!text) return <span className="muted">-</span>;
  const t = text.length <= 60 ? text : text.slice(0, 59) + '\u2026';
  return <span className="words" title={text}>&ldquo;{t}&rdquo;</span>;
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

// ---- area page components (approved design v2, 25 Aug 2026) ----

// Long item baskets are what made tables three lines tall. Cap them and put
// the full text on hover: the row stays one line and nothing is lost.
export function Basket({ text, n = 52 }: { text?: string | null; n?: number }) {
  const t = text ?? '-';
  if (t.length <= n) return <>{t}</>;
  return <span title={t}>{t.slice(0, n - 1)}&hellip;</span>;
}

// The compact store table: nine tight columns, worst-first, red only where a
// number deserves a question. Store names open the store page.
export function AreaStores({ stores, date }:
  { stores: import('@/lib/daily').StoreStats[]; date: string }) {
  const rows = [...stores].sort((a, b) => (a.dayRank ?? 99) - (b.dayRank ?? 99));
  const mark = (v: React.ReactNode, bad: boolean) => bad ? <span className="flag">{v}</span> : v;
  return (
    <div className="scroll-x">
      <table className="tight sortable">
        <thead><tr>
          <th>#</th><th>Store</th><th>Orders</th><th>vs avg</th><th>Online %</th>
          <th>Rej</th><th>Comp</th><th>Rating</th><th>Wait</th>
        </tr></thead>
        <tbody>
          {rows.map(s => {
            const d = s.day;
            const p = d.orders !== null && d.avgord ? Math.round(100 * (d.orders - d.avgord) / d.avgord) : null;
            return (
              <tr key={s.code}>
                <td>{s.dayRank ?? '-'}</td>
                <td className="name">
                  <Link href={`/daily/store/${encodeURIComponent(s.code)}?date=${date}`}>{s.code}</Link>
                </td>
                <td>{n0(d.orders)}</td>
                <td>{p === null ? '-' :
                  <span className={p >= 10 ? 'goodv' : p <= -15 ? 'flag' : ''}>{p >= 0 ? '+' : ''}{p}%</span>}</td>
                <td>{mark(d.online === null ? '-' : n1(d.online), (d.online ?? 100) < 99.9)}</td>
                <td>{mark(n0(d.srej), (d.srej ?? 0) > 0)}</td>
                <td>{mark(n0(d.comps), (d.comps ?? 0) >= 3)}</td>
                <td>{d.rating ? n1(d.rating) : '-'}</td>
                <td>{mark(d.wait === null ? '-' : n1(d.wait), (d.wait ?? 0) >= 2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// One card per outlet that dipped below 100% online, with its own 7-day line.
export function DipCard({ dip }: { dip: import('@/lib/daily').OnlineDip & { am?: string } }) {
  const labels = dip.series.map(p => p.d.slice(-2));
  const tips = dip.series.map(p =>
    new Date(p.d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));
  const lo = Math.min(90, ...dip.series.map(p => p.online)) - 1;
  return (
    <div className="minicard">
      <div className="mtitle">{dip.code}{dip.am ? <small> &middot; {dip.am}</small> : null}</div>
      <div className="mval">{n1(dip.online_day)}% <small>on the day</small></div>
      <div className="mnote">{n0(dip.offmin_day)} min offline that day · {n0(dip.offmin_wk)} min across the week</div>
      <Chart series={dip.series.map(p => p.online)} labels={labels} tips={tips}
        title="Online % per day (day of month)" unit="%" lo={lo} hi={100} width={270} height={88} />
    </div>
  );
}

// ---- central page components (approved design v1, 26 Aug 2026) ----

// The section lead: one sentence saying what the section is FOR, because a
// network page has eleven of them and the reader needs a reason to stop.
export function Lead({ children }: { children: React.ReactNode }) {
  return <p className="lead">{children}</p>;
}

// A KPI tile that always carries a verdict and its goal (locked rule 5).
export function VTile({ label, value, delta, ok, verdict }:
  { label: string; value: React.ReactNode; delta: React.ReactNode; ok: boolean; verdict: string }) {
  return (
    <div className="dtile">
      <div className="dlabel">{label}</div>
      <div className="dvalue">{value}</div>
      <div className="ddelta">{delta}</div>
      <span className={ok ? 'chip okc' : 'chip watch'}>{ok ? '✓ ' : '▲ '}{verdict}</span>
    </div>
  );
}

// The compact all-stores table. Same shape as the area page's, with an AM
// column, because at network level the next question after "which store" is
// always "whose store". Money lost comes from the central function, not from
// dash_all, so it uses the corrected rejection list.
export function CentralStores({ stores, date, money, view }:
  { stores: StoreStats[]; date: string; money: Map<string, number>; view: 'day' | 'wk' }) {
  const mark = (v: React.ReactNode, bad: boolean) => bad ? <span className="flag">{v}</span> : v;
  const link = (s: StoreStats) => (
    <Link href={`/daily/store/${encodeURIComponent(s.code)}?date=${date}`}>{s.code}</Link>
  );
  if (view === 'day') {
    const rows = [...stores].sort((a, b) => (a.dayRank ?? 99) - (b.dayRank ?? 99));
    return (
      <div className="scroll-x">
        <table className="tight sortable">
          <thead><tr>
            <th>#</th><th>Store</th><th>AM</th><th>Orders</th><th>vs avg</th><th>Online %</th>
            <th>Rej</th><th>Comp</th><th>Rating</th><th>Wait</th><th>False ready wk</th><th>Lost wk</th>
          </tr></thead>
          <tbody>
            {rows.map(s => {
              const d = s.day;
              const p = d.orders !== null && d.avgord ? Math.round(100 * (d.orders - d.avgord) / d.avgord) : null;
              return (
                <tr key={s.code}>
                  <td>{s.dayRank ?? '-'}</td>
                  <td className="name">{link(s)}</td>
                  <td>{s.am ?? ''}</td>
                  <td>{n0(d.orders)}</td>
                  <td>{p === null ? '-' :
                    <span className={p >= 10 ? 'goodv' : p <= -15 ? 'flag' : ''}>{p >= 0 ? '+' : ''}{p}%</span>}</td>
                  <td>{mark(d.online === null ? '-' : d.online.toFixed(2), (d.online ?? 100) < 99.9)}</td>
                  <td>{mark(n0(d.srej), (d.srej ?? 0) > 0)}</td>
                  <td>{mark(n0(d.comps), (d.comps ?? 0) >= 3)}</td>
                  <td>{d.rating ? n1(d.rating) : '-'}</td>
                  <td>{mark(d.wait === null ? '-' : n1(d.wait), (d.wait ?? 0) >= 2)}</td>
                  <td>{mark(n0(s.wk.fr), (s.wk.fr ?? 0) >= 40)}</td>
                  <td>{inr(money.get(s.code) ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }
  const rows = [...stores].sort((a, b) => (a.wkRank ?? 99) - (b.wkRank ?? 99));
  return (
    <div className="scroll-x">
      <table className="tight sortable">
        <thead><tr>
          <th>#</th><th>Store</th><th>AM</th><th>Orders</th><th>Per day</th><th>Online %</th>
          <th>Rej</th><th>Comp</th><th>Comp %</th><th>Rating</th><th>Wait</th><th>False ready</th><th>Lost</th>
        </tr></thead>
        <tbody>
          {rows.map(s => {
            const w = s.wk;
            const cp = w.orders ? (100 * (w.comps ?? 0)) / w.orders : null;
            return (
              <tr key={s.code}>
                <td>{s.wkRank ?? '-'}</td>
                <td className="name">{link(s)}</td>
                <td>{s.am ?? ''}</td>
                <td>{n0(w.orders)}</td>
                <td>{w.orders ? n0(w.orders / 7) : '-'}</td>
                <td>{mark(w.online === null ? '-' : w.online.toFixed(2), (w.online ?? 100) < 99.9)}</td>
                <td>{mark(n0(w.srej), (w.srej ?? 0) > 0)}</td>
                <td>{n0(w.comps)}</td>
                <td>{cp === null ? '-' : cp.toFixed(2)}</td>
                <td>{w.rating ? n1(w.rating) : '-'}</td>
                <td>{mark(w.wait === null ? '-' : n1(w.wait), (w.wait ?? 0) >= 2)}</td>
                <td>{mark(n0(w.fr), (w.fr ?? 0) >= 40)}</td>
                <td>{inr(money.get(s.code) ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Area versus area, as two labelled blocks rather than a hidden toggle.
export interface CentralArea {
  am: string; stores: number;
  d_orders: number; d_comps: number; d_cpct: number | null; d_srej: number; d_off: number; d_rating: number | null;
  w_orders: number; w_comps: number; w_cpct: number | null; w_srej: number; w_off: number;
  w_fr: number; w_money: number; w_wait: number | null;
}
export function CentralAreas({ areas, date, view, netCpct }:
  { areas: CentralArea[]; date: string; view: 'day' | 'wk'; netCpct: number | null }) {
  const mark = (v: React.ReactNode, bad: boolean) => bad ? <span className="flag">{v}</span> : v;
  const link = (a: CentralArea) => (
    <Link href={`/daily/area/${encodeURIComponent(a.am)}?date=${date}`}>{a.am}</Link>
  );
  const rows = [...areas].sort((a, b) =>
    ((view === 'day' ? a.d_cpct : a.w_cpct) ?? 99) - ((view === 'day' ? b.d_cpct : b.w_cpct) ?? 99));
  return (
    <div className="scroll-x">
      <table className="tight sortable">
        <thead><tr>
          <th>#</th><th>Area manager</th><th>Stores</th><th>Orders</th>
          {view === 'day' ? <th>Complaints</th> : null}
          <th>Complaints %</th><th>Rejections</th><th>Offline</th>
          {view === 'day' ? <th>Rating</th>
            : <><th>Rider wait</th><th>False ready</th><th>Money lost</th></>}
        </tr></thead>
        <tbody>
          {rows.map((a, i) => (
            <tr key={a.am}>
              <td>{i + 1}</td>
              <td className="name">{link(a)}</td>
              <td>{a.stores}</td>
              <td>{n0(view === 'day' ? a.d_orders : a.w_orders)}</td>
              {view === 'day' ? <td>{n0(a.d_comps)}</td> : null}
              <td>{mark((view === 'day' ? a.d_cpct : a.w_cpct)?.toFixed(2) ?? '-',
                ((view === 'day' ? a.d_cpct : a.w_cpct) ?? 0) > (netCpct ?? 0))}</td>
              <td>{mark(n0(view === 'day' ? a.d_srej : a.w_srej), (view === 'day' ? a.d_srej : a.w_srej) > 0)}</td>
              <td>{mark(`${n0(view === 'day' ? a.d_off : a.w_off)} min`, (view === 'day' ? a.d_off : a.w_off) > 0)}</td>
              {view === 'day' ? <td>{a.d_rating ? n1(a.d_rating) : '-'}</td>
                : <>
                    <td>{mark(n1(a.w_wait), (a.w_wait ?? 0) >= 1.5)}</td>
                    <td>{mark(n0(a.w_fr), a.w_fr > 0)}</td>
                    <td>{inr(a.w_money)}</td>
                  </>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// The funnel as three steps, not a KPI tile: it is a chain, and each link is
// a different lever.
export function Funnel({ impressions, opens, orders }:
  { impressions: number | null; opens: number | null; orders: number | null }) {
  const openPct = impressions ? (100 * (opens ?? 0)) / impressions : null;
  const convPct = opens ? (100 * (orders ?? 0)) / opens : null;
  return (
    <div className="minigrid funnel3">
      <div className="minicard"><div className="mtitle">Impressions</div>
        <div className="mval">{n0(impressions)}</div>
        <div className="mnote">the menu was shown this many times</div></div>
      <div className="minicard"><div className="mtitle">Menu opens</div>
        <div className="mval">{n0(opens)}</div>
        <div className="mnote">{openPct === null ? '-' : openPct.toFixed(2)}% of impressions: the listing
          itself is the first lever</div></div>
      <div className="minicard"><div className="mtitle">Orders</div>
        <div className="mval">{n0(orders)}</div>
        <div className="mnote">{n1(convPct)}% of menu opens: price, offer and rating decide here</div></div>
    </div>
  );
}

// ---- the shut-shop tracker (26 Aug 2026), shared by the central and area
// pages so the two can never drift apart. Pranjay's instruction: "the order
// should not be rejected because the restaurant was closed", so this is the
// one section on either page that is about a thing that should be zero.
import type { ShutBlock } from '@/lib/daily';

export function ShutShop({ block, dshort, wkLabel, showAm }:
  { block: ShutBlock; dshort: string; wkLabel: string; showAm: boolean }) {
  const { shut_orders: orders, shut_stores: stores, shut_hours: hours } = block;
  const total = orders.reduce((t, r) => t + (r.value ?? 0), 0);
  const today = orders.filter(r => r.today);
  // The proof line: if the listing never went offline that day, the tablet was
  // saying "open" while the shop could not serve.
  const listedOpen = orders.filter(r => (r.online_day ?? 0) >= 99).length;
  const peak = [...hours].sort((a, b) => b.orders - a.orders)[0];
  const worst = stores[0];

  if (!orders.length) {
    return (
      <div className="dcard"><Period label={wkLabel}>
        <p className="note">No order was turned away for a shut shop in these 7 days. This is the section that
          should stay empty.</p>
      </Period></div>
    );
  }
  const cols = showAm
    ? ['Store', 'AM', 'Day', 'Time', 'Reason', 'What the customer wanted', 'Value', 'Store online, whole day']
    : ['Store', 'Day', 'Time', 'Reason', 'What the customer wanted', 'Value', 'Store online, whole day'];
  const row = (r: import('@/lib/daily').ShutOrder) => {
    const online = r.online_day === null ? '-'
      : r.online_day >= 99.9 ? <span className="flag">{r.online_day.toFixed(2)}%, never off</span>
      : `${r.online_day.toFixed(2)}%, ${n0(r.offmin_day)} min off`;
    const cells: React.ReactNode[] = [r.code];
    if (showAm) cells.push(r.am);
    cells.push(r.dlabel, r.time, <Tag key="t" reason={r.reason} />,
      <Basket key="b" text={r.basket} />, inr(r.value), online);
    return cells;
  };

  return (
    <div className="dcard">
      <Period label={`${wkLabel}, every one of them`}>
        <p className="note" style={{ marginTop: 0 }}>
          <b>{orders.length} orders, {inr(total)}</b>, {today.length} of them on {dshort}.
          {' '}{listedOpen === orders.length
            ? 'Every one came to a store that was listed open all day.'
            : `${listedOpen} of the ${orders.length} came to a store that was listed open all day.`}
          {peak ? ` The busiest hour for it is ${peak.hour}:00, with ${peak.orders} of them.` : ''}
        </p>
        <Rows cols={cols} rows={orders.map(row)} />
        <p className="note">The last column is the store&apos;s online percentage for that whole day, from
          Zomato&apos;s own report. It is here as proof: Zomato only sends an order to a store whose listing it
          believes is open, so a store showing 100% online has been telling customers it is trading. The shop being
          shut, or nobody being at the tablet, is the thing to ask about.</p>
      </Period>

      <Period label="Which outlets, worst first">
        <Rows cols={showAm ? ['Store', 'AM', 'Orders turned away', 'Value', 'On how many days']
          : ['Store', 'Orders turned away', 'Value', 'On how many days']}
          rows={stores.map(s => {
            const cells: React.ReactNode[] = [s.code];
            if (showAm) cells.push(s.am);
            cells.push(<span key="o" className="flag">{n0(s.orders)}</span>, inr(s.value),
              s.days > 1 ? <span key="d" className="flag">{s.days} days</span> : `${s.days} day`);
            return cells;
          })} />
        {worst && worst.days > 1 ? (
          <p className="note"><b>{worst.code}</b> did it on {worst.days} separate days, which makes it a routine,
            not an accident. Start there.</p>
        ) : null}
      </Period>

      <Period label="At what time of day">
        <Rows cols={['Hour', 'Orders turned away', 'Value']}
          rows={hours.map(h => [`${h.hour}:00 to ${h.hour}:59`,
            <span key="o" className={h.orders >= 3 ? 'flag' : undefined}>{n0(h.orders)}</span>, inr(h.value)])} />
        <p className="note">The clock is usually the answer, and the answer is mostly the closing hour: our stores
          shut at 2am and Zomato keeps routing orders up to and past it. That is a listing-hours question to take
          to Zomato, not store indiscipline. Orders inside trading hours are the ones to ask the store about.</p>
      </Period>
    </div>
  );
}
