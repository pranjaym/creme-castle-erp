'use client';
// The inventory screens (packaging). Design approved by Pranjay on the
// prototype of 10 Nov 2026 (erp-plan/inventory-module-plan.md):
//   * one window for everyone, no per-role home;
//   * status words that explain themselves, with the meaning on screen;
//   * a tile says what its number SHOULD be ("Should be 0"), never "over target";
//   * every table sorts on any column and has real filters;
//   * every item shows its open POs, and POs past the cut-off are never counted.
// All arithmetic lives in lib/inventory-engine.ts; this file only shows it.
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import {
  STATUS_LABEL, STATUS_ORDER, statusMeaning, project, addDays, isFinished, needsAction,
  type Computed, type Item, type Po, type Status,
} from '@/lib/inventory-engine';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const num = (x: number | null | undefined, d = 0) => x == null ? '' : Number(x).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const qty = (x: number) => num(x, x % 1 ? 2 : 0);
const dt = (s: string) => { const [y, m, d] = s.split('-'); return `${Number(d)} ${MON[Number(m) - 1]} ${y}`; };
const dm = (s: string) => { const [, m, d] = s.split('-'); return `${Number(d)} ${MON[Number(m) - 1]}`; };
const lakh = (x: number) => `Rs ${(x / 100000).toFixed(1)} lakh`;
const unit = (u: string) => u === 'piece' ? 'pcs' : u;
const PILL: Record<Status, string> = { OUT: 'inv-p-out', OUT_PO: 'inv-p-out', ORDER: 'inv-p-order', CHASE: 'inv-p-chase', OK: 'inv-p-ok', IDLE: 'inv-p-idle' };
const FILL: Record<Status, string> = { OUT: '#C0392B', OUT_PO: '#C0392B', ORDER: '#D98A1F', CHASE: '#B86A7C', OK: '#3E8E41', IDLE: '#B9AEB0' };
const openVal = (a: Po[]) => a.reduce((t, p) => t + p.open * p.price, 0);

export function Pill({ s, days }: { s: Status; days: number }) {
  return <span className={`inv-pill ${PILL[s]}`} title={statusMeaning(s, days)}>{STATUS_LABEL[s]}</span>;
}
function Tags({ i, days }: { i: Item; days: number }) {
  return <>
    {i.rough && <span className="inv-tag" title={`Sent out on fewer than 3 days in ${days}. The daily figure is rough and the kitchen may still hold stock.`}>rough</span>}
    {i.negative && <span className="inv-tag" title="SupplyNote shows less than zero: a delivery is not entered yet">below zero</span>}
  </>;
}
const itemHref = (i: { sku: string }) => `/inventory/items?item=${encodeURIComponent(i.sku)}`;
function ItemCell({ i, days }: { i: Item; days: number }) {
  return <><Link className="inv-lk" href={itemHref(i)}>{i.title}</Link><Tags i={i} days={days} /><div className="inv-sku">{i.sku}</div></>;
}
function runText(i: Item, today: string, horizon: number): string {
  if (!(i.use > 0)) return '';
  if (i.stock <= 0) return 'finished';
  return i.run == null ? `after ${dm(addDays(today, horizon))}` : dm(addDays(today, i.run));
}
const runSort = (i: Item) => !(i.use > 0) ? null : i.stock <= 0 ? -1 : i.run == null ? 999 : i.run;

// ---------- a table that sorts on any column ----------
export interface Col<T> { k: string; l: string; n?: boolean; tip?: string; v: (r: T) => string | number | null | undefined; c: (r: T) => ReactNode; cls?: (r: T) => string; }
export function SortTable<T>({ cols, rows, rowKey, limit = 150, expand, openKey, onRow }: {
  cols: Col<T>[]; rows: T[]; rowKey: (r: T) => string; limit?: number;
  expand?: (r: T) => ReactNode; openKey?: string | null; onRow?: (k: string) => void;
}) {
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 } | null>(null);
  const [all, setAll] = useState(false);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = cols.find((c) => c.k === sort.k); if (!col) return rows;
    return [...rows].sort((x, y) => {
      const p = col.v(x), q = col.v(y); const pn = p == null || p === '', qn = q == null || q === '';
      if (pn && qn) return 0; if (pn) return 1; if (qn) return -1;
      return (typeof p === 'number' && typeof q === 'number' ? p - q : String(p).localeCompare(String(q))) * sort.dir;
    });
  }, [rows, sort, cols]);
  const shown = all || sorted.length <= limit ? sorted : sorted.slice(0, limit);
  const click = (k: string) => setSort((s) => s && s.k === k ? (s.dir === 1 ? { k, dir: -1 } : null) : { k, dir: 1 });
  return <>
    <div className="inv-scroll"><table className="inv-table">
      <thead><tr>{cols.map((c) => <th key={c.k} className={c.n ? 'n' : ''} title={c.tip ?? 'Click to sort'} onClick={() => click(c.k)}>{c.l}<span className="ar">{sort?.k === c.k ? (sort.dir === 1 ? '▲' : '▼') : ''}</span></th>)}</tr></thead>
      <tbody>
        {shown.length === 0 && <tr><td colSpan={cols.length} className="muted">Nothing here.</td></tr>}
        {shown.map((r) => { const k = rowKey(r); return [
          <tr key={k} className={onRow ? 'inv-row' : ''} onClick={onRow ? () => onRow(k) : undefined}>{cols.map((c) => <td key={c.k} className={`${c.n ? 'n' : ''} ${c.cls ? c.cls(r) : ''}`}>{c.c(r)}</td>)}</tr>,
          expand && openKey === k ? <tr key={k + ':d'} className="inv-detail"><td colSpan={cols.length}>{expand(r)}</td></tr> : null,
        ]; })}
      </tbody>
    </table></div>
    {shown.length < sorted.length && <div className="inv-more">Showing {shown.length} of {sorted.length}. <a className="inv-lk" onClick={() => setAll(true)}>Show all</a></div>}
  </>;
}

function download(name: string, rows: (string | number | null)[][]) {
  const t = rows.map((r) => r.map((c) => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = name; a.click();
}

// ---------- the graph: 28 days of stock, then the projection ----------
function Chart({ i, d }: { i: Item; d: Computed }) {
  const S = d.settings; const nh = S.usage_days; const H = S.horizon_days;
  const pj = useMemo(() => project(i.stock, i.use, i.pos, H), [i, H]);
  const hist = [...(i.hist ?? Array(nh).fill(Math.max(i.stock, 0))), Math.max(i.stock, 0)];
  const [hover, setHover] = useState<number | null>(null);
  const W = 760, Ht = 250, m = { l: 56, r: 14, t: 12, b: 26 };
  const ymax = Math.max(1, ...hist, ...pj.withPos, ...pj.alone) * 1.08;
  const X = (x: number) => m.l + (x + nh) / (H + nh) * (W - m.l - m.r);
  const Y = (v: number) => Ht - m.b - (Math.max(v, 0) / ymax) * (Ht - m.t - m.b);
  const path = (a: number[], off: number) => a.map((v, k) => `${k ? 'L' : 'M'}${X(k + off).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const step = Math.pow(10, Math.floor(Math.log10(ymax))); const tk = ymax / step < 2 ? step / 4 : ymax / step < 5 ? step / 2 : step;
  const ticks: number[] = []; for (let v = 0; v <= ymax; v += tk) ticks.push(v);
  const xl: number[] = []; for (let x = -28; x <= H; x += 14) if (x >= -nh) xl.push(x);
  const move = (e: React.MouseEvent<SVGRectElement>) => {
    const b = e.currentTarget.ownerSVGElement!.getBoundingClientRect(); const sx = (e.clientX - b.left) / b.width * W;
    setHover(Math.max(-nh, Math.min(H, Math.round(-nh + (sx - m.l) / (W - m.l - m.r) * (H + nh)))));
  };
  return <div className="inv-chart">
    <div className="inv-legend"><span><i style={{ borderColor: '#3C0618' }} />Stock, last {nh} days</span><span><i style={{ borderColor: '#DB5436' }} />Projected, with open POs</span><span><i style={{ borderColor: '#1F8FA8', borderTopStyle: 'dashed' }} />Projected, stock alone</span><span>▲ PO due</span><span>○ finishes</span></div>
    <svg viewBox={`0 0 ${W} ${Ht}`} role="img" aria-label={`Stock history and projection for ${i.title}`}>
      {ticks.map((v) => <g key={v}><line x1={m.l} x2={W - m.r} y1={Y(v)} y2={Y(v)} stroke="#EDE3E5" /><text x={m.l - 6} y={Y(v) + 4} textAnchor="end" fontSize="11" fill="#7E6B6E">{num(v, tk < 1 ? 2 : 0)}</text></g>)}
      {xl.map((x) => <text key={x} x={X(x)} y={Ht - 8} textAnchor="middle" fontSize="11" fill="#7E6B6E">{x === 0 ? 'Today' : dm(addDays(d.today, x))}</text>)}
      <line x1={X(0)} x2={X(0)} y1={m.t} y2={Ht - m.b} stroke="#7E6B6E" strokeDasharray="3 3" />
      <path d={path(pj.alone, 0)} fill="none" stroke="#1F8FA8" strokeWidth="2" strokeDasharray="5 4" />
      <path d={path(pj.withPos, 0)} fill="none" stroke="#DB5436" strokeWidth="2" />
      <path d={path(hist, -nh)} fill="none" stroke="#3C0618" strokeWidth="2" />
      {i.pos.filter((p) => p.bucket !== 'stale').map((p, k) => { const x = X(Math.max(0, -p.late)); return <path key={k} d={`M${x - 5} ${Ht - m.b} L${x + 5} ${Ht - m.b} L${x} ${Ht - m.b - 9}Z`} fill="#DB5436"><title>{`${p.po}: ${qty(p.open)} due ${dt(p.due)}${p.late > 0 ? ' (late, assumed today)' : ''}`}</title></path>; })}
      {pj.run != null && pj.run > 0 && <circle cx={X(pj.run)} cy={Y(0)} r="5" fill="#fff" stroke="#872724" strokeWidth="2"><title>{`Finishes ${dm(addDays(d.today, pj.run))}`}</title></circle>}
      {hover != null && <line x1={X(hover)} x2={X(hover)} y1={m.t} y2={Ht - m.b} stroke="#2A1A1D" strokeWidth="1" />}
      <rect x={m.l} y={m.t} width={W - m.l - m.r} height={Ht - m.t - m.b} fill="transparent" onMouseMove={move} onMouseLeave={() => setHover(null)} />
    </svg>
    {hover != null && <div className="inv-tip" style={{ left: `min(${(X(hover) / W) * 100}% + 12px, 100% - 160px)` }}>
      {hover < 0 ? <><b>{dm(addDays(d.today, hover))}</b><br />Stock at close: {qty(hist[hover + nh])}</> : <><b>{hover === 0 ? 'Today' : dm(addDays(d.today, hover))}</b><br />With POs: {num(pj.withPos[hover])}<br />Stock alone: {num(pj.alone[hover])}</>}
    </div>}
  </div>;
}

function PoList({ pos, cut }: { pos: Po[]; cut: number }) {
  if (!pos.length) return <div className="muted">None.</div>;
  return <div className="inv-scroll"><table className="inv-table inv-inner"><thead><tr><th>PO</th><th>Vendor</th><th>Due</th><th className="n">Days late</th><th className="n">Ordered</th><th className="n">Received</th><th className="n">Still open</th><th>Counted as coming?</th></tr></thead>
    <tbody>{pos.map((p, k) => <tr key={k}><td>{p.po}</td><td>{p.vendor}</td><td>{dt(p.due)}</td><td className="n">{p.late > 0 ? p.late : 'not yet due'}</td><td className="n">{qty(p.ordered)}</td><td className="n">{qty(p.received)}</td><td className="n">{qty(p.open)}</td>
      <td>{p.bucket === 'stale' ? <span className="inv-bad">No, more than {cut} days late: confirm or close</span> : p.bucket === 'late' ? 'Yes, but late: chase' : 'Yes'}</td></tr>)}</tbody></table></div>;
}

function Detail({ i, d }: { i: Item; d: Computed }) {
  const S = d.settings; const u = unit(i.unit); const s0 = Math.max(i.stock, 0);
  const lead = i.leadSrc === 'item' ? 'set for this item' : i.leadSrc === 'vendor' ? "the vendor's usual figure from the August lead time sheet" : i.leadSrc === 'gap' ? 'estimated from how often it is delivered' : 'none on record, default used';
  return <>
    <Chart i={i} d={d} />
    <h3>How this was worked out</h3>
    <ul className="inv-calc">
      <li><b>{STATUS_LABEL[i.status]}.</b> {statusMeaning(i.status, S.usage_days)}</li>
      <li>Stock in SupplyNote: <b>{qty(i.stock)} {u}</b>{i.negative ? ' (below zero: a delivery is probably not entered yet)' : ''}, worth Rs {num(i.value)} at the average price</li>
      {i.use > 0 ? <>
        <li>Sent out from the warehouse over the last {S.usage_days} days: {qty(i.outWindow)} {u} over {i.useDays} days = <b>{num(i.use, 1)} a day</b> (moved on {i.daysMoved} of those days; last 7 days: {qty(i.out7)})</li>
        <li>Days in hand = {qty(s0)} / {num(i.use, 1)} = <b>{num(i.dih, 1)} days</b></li>
        <li>On order, on POs not more than {S.past_due_cutoff_days} days late: {qty(i.onOrder)} {u}. Days of cover with POs = <b>{num(i.cover, 1)} days</b></li>
        <li>Days needed = lead time {i.lead} days ({lead}; an estimate) + {i.buffer} days buffer = <b>{i.need} days</b></li>
        {i.suggest > 0 && <li>Suggested order = {num(i.use, 1)} a day x ({i.need} + {S.order_cover_days} days) - stock - on order = <b>{num(i.suggest)} {u}</b>, about Rs {num(i.suggest * i.price)}</li>}
      </> : <li>Nothing sent out from the warehouse in the last {S.usage_days} days.{i.lastOut ? ` Last sent out ${dt(i.lastOut)}.` : ''}</li>}
      {i.stale > 0 && <li><span className="inv-bad">Not counted: {qty(i.stale)} {u} on POs more than {S.past_due_cutoff_days} days past due.</span></li>}
    </ul>
    <h3>Purchase orders with quantity still open</h3>
    <PoList pos={i.pos} cut={S.past_due_cutoff_days} />
  </>;
}

// ---------- tiles ----------
function Tile({ label, n, u, target, sub, href }: { label: string; n: number; u: string; target?: number; sub: string; href: string }) {
  const has = target != null; const ok = has && n <= target!;
  return <Link href={href} className={`inv-tile ${has ? (ok ? 'good' : 'bad') : 'info'}`}>
    {has && <span className={`tgt ${ok ? 'met' : 'unmet'}`} title={`This number should be ${target}. Today it is ${n}.`}>Should be {target}{ok ? ' ✓' : ''}</span>}
    <div className="l">{label}</div><div className="v">{num(n)}<span className="u">{u}</span></div><div className="s">{sub}</div>
  </Link>;
}

// ---------- Home ----------
export function HomeView({ d }: { d: Computed }) {
  const S = d.settings; const R = d.items;
  const pol = R.flatMap((i) => i.pos.map((p) => ({ ...p, item: i })));
  const late = pol.filter((p) => p.bucket === 'late'), stale = pol.filter((p) => p.bucket === 'stale');
  const soon = pol.filter((p) => p.bucket === 'late' || (p.bucket === 'due' && p.late >= -1)).sort((a, b) => b.late - a.late);
  const toOrder = R.filter((i) => i.suggest > 0);
  const dead = R.filter((i) => i.status === 'IDLE' && i.value > 0);
  const sv = R.reduce((t, i) => t + i.value, 0), dv = dead.reduce((t, i) => t + i.value, 0);
  const vend = useMemo(() => { const m = new Map<string, { v: string; n: number; val: number }>(); for (const i of toOrder) { const v = i.vendor ?? 'No vendor on record'; const o = m.get(v) ?? { v, n: 0, val: 0 }; o.n++; o.val += i.suggest * i.price; m.set(v, o); } return [...m.values()].sort((a, b) => b.val - a.val); }, [toOrder]);
  const types = useMemo(() => { const m = new Map<string, { t: string; n: number; fin: number; ord: number; low: number; val: number }>(); for (const i of R) { const o = m.get(i.type) ?? { t: i.type, n: 0, fin: 0, ord: 0, low: 0, val: 0 }; o.n++; if (isFinished(i)) o.fin++; if (i.status === 'ORDER') o.ord++; if (i.status === 'CHASE') o.low++; o.val += i.value; m.set(i.type, o); } return [...m.values()].sort((a, b) => b.n - a.n); }, [R]);
  const bk: [string, number][] = [['Finished', R.filter(isFinished).length], ['1 to 7 days', 0], ['8 to 14 days', 0], ['15 to 30 days', 0], ['31 to 60 days', 0], ['Over 60 days', 0], ['Not used lately', R.filter((i) => i.status === 'IDLE').length]];
  for (const i of R) if (!isFinished(i) && i.dih != null) bk[i.dih <= 7 ? 1 : i.dih <= 14 ? 2 : i.dih <= 30 ? 3 : i.dih <= 60 ? 4 : 5][1]++;
  const mx = Math.max(1, ...bk.map((b) => b[1]));
  const urgent = R.filter((i) => needsAction(i) && !i.rough);
  return <>
    <div className="inv-tiles">
      <Tile label="Finished at the warehouse" n={R.filter(isFinished).length} u="items" target={0} sub={`Zero stock today. ${R.filter((i) => i.status === 'OUT').length} of them have nothing on order.`} href="/inventory/items?g=fin" />
      <Tile label="Not finished yet, but order now" n={R.filter((i) => i.status === 'ORDER').length} u="items" target={0} sub="Stock will finish before a new order can arrive." href="/inventory/items?g=ORDER" />
      <Tile label="Late deliveries to chase" n={late.length} u="PO lines" target={0} sub={`1 to ${S.past_due_cutoff_days} days past the due date.`} href="/inventory/pos?b=late" />
      <Tile label="Old POs nobody closed" n={stale.length} u="PO lines" target={0} sub={`${lakh(openVal(stale))}, more than ${S.past_due_cutoff_days} days past due. Not counted as coming.`} href="/inventory/pos?b=stale" />
    </div>
    <div className="inv-grid2">
      <div className="card"><h2>Most urgent, in regular use</h2><p className="inv-sub">Used on 3 or more days in the last {S.usage_days}. Click an item for its graph.</p>
        <SortTable rows={urgent} rowKey={(i) => i.sku} limit={8} cols={[
          { k: 't', l: 'Item', v: (i) => i.title, c: (i) => <ItemCell i={i} days={S.usage_days} /> },
          { k: 's', l: 'Status', v: (i) => STATUS_ORDER[i.status], c: (i) => <Pill s={i.status} days={S.usage_days} /> },
          { k: 'd', l: 'Days in hand', n: true, v: (i) => i.dih, c: (i) => num(i.dih, 1) },
          { k: 'r', l: 'Finishes', v: runSort, c: (i) => runText(i, d.today, S.horizon_days) }]} /></div>
      <div className="card"><h2>Orders to raise, by vendor</h2><p className="inv-sub">{toOrder.length} items, about {lakh(toOrder.reduce((t, i) => t + i.suggest * i.price, 0))}. Click a vendor for its items and quantities.</p>
        <SortTable rows={vend} rowKey={(o) => o.v} limit={8} cols={[
          { k: 'v', l: 'Vendor', v: (o) => o.v, c: (o) => <Link className="inv-lk" href={`/inventory/orders?vendor=${encodeURIComponent(o.v)}`}>{o.v}</Link> },
          { k: 'n', l: 'Items', n: true, v: (o) => o.n, c: (o) => o.n },
          { k: 'val', l: 'About (Rs)', n: true, v: (o) => o.val, c: (o) => num(o.val) }]} /></div>
    </div>
    <div className="inv-grid2">
      <div className="card"><h2>By type of packaging</h2><p className="inv-sub">Click a type to see its items.</p>
        <SortTable rows={types} rowKey={(o) => o.t} cols={[
          { k: 't', l: 'Type', v: (o) => o.t, c: (o) => <Link className="inv-lk" href={`/inventory/items?g=all&type=${encodeURIComponent(o.t)}`}>{o.t}</Link> },
          { k: 'n', l: 'Items', n: true, v: (o) => o.n, c: (o) => o.n },
          { k: 'f', l: 'Finished', n: true, v: (o) => o.fin, c: (o) => o.fin || '', cls: (o) => o.fin ? 'inv-bad' : '' },
          { k: 'o', l: 'Order now', n: true, v: (o) => o.ord, c: (o) => o.ord || '' },
          { k: 'l', l: 'Low, awaited', n: true, v: (o) => o.low, c: (o) => o.low || '' },
          { k: 'v', l: 'Stock value (Rs)', n: true, v: (o) => o.val, c: (o) => num(o.val) }]} /></div>
      <div>
        <div className="card"><h2>Arriving today and tomorrow</h2><p className="inv-sub">{soon.length} deliveries expected. Each one is entered in SupplyNote the moment it arrives.</p>
          <ul className="inv-list">{soon.length === 0 && <li>Nothing due.</li>}{soon.slice(0, 12).map((p, k) => <li key={k}><span><b>{p.item.title}</b><br /><span className="inv-sku">{p.vendor}, {p.po}</span></span><span className="r">{qty(p.open)} {unit(p.item.unit)}<br />{p.late > 0 ? <span className="inv-bad">{p.late} days late</span> : p.late === 0 ? 'due today' : 'due tomorrow'}</span></li>)}</ul></div>
        <div className="card"><h2>How long will the stock last?</h2><p className="inv-sub">{R.length} items by days of stock in hand (stock alone, before any PO). {lakh(dv)} of {lakh(sv)} has not moved in {S.usage_days} days.</p>
          <div className="inv-bars">{bk.map((b) => <div className="inv-bar" key={b[0]} title={`${b[1]} items: ${b[0]}`}><span>{b[0]}</span><span><i style={{ width: `${Math.max(1, b[1] / mx * 100)}%` }} /></span><span className="n">{b[1]}</span></div>)}</div></div>
      </div>
    </div>
  </>;
}

// ---------- Projection ----------
type Group = 'act' | 'fin' | 'all' | Status;
export function ItemsView({ d, g0, type0, item0 }: { d: Computed; g0?: string; type0?: string; item0?: string }) {
  const S = d.settings; const R = d.items;
  const [g, setG] = useState<Group>((item0 ? 'all' : (g0 as Group)) || 'act');
  const [q, setQ] = useState(item0 ?? ''); const [ty, setTy] = useState(type0 ?? ''); const [ve, setVe] = useState('');
  const [open, setOpen] = useState<string | null>(item0 ?? null);
  const cnt = (s: Status) => R.filter((i) => i.status === s).length;
  const chips: [Group, string, number, string][] = [['act', 'Needs action', R.filter(needsAction).length, 'Everything that needs someone to do something today: finished, order now, or delivery awaited.'],
    ...(['OUT', 'OUT_PO', 'ORDER', 'CHASE', 'OK', 'IDLE'] as Status[]).filter((s) => cnt(s) > 0).map((s) => [s, STATUS_LABEL[s], cnt(s), statusMeaning(s, S.usage_days)] as [Group, string, number, string]),
    ['all', 'All items', R.length, 'Every item, whatever its status.']];
  const cur = chips.find((c) => c[0] === g) ?? ['fin', 'Finished', R.filter(isFinished).length, 'None left at the warehouse today, whether or not an order is on the way.'] as [Group, string, number, string];
  const types = [...new Set(R.map((i) => i.type))].sort(); const vendors = [...new Set(R.map((i) => i.vendor ?? 'No vendor on record'))].sort();
  const rows = useMemo(() => R.filter((i) => (g === 'all' || (g === 'act' ? needsAction(i) : g === 'fin' ? isFinished(i) : i.status === g))
    && (!ty || i.type === ty) && (!ve || (i.vendor ?? 'No vendor on record') === ve)
    && (!q || `${i.title} ${i.sku} ${i.vendor ?? ''}`.toLowerCase().includes(q.toLowerCase()))), [R, g, ty, ve, q]);
  const cols: Col<Item>[] = [
    { k: 's', l: 'Status', v: (i) => STATUS_ORDER[i.status], c: (i) => <Pill s={i.status} days={S.usage_days} /> },
    { k: 't', l: 'Item', v: (i) => i.title, c: (i) => <><span className="inv-item">{i.title}</span><Tags i={i} days={S.usage_days} /><div className="inv-sku">{i.sku}</div></> },
    { k: 'ty', l: 'Type', v: (i) => i.type, c: (i) => <>{i.type}{i.doubt && <span className="inv-tag" title="Type to be confirmed by Pranjay">?</span>}</> },
    { k: 'v', l: 'Vendor', tip: 'Vendor on the latest purchase order. Click to sort', v: (i) => i.vendor ?? '', c: (i) => i.vendor ?? 'No vendor on record' },
    { k: 'st', l: 'Stock', n: true, v: (i) => i.stock, c: (i) => <>{qty(i.stock)} <span className="inv-sku">{unit(i.unit)}</span></>, cls: (i) => i.negative ? 'inv-bad' : '' },
    { k: 'u', l: 'Used a day', n: true, v: (i) => i.use || null, c: (i) => i.use > 0 ? num(i.use, 1) : '' },
    { k: 'd', l: 'Days in hand', n: true, tip: 'Stock divided by used a day. The black mark is the days needed. Click to sort', v: (i) => i.dih, c: (i) => i.dih == null ? '' : <span className="inv-cov" title={`${num(i.dih, 1)} days in hand against ${i.need} days needed (the black mark)`}>{num(i.dih, 1)}<span className="trk"><span className="fl" style={{ width: `${Math.min(1, i.dih / (i.need * 2)) * 100}%`, background: FILL[i.status] }} /><span className="nd" /></span></span> },
    { k: 'r', l: 'Finishes', v: runSort, c: (i) => runText(i, d.today, S.horizon_days) },
    { k: 'c', l: 'On order', n: true, tip: `Quantity still open on POs not more than ${S.past_due_cutoff_days} days late`, v: (i) => i.onOrder || null, c: (i) => i.onOrder ? qty(i.onOrder) : '' },
    { k: 'n', l: 'Days needed', n: true, tip: 'Lead time plus buffer', v: (i) => i.use > 0 ? i.need : null, c: (i) => i.use > 0 ? i.need : '' },
    { k: 'p', l: 'Old POs, not counted', n: true, v: (i) => i.stale || null, c: (i) => i.stale ? qty(i.stale) : '', cls: (i) => i.stale ? 'inv-bad' : '' }];
  const csv = () => download(`inventory-packaging-items-${d.today}.csv`, [['Status', 'SKU', 'Item', 'Type', 'Vendor', 'Unit', 'Stock', 'Stock value Rs', 'Used a day', 'Days in hand', 'Finishes', 'On order', 'Days needed', 'Old PO qty not counted', `Moved on days of ${S.usage_days}`],
    ...rows.map((i) => [STATUS_LABEL[i.status], i.sku, i.title, i.type, i.vendor ?? '', i.unit, i.stock, i.value, i.use ? i.use.toFixed(1) : '', i.dih == null ? '' : i.dih.toFixed(1), runText(i, d.today, S.horizon_days), i.onOrder, i.use ? i.need : '', i.stale, i.daysMoved])]);
  return <div className="card"><h2>Every item, projected forward</h2><p className="inv-sub">Pick a group, sort by any column heading, click a row for the graph and the working.</p>
    <div className="inv-chips">{chips.map((c) => <button key={c[0]} className={`inv-chip ${g === c[0] ? 'on' : ''}`} title={c[3]} onClick={() => { setG(c[0]); setOpen(null); }}>{c[1]}<b>{c[2]}</b></button>)}</div>
    <div className="inv-meaning"><b>{cur[1]}:</b> {cur[3]}</div>
    <div className="inv-tools"><input placeholder="Search item, code or vendor" value={q} onChange={(e) => setQ(e.target.value)} />
      <select value={ty} onChange={(e) => setTy(e.target.value)}><option value="">All types</option>{types.map((t) => <option key={t} value={t}>{t} ({R.filter((i) => i.type === t).length})</option>)}</select>
      <select value={ve} onChange={(e) => setVe(e.target.value)}><option value="">All vendors</option>{vendors.map((v) => <option key={v}>{v}</option>)}</select>
      <button className="inv-btn" onClick={csv}>Download CSV</button><span className="muted">{rows.length} items</span></div>
    <SortTable cols={cols} rows={rows} rowKey={(i) => i.sku} openKey={open} onRow={(k) => setOpen((o) => o === k ? null : k)} expand={(i) => <Detail i={i} d={d} />} />
  </div>;
}

// ---------- Order plan ----------
export function OrdersView({ d, vendor0 }: { d: Computed; vendor0?: string }) {
  const S = d.settings; const all = d.items.filter((i) => i.suggest > 0);
  const [ve, setVe] = useState(vendor0 ?? ''); const [q, setQ] = useState('');
  const vn = (i: Item) => i.vendor ?? 'No vendor on record';
  const groups = useMemo(() => { const m = new Map<string, { n: number; val: number }>(); for (const i of all) { const o = m.get(vn(i)) ?? { n: 0, val: 0 }; o.n++; o.val += i.suggest * i.price; m.set(vn(i), o); } return [...m.entries()].sort((a, b) => b[1].val - a[1].val); }, [all]);
  const rows = useMemo(() => all.filter((i) => (!ve || vn(i) === ve) && (!q || `${i.title} ${i.sku} ${i.vendor ?? ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => vn(a).localeCompare(vn(b)) || STATUS_ORDER[a.status] - STATUS_ORDER[b.status]), [all, ve, q]);
  const cols: Col<Item>[] = [
    { k: 'v', l: 'Vendor', v: vn, c: vn }, { k: 't', l: 'Item', v: (i) => i.title, c: (i) => <ItemCell i={i} days={S.usage_days} /> }, { k: 'ty', l: 'Type', v: (i) => i.type, c: (i) => i.type },
    { k: 's', l: 'Status', v: (i) => STATUS_ORDER[i.status], c: (i) => <Pill s={i.status} days={S.usage_days} /> },
    { k: 'st', l: 'Stock', n: true, v: (i) => i.stock, c: (i) => qty(i.stock) }, { k: 'u', l: 'Used a day', n: true, v: (i) => i.use, c: (i) => num(i.use, 1) },
    { k: 'd', l: 'Days in hand', n: true, v: (i) => i.dih, c: (i) => num(i.dih, 1) }, { k: 'c', l: 'On order', n: true, v: (i) => i.onOrder || null, c: (i) => i.onOrder ? qty(i.onOrder) : '' },
    { k: 'l', l: 'Lead time', n: true, tip: '* estimated, not from the lead time sheet', v: (i) => i.lead, c: (i) => `${i.lead} d${i.leadSrc === 'item' || i.leadSrc === 'vendor' ? '' : ' *'}` },
    { k: 'q', l: 'Order quantity', n: true, v: (i) => i.suggest, c: (i) => <><b>{num(i.suggest)}</b> <span className="inv-sku">{unit(i.unit)}</span></> },
    { k: 'val', l: 'About (Rs)', n: true, v: (i) => i.suggest * i.price, c: (i) => num(i.suggest * i.price) },
    { k: 'p', l: 'Old POs to settle first', n: true, v: (i) => i.stale || null, c: (i) => i.stale ? qty(i.stale) : '', cls: (i) => i.stale ? 'inv-bad' : '' }];
  const csv = () => download(`inventory-packaging-orders-${d.today}.csv`, [['Vendor', 'SKU', 'Item', 'Type', 'Unit', 'Status', 'Stock', 'Used a day', 'Days in hand', 'On order', 'Lead time days', 'Order quantity', 'About Rs', 'Old PO qty', 'Rough'],
    ...rows.map((i) => [i.vendor ?? '', i.sku, i.title, i.type, i.unit, STATUS_LABEL[i.status], i.stock, i.use.toFixed(1), (i.dih ?? 0).toFixed(1), i.onOrder, i.lead, i.suggest, Math.round(i.suggest * i.price), i.stale, i.rough ? 'yes' : ''])]);
  return <div className="card"><h2>What to order today</h2><p className="inv-sub">Quantity covers the lead time, the buffer and {S.order_cover_days} more days, less stock and less what is already on order. Raise the PO in SupplyNote. For items tagged "rough", check the kitchen's stock first.</p>
    <div className="inv-chips"><button className={`inv-chip ${ve === '' ? 'on' : ''}`} onClick={() => setVe('')}>All vendors<b>{all.length}</b></button>{groups.map(([v, o]) => <button key={v} className={`inv-chip ${ve === v ? 'on' : ''}`} title={`About Rs ${num(o.val)}`} onClick={() => setVe(v)}>{v}<b>{o.n}</b></button>)}</div>
    <div className="inv-tools"><input placeholder="Search item or vendor" value={q} onChange={(e) => setQ(e.target.value)} /><button className="inv-btn" onClick={csv}>Download CSV</button><span className="muted">{rows.length} items, about {lakh(rows.reduce((t, i) => t + i.suggest * i.price, 0))} at the last price</span></div>
    <SortTable cols={cols} rows={rows} rowKey={(i) => i.sku} />
    <div className="inv-more">* lead time estimated (from how often the item is delivered, or {S.default_lead_days} days where there is no history).</div></div>;
}

// ---------- PO tracker ----------
type PoRow = Po & { item: Item };
export function PosView({ d, b0 }: { d: Computed; b0?: string }) {
  const S = d.settings; const cut = S.past_due_cutoff_days;
  const pol: PoRow[] = useMemo(() => d.items.flatMap((i) => i.pos.map((p) => ({ ...p, item: i }))), [d]);
  const [b, setB] = useState<'stale' | 'late' | 'due'>(b0 === 'late' || b0 === 'due' ? b0 : 'stale'); const [q, setQ] = useState(''); const [ve, setVe] = useState('');
  const defs = { stale: ['Old, confirm or close', `More than ${cut} days past the due date. NOT counted as stock on the way. Each line needs a decision: get a new confirmed date, or close it in SupplyNote.`], late: ['Late, chase the vendor', `1 to ${cut} days past the due date. Still counted as coming, and assumed to arrive today.`], due: ['On time, not yet due', 'Counted as stock on the way.'] } as const;
  const inB = pol.filter((p) => p.bucket === b); const vendors = [...new Set(inB.map((p) => p.vendor ?? ''))].sort();
  const rows = inB.filter((p) => (!ve || p.vendor === ve) && (!q || `${p.item.title} ${p.item.sku} ${p.vendor} ${p.po}`.toLowerCase().includes(q.toLowerCase()))).sort((x, y) => y.late - x.late);
  const cols: Col<PoRow>[] = [
    { k: 't', l: 'Item', v: (p) => p.item.title, c: (p) => <><Link className="inv-lk" href={itemHref(p.item)}>{p.item.title}</Link>{p.short && <span className="inv-tag" title="Part of this line was received. The rest was never delivered, or never closed.">part received</span>}<div className="inv-sku">{p.item.sku}</div></> },
    { k: 'ty', l: 'Type', v: (p) => p.item.type, c: (p) => p.item.type }, { k: 'po', l: 'PO', v: (p) => p.po, c: (p) => p.po }, { k: 'v', l: 'Vendor', v: (p) => p.vendor ?? '', c: (p) => p.vendor },
    { k: 'sd', l: 'PO date', v: (p) => p.saved, c: (p) => dt(p.saved) }, { k: 'due', l: 'Due', v: (p) => p.due, c: (p) => dt(p.due) },
    { k: 'late', l: b === 'due' ? 'Days to go' : 'Days late', n: true, v: (p) => Math.abs(p.late), c: (p) => Math.abs(p.late), cls: (p) => p.late > 0 ? 'inv-bad' : '' },
    { k: 'o', l: 'Ordered', n: true, v: (p) => p.ordered, c: (p) => qty(p.ordered) }, { k: 'r', l: 'Received', n: true, v: (p) => p.received, c: (p) => qty(p.received) },
    { k: 'op', l: 'Still open', n: true, v: (p) => p.open, c: (p) => qty(p.open) }, { k: 'val', l: 'Open value (Rs)', n: true, v: (p) => p.open * p.price, c: (p) => num(p.open * p.price) },
    { k: 's', l: 'Item status', v: (p) => STATUS_ORDER[p.item.status], c: (p) => <Pill s={p.item.status} days={S.usage_days} /> }];
  const csv = () => download(`inventory-packaging-pos-${b}-${d.today}.csv`, [['Group', 'SKU', 'Item', 'Type', 'PO', 'Vendor', 'PO date', 'Due', 'Days late', 'Ordered', 'Received', 'Still open', 'Open value Rs', 'Part received', 'Item status'],
    ...rows.map((p) => [defs[b][0], p.item.sku, p.item.title, p.item.type, p.po, p.vendor ?? '', p.saved, p.due, p.late, p.ordered, p.received, p.open, Math.round(p.open * p.price), p.short ? 'yes' : '', STATUS_LABEL[p.item.status]])]);
  return <div className="card"><h2>Purchase orders with quantity still to come</h2><p className="inv-sub">"Still to come" means ordered minus cancelled minus received is above zero, and the PO is not void or closed. {pol.length} lines, {lakh(openVal(pol))} at PO price.</p>
    <div className="inv-chips">{(['stale', 'late', 'due'] as const).map((k) => <button key={k} className={`inv-chip ${b === k ? 'on' : ''}`} onClick={() => { setB(k); setVe(''); }}>{defs[k][0]}<b>{pol.filter((p) => p.bucket === k).length}</b></button>)}</div>
    <div className="inv-meaning"><b>{defs[b][0]}:</b> {defs[b][1]}</div>
    <div className="inv-tools"><input placeholder="Search item, PO or vendor" value={q} onChange={(e) => setQ(e.target.value)} /><select value={ve} onChange={(e) => setVe(e.target.value)}><option value="">All vendors</option>{vendors.map((v) => <option key={v}>{v}</option>)}</select><button className="inv-btn" onClick={csv}>Download CSV</button><span className="muted">{rows.length} lines, {lakh(openVal(rows))}</span></div>
    <SortTable cols={cols} rows={rows} rowKey={(p) => `${p.po}|${p.item.sku}|${p.due}|${p.open}`} /></div>;
}

// ---------- Stock health ----------
export function HealthView({ d }: { d: Computed }) {
  const S = d.settings; const neg = d.items.filter((i) => i.negative); const dead = d.items.filter((i) => i.status === 'IDLE' && i.value > 0).sort((a, b) => b.value - a.value);
  const csv = () => download(`inventory-packaging-not-moving-${d.today}.csv`, [['SKU', 'Item', 'Type', 'Unit', 'Stock', 'Value Rs', 'Last sent out'], ...dead.map((i) => [i.sku, i.title, i.type, i.unit, i.stock, i.value, i.lastOut ?? ''])]);
  return <>
    <div className="card"><h2>Showing less than zero</h2><p className="inv-sub">{neg.length} items. Stock cannot be below zero: a delivery was used before it was entered. Enter the missing delivery.</p>
      <SortTable rows={neg} rowKey={(i) => i.sku} cols={[{ k: 't', l: 'Item', v: (i) => i.title, c: (i) => <ItemCell i={i} days={S.usage_days} /> }, { k: 'st', l: 'SupplyNote stock', n: true, v: (i) => i.stock, c: (i) => `${qty(i.stock)} ${unit(i.unit)}`, cls: () => 'inv-bad' }, { k: 'u', l: 'Used a day', n: true, v: (i) => i.use, c: (i) => num(i.use, 1) }]} /></div>
    <div className="card"><h2>Stock that is not moving</h2><p className="inv-sub">{dead.length} items with stock but nothing sent out in {S.usage_days} days: {lakh(dead.reduce((t, i) => t + i.value, 0))}. Check it is really there, then decide: use it, return it or write it off.</p>
      <div className="inv-tools"><button className="inv-btn" onClick={csv}>Download CSV</button></div>
      <SortTable rows={dead} rowKey={(i) => i.sku} limit={40} cols={[{ k: 't', l: 'Item', v: (i) => i.title, c: (i) => <ItemCell i={i} days={S.usage_days} /> }, { k: 'c', l: 'Type', v: (i) => i.type, c: (i) => i.type }, { k: 'st', l: 'Stock', n: true, v: (i) => i.stock, c: (i) => `${qty(i.stock)} ${unit(i.unit)}` }, { k: 'val', l: 'Value (Rs)', n: true, v: (i) => i.value, c: (i) => num(i.value) }, { k: 'lo', l: 'Last sent out', v: (i) => i.lastOut ?? '', c: (i) => i.lastOut ? dt(i.lastOut) : 'not since 1 Aug 2026' }]} /></div>
  </>;
}
