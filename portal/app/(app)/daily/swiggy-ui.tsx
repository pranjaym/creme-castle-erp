// Shared building blocks for the Swiggy half of the merged daily pages
// (approved 30 Aug 2026, erp-plan/swiggy-dashboard-plan.md and the three
// merged-*-template-v3.html files). Rules locked with Pranjay:
//   * every row is tagged Z or S;
//   * clear outlet mistakes (unavailable, stock, closed, not accepting,
//     unable to connect) read RED; other reasons stay neutral;
//   * Swiggy baskets always show quantities (they come from the billed
//     Petpooja order for cancellations, from the item sheet for ratings);
//   * section-1 tables keep the original columns with one Z/S toggle;
//   * merged lists carry Both apps / Zomato only / Swiggy only filters.
import Link from 'next/link';
import { n0, n1, clockTime, type SwiggyStoreRow, type SwiggyShortSeries } from '@/lib/daily';
import { Chart } from './ui';

export function AppTag({ app }: { app: 'Z' | 'S' }) {
  return <span className={`apptag app-${app.toLowerCase()}`}>{app}</span>;
}

// Red for the reasons that are unambiguously the store's doing.
export function FaultTag({ why }: { why: string }) {
  const w = why.toLowerCase();
  const bad = ['unavailable', 'stock', 'closed', 'not accepting', 'unable to connect']
    .some(k => w.includes(k));
  return <span className={`rchip ${bad ? 'r-packing' : 'r-other'}`}>{why}</span>;
}

// Both apps / Zomato only / Swiggy only. Filters rows carrying data-app in
// the table with id `target` (dash.js), cooperating with the tag filters.
export function AppFilter({ target }: { target: string }) {
  return (
    <span className="rfilters" style={{ display: 'inline-flex' }}>
      <button className="rfilter appfilter on" data-target={target} data-app="" type="button">Both apps</button>
      <button className="rfilter appfilter" data-target={target} data-app="Z" type="button">Zomato only</button>
      <button className="rfilter appfilter" data-target={target} data-app="S" type="button">Swiggy only</button>
    </span>
  );
}

// The two tab buttons over a section-1 table pair.
export function AppTabs({ group }: { group: string }) {
  return (
    <div className="rfilters">
      <button className="rfilter s1tab on" data-group={group} data-view="z" type="button">
        <span className="apptag app-z">Z</span>Zomato</button>
      <button className="rfilter s1tab" data-group={group} data-view="s" type="button">
        <span className="apptag app-s">S</span>Swiggy</button>
    </div>
  );
}

const mark = (v: React.ReactNode, bad: boolean) => bad ? <span className="flag">{v}</span> : v;

function vsAvgS(r: SwiggyStoreRow): React.ReactNode {
  const avg = (r.orders_wk ?? 0) / 7;
  if (!avg || r.orders === null) return '-';
  const p = Math.round((100 * (r.orders - avg)) / avg);
  return <span className={p >= 10 ? 'goodv' : p <= -15 ? 'flag' : ''}>{p >= 0 ? '+' : ''}{p}%</span>;
}

// The Swiggy tab of the section-1 store table: the original columns
// mirrored one for one (Open % for Online %, Canc for Rej, 1-2 star for
// Comp), Wait empty because Swiggy publishes no timing. # is the store's
// rank in the Swiggy league (cancellations + 1-2 star + hours offline).
export function SwiggyStoresTable({ rows, date, showAm }:
  { rows: SwiggyStoreRow[]; date: string; showAm?: boolean }) {
  const sorted = [...rows].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  return (
    <div className="scroll-x">
      <table className="tight sortable">
        <thead><tr>
          <th>#</th><th>Store</th>{showAm ? <th>AM</th> : null}<th>Orders</th><th>vs avg</th>
          <th>Open %</th><th>Canc</th><th>1-2&#9733;</th><th>Rating</th><th>Wait</th>
        </tr></thead>
        <tbody>
          {sorted.map(r => (
            <tr key={r.code}>
              <td>{r.rank ?? '-'}</td>
              <td className="name">
                <Link href={`/daily/store/${encodeURIComponent(r.code)}?date=${date}`}>{r.code}</Link>
              </td>
              {showAm ? <td>{r.am ?? ''}</td> : null}
              <td>{n0(r.orders)}</td>
              <td>{vsAvgS(r)}</td>
              <td>{mark(r.open_pct === null ? '-' : n1(r.open_pct), (r.open_pct ?? 100) < 100)}</td>
              <td>{mark(n0(r.canc), r.canc >= 1)}</td>
              <td>{mark(n0(r.low), r.low >= 1)}</td>
              <td>{r.rating === null ? '-' : n1(r.rating)}</td>
              <td>-</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One card per store with Swiggy hours missing, mirroring DipCard.
export function ShortCard({ s }: { s: SwiggyShortSeries }) {
  const labels = s.series.map(p => p.d.slice(-2));
  const tips = s.series.map(p =>
    new Date(p.d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));
  return (
    <div className="minicard">
      <div className="mtitle"><AppTag app="S" />{s.code}{s.am ? <small> &middot; {s.am}</small> : null}</div>
      <div className="mval">{n1(s.wk_short)} <small>hrs short this week</small></div>
      <Chart series={s.series.map(p => p.short)} labels={labels} tips={tips}
        title="Hours not open per day (day of month)" unit="" lo={0} width={270} height={88} />
    </div>
  );
}

// A merged cancellation/rejection row's time cell for Swiggy rows.
export const sTime = clockTime;

// A merged list with its own Both apps / Zomato only / Swiggy only buttons.
// Each row declares which app it came from; dash.js drives the filtering.
export function AppRows({ id, cols, rows, empty }:
  { id: string; cols: string[]; rows: { app: 'Z' | 'S'; cells: React.ReactNode[] }[]; empty?: string }) {
  if (!rows.length) return <p className="note">{empty ?? 'Nothing to list.'}</p>;
  return (
    <>
      <AppFilter target={id} />
      <div className="scroll-x">
        <table id={id}>
          <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} data-app={r.app}>{r.cells.map((c, j) => <td key={j}>{c}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
