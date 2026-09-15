// Small shared pieces for the recipe screens. Server-safe (no hooks).
import Link from 'next/link';
import { inr, pct, rateLabel, unitShort } from '@/lib/recipes-engine';

export const Kind = ({ kind }: { kind: string }) => (
  <span className={'pill ' + (kind === 'finished' ? 'pill-warn' : kind === 'intermediate' || kind === 'semi' ? 'pill-neutral' : 'pill-neutral')}>
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

export function SearchForm({ action, q, placeholder, extra }: { action: string; q: string; placeholder: string; extra?: React.ReactNode }) {
  return (
    <form method="get" action={action} className="filter-bar" style={{ marginBottom: 10 }}>
      <input name="q" defaultValue={q} placeholder={placeholder} style={{ minWidth: 260, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 6 }} />
      <button className="btn btn-secondary" type="submit">Find</button>
      {q ? <Link className="linkbtn" href={action}>Clear</Link> : null}
      {extra}
    </form>
  );
}
