import Link from 'next/link';
import { requireUser, couponPerms } from '@/lib/session';
import {
  parseFilters, qs, summary, couponRows, cityCells, cities, outlets, dayStatus, missingDays, tolerance, status,
  inr, lakh, pct, num, dateLabel, STATUS_HEAT, type Filters, type Platform, type CouponRow,
} from '@/lib/coupons';
import { Tag, Chip, Agreed, Tabs, FilterBar, Flash } from './ui';

// The performance screen: who paid for the discount, this period, against what
// we agreed. Summary in the Total / Zomato / Swiggy layout Pranjay fixed for the
// scorecard, then what needs attention, then every coupon by name, then our
// share by city for BOTH platforms. Every number lists its orders.
export const dynamic = 'force-dynamic';

const CITY_ORDER = ['Delhi', 'Gurugram', 'Gurgaon', 'Noida', 'Faridabad', 'Ghaziabad', 'Jaipur', 'Chandigarh', 'Meerut', 'Lucknow', 'Ludhiana'];

export default async function CouponsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const f = parseFilters(sp);
  const tol = await tolerance();
  const [sum, rows, zc, sc, ds, missing, cityList, outletList] = await Promise.all([
    summary(f), couponRows(f, tol),
    f.platform === 'swiggy' ? Promise.resolve([]) : cityCells(f, 'zomato'),
    f.platform === 'zomato' ? Promise.resolve([]) : cityCells(f, 'swiggy'),
    dayStatus(f), missingDays(f), cities(), outlets(f.city),
  ]);
  const total = sum[0];
  const canEdit = couponPerms(user).edit;
  const exportHref = '/coupons/download' + qs(f);

  // data completeness: a day whose platform rows are mostly missing is not a clean day
  const thin = ds.filter(d => d.orders > 0 && d.matched < d.orders * 0.9);

  const red = rows.filter(r => r.status === 'red').sort((a, b) => b.above_deal - a.above_deal);
  const nolist = rows.filter(r => r.status === 'nolist' && r.n >= 40).sort((a, b) => b.ours - a.ours);
  const more = rows.filter(r => r.status === 'more' && r.n >= 40).sort((a, b) => b.n - a.n);
  const allours = rows.filter(r => r.status === 'allours');
  const main = rows.filter(r => r.n >= 20);
  const tail = rows.filter(r => r.n < 20);

  const grid = (platform: Platform, cells: { code: string; city: string; n: number; burn: number; ours: number }[]) => {
    const codes = rows.filter(r => r.platform === platform && r.n >= 60).slice(0, 14);
    if (!codes.length) return null;
    const cityNames = [...new Set(cells.map(c => c.city))].sort((a, b) => (CITY_ORDER.indexOf(a) + 1 || 99) - (CITY_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b));
    const at = new Map(cells.map(c => [c.code + '|' + c.city, c]));
    return (
      <div className="card" key={platform}>
        <h2>Our share by city: <Tag p={platform} />{platform === 'zomato' ? 'Zomato' : 'Swiggy'}</h2>
        <div className="scroll-x"><table className="sheet">
          <thead><tr><th>Coupon</th><th className="num">Agreed</th>{cityNames.map(c => <th key={c} className="num">{c}</th>)}</tr></thead>
          <tbody>{codes.map(r => (
            <tr key={r.code}>
              <td className="name"><Link href={couponHref(platform, r.code, f)}>{r.code}</Link></td>
              <td className="num"><Agreed v={r.agreed} /></td>
              {cityNames.map(c => {
                const cell = at.get(r.code + '|' + c);
                if (!cell || cell.n < 5) return <td key={c} className="num muted">.</td>;
                const share = cell.burn ? 100 * cell.ours / cell.burn : null;
                return <td key={c} className={'num ' + STATUS_HEAT[status(share, r.agreed, tol)]}>{pct(share)}<div className="tiny">{num(cell.n)}</div></td>;
              })}
            </tr>
          ))}</tbody>
        </table></div>
        <p className="note">Cities from the outlet master, the same on both platforms. The small number is the order count. Green on deal, lavender they fund more, red above deal, amber no deal recorded.</p>
      </div>
    );
  };

  return (
    <>
      <h1 className="page">Coupon sharing</h1>
      <p className="hint">
        On every coupon order, how much of the discount <b>we</b> paid and how much the platform paid, against the deal on the
        <Link href="/coupons/deals"> deals page</Link>. The rule: a row goes red only when the platform paid <b>less</b> than agreed. When they fund more, it stays quiet.
      </p>
      <Tabs on="perf" />
      <Flash ok={sp.ok} err={sp.err} />
      <FilterBar f={f} cities={cityList} outlets={outletList} base="/coupons" exportHref={exportHref} />

      {thin.length || missing.length ? (
        <p className="hint warn">
          {thin.map(d => `${d.platform === 'zomato' ? 'Zomato' : 'Swiggy'} on ${dateLabel(d.business_date)} has ${Math.round(100 * d.matched / d.orders)}% of its orders matched`).join('; ')}
          {thin.length && missing.length ? '; ' : ''}
          {missing.length ? `not computed yet: ${missing.map(dateLabel).join(', ')}` : ''}.
          {' '}The platform files land during the day and the night refresh (23:30 IST) completes them. Read such a day tomorrow.
        </p>
      ) : null}

      <div className="kpis">
        <div className="kpi"><div className="l">Coupon orders</div><div className="v">{num(total.coupon_orders)}</div><div className="d">of {num(total.orders)} orders ({total.orders ? Math.round(100 * total.coupon_orders / total.orders) : 0}%)</div></div>
        <div className="kpi"><div className="l">Discount shared</div><div className="v">{lakh(total.burn)}</div><div className="d">what customers saved through coupons</div></div>
        <div className="kpi"><div className="l">We paid</div><div className="v">{lakh(total.ours)}</div><div className="d">{total.p_ours ? `${total.ours >= total.p_ours ? '+' : ''}${Math.round(100 * (total.ours - total.p_ours) / total.p_ours)}% vs the period before` : ''}</div></div>
        <div className="kpi"><div className="l">They paid</div><div className="v">{lakh(total.theirs)}</div></div>
        <div className="kpi"><div className="l">Our share</div><div className="v">{total.share == null ? '' : total.share.toFixed(1)}<small>%</small></div>
          <div className="d">{total.share != null && total.p_share != null ? `${(total.share - total.p_share) >= 0 ? '+' : ''}${(total.share - total.p_share).toFixed(1)} pts vs the period before` : ''}</div></div>
        <div className={'kpi' + (total.above_deal > 0 ? ' hot' : '')}><div className="l">Paid above deal</div><div className="v">{inr(total.above_deal)}</div><div className="d">rupees we paid beyond the agreed share</div></div>
        <div className="kpi"><div className="l">Extras, 100% ours</div><div className="v">{lakh(total.extras)}</div><div className="d">Zomato flat offs and freebies, Swiggy trade discount</div></div>
      </div>

      <div className="card">
        <h2>Summary</h2>
        <div className="scroll-x"><table className="sheet">
          <thead><tr><th></th><th className="num">Orders</th><th className="num">On a coupon</th><th className="num">Discount shared</th><th className="num">We paid</th><th className="num">They paid</th><th className="num">Our share</th><th className="num">vs before</th><th className="num">Above deal</th><th className="num">Extras (ours)</th><th className="num">Avg bill on coupon</th></tr></thead>
          <tbody>{sum.map(r => {
            const d = r.share != null && r.p_share != null ? r.share - r.p_share : null;
            return (
              <tr key={r.platform}>
                <td className="name">{r.platform === 'total' ? 'Total' : <><Tag p={r.platform} />{r.platform === 'zomato' ? 'Zomato' : 'Swiggy'}</>}</td>
                <td className="num">{num(r.orders)}</td>
                <td className="num">{num(r.coupon_orders)} <span className="tiny">({r.orders ? Math.round(100 * r.coupon_orders / r.orders) : 0}%)</span></td>
                <td className="num">{inr(r.burn)}</td><td className="num"><b>{inr(r.ours)}</b></td><td className="num">{inr(r.theirs)}</td>
                <td className="num"><b>{pct(r.share)}</b></td>
                <td className={'num ' + (d != null && d > tol ? 'h-red' : d != null && d < -tol ? 'h-more' : '')}>{d == null ? '' : (d >= 0 ? '+' : '') + d.toFixed(1) + ' pts'}</td>
                <td className="num">{r.above_deal ? inr(r.above_deal) : '0'}</td>
                <td className="num">{inr(r.extras)}</td>
                <td className="num">{r.avg_bill == null ? '' : '₹' + Math.round(r.avg_bill)}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        <p className="note">
          &ldquo;vs before&rdquo; compares our share with the same number of days immediately before this period. A rise in points means the platforms paid less of the discount than before.
          Swiggy orders count every Petpooja Swiggy order; Swiggy&rsquo;s own file lists only coupon orders.
        </p>
      </div>

      <div className="attn">
        <h2 className="section" style={{ margin: 0 }}>Needs your attention</h2>
        <ol>
          {red.length ? red.slice(0, 6).map(r => (
            <li key={r.platform + r.code}><Chip s="red" /> <b><Tag p={r.platform} /><Link href={couponHref(r.platform, r.code, f)}>{r.code}</Link></b>: our share {pct(r.share)} against an agreed {r.agreed}%, <b>{inr(r.above_deal)}</b> paid above the deal on {num(r.n)} orders.</li>
          )) : <li><Chip s="red" /> No coupon is above its agreed share in this period{rows.some(r => r.agreed != null) ? '.' : ', but no deals are recorded yet, so nothing can be. Record them on the deals page.'}</li>}
          {nolist.length ? (
            <li><Chip s="nolist" /> <b>{nolist.length} coupon{nolist.length > 1 ? 's' : ''} with 40+ orders and no deal recorded</b>: {nolist.slice(0, 8).map((r, i) => <span key={r.platform + r.code}>{i ? ', ' : ''}<Tag p={r.platform} /><Link href={couponHref(r.platform, r.code, f)}>{r.code}</Link> ({pct(r.share)} ours)</span>)}{nolist.length > 8 ? ` and ${nolist.length - 8} more` : ''}. {canEdit ? <Link href="/coupons/deals">Record the deals</Link> : 'Ask an editor to record the deals'} so the module can tell you when they change.</li>
          ) : null}
          {more.length ? (
            <li><Chip s="more" /> <b>Platform funding more than agreed</b>: {more.slice(0, 6).map((r, i) => <span key={r.platform + r.code}>{i ? ', ' : ''}<Tag p={r.platform} /><Link href={couponHref(r.platform, r.code, f)}>{r.code}</Link> ({pct(r.share)} vs {r.agreed}%)</span>)}. Good news; volume usually jumps with it and falls back when it ends.</li>
          ) : null}
          {allours.length ? (
            <li><Chip s="allours" /> <b>Fully ours</b>: {allours.map((r, i) => <span key={r.platform + r.code}>{i ? ', ' : ''}<Tag p={r.platform} /><Link href={couponHref(r.platform, r.code, f)}>{r.code}</Link></span>)}, {inr(allours.reduce((a, r) => a + r.ours, 0))} this period. Listed so it is never a surprise.</li>
          ) : null}
        </ol>
      </div>

      <div className="card">
        <h2>Every coupon{f.platform ? '' : ', both platforms'}{f.outlet ? ` at ${f.outlet.replace('CC-', '')}` : f.city ? ` in ${f.city}` : ''}</h2>
        <CouponTable rows={main} f={f} />
        {tail.length ? (
          <details style={{ marginTop: 8 }}>
            <summary className="note" style={{ cursor: 'pointer' }}>{tail.length} more coupons with fewer than 20 orders</summary>
            <CouponTable rows={tail} f={f} />
          </details>
        ) : null}
        <p className="note">Sorted by what we paid. Zomato names are the promo code Zomato prints on the order; &ldquo;what it is&rdquo; is the construct on the order or, for Swiggy, what the glossary says.</p>
      </div>

      {grid('zomato', zc)}
      {grid('swiggy', sc)}
    </>
  );
}

function couponHref(platform: Platform, code: string, f: Filters) {
  return `/coupons/c/${platform}/${encodeURIComponent(code)}` + qs(f, { p: null });
}

function CouponTable({ rows, f }: { rows: CouponRow[]; f: Filters }) {
  return (
    <div className="scroll-x"><table className="sheet">
      <thead><tr><th></th><th>Coupon</th><th>What it is</th><th>For whom</th><th className="num">Orders</th><th className="num">Discount</th><th className="num">We paid</th><th className="num">They paid</th><th className="num">Our share</th><th className="num">Agreed</th><th>Status</th><th className="num">Above deal</th><th className="num">Avg bill</th><th className="num">Outlets</th></tr></thead>
      <tbody>{rows.map(r => (
        <tr key={r.platform + r.code}>
          <td><Tag p={r.platform} /></td>
          <td className="name"><Link href={couponHref(r.platform, r.code, f)}>{r.code}</Link></td>
          <td className="wrap small">{r.constructs ?? r.what_it_is ?? <span className="muted">not typed yet</span>}</td>
          <td className="small">{r.for_whom ?? <span className="muted">.</span>}</td>
          <td className="num">{num(r.n)}</td><td className="num">{inr(r.burn)}</td><td className="num">{inr(r.ours)}</td><td className="num">{inr(r.theirs)}</td>
          <td className="num"><b>{pct(r.share)}</b></td><td className="num"><Agreed v={r.agreed} /></td>
          <td><Chip s={r.status} /></td>
          <td className="num">{r.above_deal ? inr(r.above_deal) : ''}</td>
          <td className="num">{r.avg_bill == null ? '' : '₹' + Math.round(r.avg_bill)}</td>
          <td className="num">{r.outlets}</td>
        </tr>
      ))}
      {rows.length === 0 ? <tr><td colSpan={14} className="muted">No coupon orders in this period with these filters.</td></tr> : null}
      </tbody>
    </table></div>
  );
}
