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
import { n0, n1, clockTime, isStoreMistake, reasonFamily,
  type SwiggyStoreRow, type SwiggyShortSeries } from '@/lib/daily';
import { Chart } from './ui';

export function AppTag({ app }: { app: 'Z' | 'S' }) {
  return <span className={`apptag app-${app.toLowerCase()}`}>{app}</span>;
}

// The turned-away reasons. Same two rules as the complaint tags: the tint
// names the failure (stock, shut, handover, tech) and a red left edge marks it
// as the store's. Both moved into lib/daily.ts on 18 Sep 2026 so the rejection
// reasons and the complaint tags are judged once and the store-mistake filter
// catches exactly what the edge shows.
// `store` is passed by the turned-away lists, where every row is store-caused
// before it reaches the page (migrations 225 and 213), so the tag is red even
// when Zomato sent no reason word at all: on 13 Sep 2026 two of the network's
// 55 rejections carried a null reason, and a keyword rule alone would have
// quietly dropped them out of the store-mistake filter.
export function FaultTag({ why, store }: { why: string; store?: boolean }) {
  const fault = store || isStoreMistake(why);
  return (
    <span className={`rchip r-${reasonFamily(why)}${fault ? ' is-fault' : ''}`}>{why}</span>
  );
}

// Both apps / Zomato only / Swiggy only. Filters rows carrying data-app in
// the table with id `target` (dash.js), cooperating with the tag filters.
export function AppFilter({ target, mistakes }: { target: string; mistakes?: boolean }) {
  return (
    <span className="rfilters" style={{ display: 'inline-flex' }}>
      <button className="rfilter appfilter on" data-target={target} data-app="" type="button">Both apps</button>
      <button className="rfilter appfilter" data-target={target} data-app="Z" type="button">Zomato only</button>
      <button className="rfilter appfilter" data-target={target} data-app="S" type="button">Swiggy only</button>
      {mistakes
        ? <button className="rfilter fault" data-target={target} data-mistake="1" type="button">Store mistakes only</button>
        : null}
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
  { id: string; cols: string[];
    rows: { app: 'Z' | 'S'; why?: string | null; mistake?: boolean; cells: React.ReactNode[] }[];
    empty?: string }) {
  if (!rows.length) return <p className="note">{empty ?? 'Nothing to list.'}</p>;
  // A row declares whether it is the store's own mistake, so the page-wide
  // switch and the per-list chip can filter it. `mistake` is the explicit
  // answer (the turned-away lists, which are store-caused by construction);
  // otherwise the reason text is read by the one shared rule.
  const bad = (r: { why?: string | null; mistake?: boolean }) =>
    r.mistake ?? (r.why != null ? isStoreMistake(r.why) : null);
  const anyWhy = rows.some(r => bad(r) !== null);
  return (
    <>
      <AppFilter target={id} mistakes={anyWhy} />
      <div className="scroll-x">
        <table id={id} className={anyWhy ? 'faultable' : undefined}>
          <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} data-app={r.app} data-mistake={bad(r) ? '1' : undefined}>
                {r.cells.map((c, j) => <td key={j}>{c}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
