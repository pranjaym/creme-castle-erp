// Small shared pieces for the recipe screens. Server-safe (no hooks).
import Link from 'next/link';
import { inr, pct, rateLabel, unitShort } from '@/lib/recipes-engine';

export const Kind = ({ kind }: { kind: string }) => (
  <span className={'pill ' + (kind === 'finished' ? 'pill-warn' : 'pill-neutral')}>
    {kind === 'finished' ? 'finished' : kind === 'intermediate' || kind === 'semi' ? 'semi-finished' : kind === 'packaging' ? 'packaging' : 'purchased'}
  </span>
);

export const Status = ({ status }: { status: string }) => (
  <span className={'pill ' + (status === 'active' ? 'pill-ok' : status === 'upcoming' ? 'pill-warn' : 'pill-neutral')}>{status}</span>
);

export const State = ({ state, checkedBy }: { state: string; checkedBy?: string | null }) => {
  const label = state === 'approved' ? 'live' : state === 'checked' ? (checkedBy ? 'checked, awaiting approval' : 'awaiting check') : state;
  const cls = state === 'approved' ? 'pill-ok' : state === 'checked' ? 'pill-warn' : state === 'draft' ? 'pill-neutral' : state === 'rejected' ? 'pill-danger' : 'pill-neutral';
  return <span className={'pill ' + cls}>{label}</span>;
};

export function Verdict({ fc, target }: { fc: number | null | undefined; target: number }) {
  if (fc == null) return <span className="pill pill-neutral">no price</span>;
  if (fc <= target) return <span className="pill pill-ok">within target</span>;
  if (fc <= target + 0.05) return <span className="pill pill-warn">near target</span>;
  return <span className="pill pill-danger">above target</span>;
}

export const Money = ({ v, d = 2 }: { v: number | null | undefined; d?: number }) => <span className="num">{inr(v, d)}</span>;
export const Pct = ({ v }: { v: number | null | undefined }) => <span className="num">{pct(v)}</span>;
export const Rate = ({ v, unit }: { v: number | null | undefined; unit: string }) => <span className="num">{rateLabel(v, unit)}</span>;
export const Qty = ({ v, unit, d }: { v: number; unit: string; d?: number }) => (
  <span className="num">{v.toLocaleString('en-IN', { maximumFractionDigits: d ?? (v < 1 ? 3 : 2) })} {unitShort(unit)}</span>
);

export function RefLink({ kind, code, name }: { kind: string; code: string; name: string }) {
  const href = kind === 'raw' || kind === 'packaging' ? null : '/recipes/r/' + encodeURIComponent(code);
  return href ? <Link href={href}>{name}</Link> : <Link href={'/recipes/ingredients?q=' + encodeURIComponent(code)}>{name}</Link>;
}

export function Crumbs({ items }: { items: (string | [string, string])[] }) {
  return (
    <p className="note" style={{ marginTop: 0 }}>
      {items.map((it, i) => (
        <span key={i}>
          {i ? ' / ' : ''}
          {typeof it === 'string' ? <b>{it}</b> : <Link href={it[1]}>{it[0]}</Link>}
        </span>
      ))}
    </p>
  );
}

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  return <>{ok ? <p className="ok">{ok}</p> : null}{err ? <p className="err">{err}</p> : null}</>;
}

// The list toolbar: search on the left, filter chips, actions on the right.
export interface Chip { label: string; href: string; on: boolean; count?: number }
export function Toolbar({ action, q, placeholder, chips, hidden, right, count }: {
  action: string; q: string; placeholder: string; chips?: Chip[]; hidden?: Record<string, string>; right?: React.ReactNode; count?: string;
}) {
  return (
    <div className="rtoolbar">
      <form method="get" action={action} className="search">
        {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input name="q" defaultValue={q} placeholder={placeholder} aria-label={placeholder} />
        {q ? <Link className="linkbtn" href={action}>clear</Link> : null}
      </form>
      {chips?.length ? <div className="chips">{chips.map(c => <Link key={c.href} href={c.href} className={'rchip' + (c.on ? ' on' : '')}>{c.label}{c.count != null ? <span className="n">{c.count}</span> : null}</Link>)}</div> : null}
      {count ? <span className="rcount">{count}</span> : null}
      <span className="spacer" />
      {right}
    </div>
  );
}

// One line per column that uses a word a chef or an accountant might not.
export function Legend({ items }: { items: [string, string][] }) {
  return <div className="rlegend">{items.map(([k, v]) => <span key={k}><b>{k}</b> {v}</span>)}</div>;
}

export function Strip({ items }: { items: { l: string; v: React.ReactNode; d?: React.ReactNode }[] }) {
  return <div className="rstrip">{items.map((it, i) => <div className="s" key={i}><div className="l">{it.l}</div><div className="v">{it.v}</div>{it.d ? <div className="d">{it.d}</div> : null}</div>)}</div>;
}

export function soldAs(outputQty: number | null | undefined, soldWeightG: number | null | undefined): string {
  if (outputQty == null) return '';
  const w = soldWeightG ? ` of ${soldWeightG.toLocaleString('en-IN')} g` : '';
  return outputQty === 1 ? `1 unit${w}` : `${outputQty.toLocaleString('en-IN')} units${w} per batch`;
}
