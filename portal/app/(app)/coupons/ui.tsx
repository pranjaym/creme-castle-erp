// Small shared pieces for the coupon screens. Server-safe (no hooks).
import Link from 'next/link';
import { type Filters, type Platform, type StatusKey, STATUS_CHIP, STATUS_LABEL, qs, dateLabel } from '@/lib/coupons';

export const Tag = ({ p }: { p: Platform | string }) => (
  <span className={'apptag ' + (p === 'zomato' ? 'app-z' : 'app-s')}>{p === 'zomato' ? 'Z' : 'S'}</span>
);
export const Chip = ({ s }: { s: StatusKey }) => <span className={'chip ' + STATUS_CHIP[s]}>{STATUS_LABEL[s]}</span>;
export const Agreed = ({ v }: { v: number | null }) => v == null ? <span className="muted">none</span> : <b>{v}%</b>;

export function Tabs({ on }: { on: 'perf' | 'glossary' | 'deals' }) {
  return (
    <div className="tabs">
      <Link href="/coupons" className={on === 'perf' ? 'on' : ''}>Performance</Link>
      <Link href="/coupons/glossary" className={on === 'glossary' ? 'on' : ''}>Glossary</Link>
      <Link href="/coupons/deals" className={on === 'deals' ? 'on' : ''}>Deals &amp; uploads</Link>
    </div>
  );
}

// The filter bar: period, platform, city, outlet. A plain GET form so every view
// is a URL that can be sent to someone.
export function FilterBar({ f, cities, outlets, base, exportHref }: {
  f: Filters; cities: string[]; outlets: { code: string; city: string }[]; base: string; exportHref?: string;
}) {
  const seg = (p: Platform | null, label: string) => (
    <Link href={base + qs({ ...f, platform: p })} className={f.platform === p ? 'on' : ''}>{label}</Link>
  );
  return (
    <form method="get" action={base} className="filterbar">
      <label>From<input type="date" name="from" defaultValue={f.from} /></label>
      <label>To<input type="date" name="to" defaultValue={f.to} /></label>
      {f.platform ? <input type="hidden" name="p" value={f.platform} /> : null}
      <label>City
        <select name="city" defaultValue={f.city ?? ''}>
          <option value="">All cities</option>
          {cities.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label>Outlet
        <select name="outlet" defaultValue={f.outlet ?? ''}>
          <option value="">All outlets</option>
          {outlets.map(o => <option key={o.code} value={o.code}>{o.code.replace('CC-', '')}</option>)}
        </select>
      </label>
      <button className="btn btn-primary" type="submit">Apply</button>
      <span className="seg">{seg(null, 'Both')}{seg('zomato', 'Zomato')}{seg('swiggy', 'Swiggy')}</span>
      <span className="subtle">{dateLabel(f.from)} to {dateLabel(f.to)}</span>
      {exportHref ? <a className="btn btn-secondary" href={exportHref} style={{ marginLeft: 'auto' }}>Export CSV</a> : null}
    </form>
  );
}

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  return <>{ok ? <p className="ok">{ok}</p> : null}{err ? <p className="err">{err}</p> : null}</>;
}
