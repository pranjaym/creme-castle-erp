import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, couponPerms } from '@/lib/session';
import { parseFilters, qs, couponDetail, tiers, tolerance, status, cities, outlets, inr, pct, num, dateLabel, dayLabel, STATUS_HEAT, type Platform } from '@/lib/coupons';
import { Tag, Chip, Agreed, FilterBar, Flash } from '../../../ui';
import { setDeal } from '../../../actions';

// One coupon as a card: what it is, what we agreed, what it cost; the period
// day by day; the outlets grouped by the share they actually sit on (a coupon
// can run at two exact tiers, the blend is nobody's deal); the orders.
export const dynamic = 'force-dynamic';

export default async function CouponPage({ params, searchParams }: { params: Promise<{ platform: string; code: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const { platform: p, code: rawCode } = await params;
  if (p !== 'zomato' && p !== 'swiggy') notFound();
  const platform = p as Platform;
  const code = decodeURIComponent(rawCode);
  const sp = await searchParams;
  const f = parseFilters({ ...sp, p: platform });
  const tol = await tolerance();
  const [d, cityList, outletList] = await Promise.all([couponDetail(platform, code, f, tol), cities(), outlets(f.city)]);
  const canEdit = couponPerms(user).edit;
  const head = d.head;
  const base = `/coupons/c/${platform}/${encodeURIComponent(code)}`;
  const tierRows = tiers(d.byOutlet);
  const back = base + qs(f, { p: null });

  return (
    <>
      <p className="note" style={{ marginTop: 0 }}><Link href={'/coupons' + qs(f, { p: null })}>Coupon sharing</Link> / <b>{code}</b></p>
      <h1 className="page"><Tag p={platform} />{code} <span className="subtle">{platform === 'zomato' ? (head?.constructs ?? d.glossary?.what_it_is ?? '') : (d.glossary?.what_it_is ?? '')}</span></h1>
      <Flash ok={sp.ok} err={sp.err} />
      <FilterBar f={f} cities={cityList} outlets={outletList} base={base} exportHref={'/coupons/download' + qs(f, { code })} />

      {!head ? <p className="hint warn">No orders on this coupon in the period. Widen the dates.</p> : (
        <>
          <div className="panels">
            <div className="panel"><div className="pt">What it is</div>
              <div className="kv"><span>Prints as</span><b>{head.constructs ?? d.glossary?.what_it_is ?? '.'}</b></div>
              <div className="kv"><span>For whom</span>{d.glossary?.for_whom ? <b>{d.glossary.for_whom}{d.glossary.segment ? ', ' + d.glossary.segment : ''}</b> : <span className="fill">not typed</span>}</div>
              <div className="kv"><span>Min bill seen</span><b>{head.min_bill == null ? '.' : '₹' + Math.round(head.min_bill)}</b></div>
              <div className="kv"><span>Avg bill</span><b>{head.avg_bill == null ? '.' : '₹' + Math.round(head.avg_bill)}</b></div>
              <div className="kv"><span>Live at</span><b>{head.outlets} outlets</b></div>
              <div className="kv"><span>First seen</span><b>{d.glossary?.first_seen ? dateLabel(String(d.glossary.first_seen)) : '.'}</b></div>
              {d.siblings.length ? <div className="kv"><span>Same construct, other names</span><b>{d.siblings.map((s, i) => <span key={s.code}>{i ? ', ' : ''}<Link href={`/coupons/c/zomato/${encodeURIComponent(s.code)}` + qs(f, { p: null })}>{s.code}</Link> {pct(s.share, 0)}</span>)}</b></div> : null}
              <div className="note"><Link href={'/coupons/glossary?q=' + encodeURIComponent(code)}>edit in the glossary</Link></div>
            </div>
            <div className="panel"><div className="pt">The deal</div>
              <div className="big">{pct(head.share)} <small>our share</small></div>
              <div style={{ margin: '6px 0' }}><Chip s={head.status} /></div>
              <div className="kv"><span>Agreed, network</span><Agreed v={head.agreed} /></div>
              <div className="kv"><span>Range across outlets</span><b>{tierRows.length ? `${pct(tierRows[0].share, 0)} to ${pct(tierRows[tierRows.length - 1].share, 0)}` : '.'}</b></div>
              <div className="kv"><span>Tolerance</span><b>{tol} pts</b></div>
              {canEdit ? (
                <form action={setDeal} className="inline" style={{ marginTop: 8 }}>
                  <input type="hidden" name="platform" value={platform} /><input type="hidden" name="code" value={code} /><input type="hidden" name="back" value={back} />
                  <select name="outlet" defaultValue=""><option value="">every outlet</option>{d.byOutlet.map(o => <option key={o.outlet_code} value={o.outlet_code}>{o.outlet_code.replace('CC-', '')}</option>)}</select>
                  <input className="w60" type="number" name="pct" step="0.1" min="0" max="100" placeholder="% ours" required />
                  <input type="date" name="from" defaultValue={new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })} />
                  <input className="w120" type="text" name="agreed_with" placeholder="agreed with" />
                  <button className="smallbtn" type="submit">Record deal</button>
                </form>
              ) : null}
            </div>
            <div className="panel"><div className="pt">The money, this period</div>
              <div className="kv"><span>Orders</span><b>{num(head.n)}</b></div>
              <div className="kv"><span>Discount shared</span><b>{inr(head.burn)}</b></div>
              <div className="kv"><span>We paid</span><b>{inr(head.ours)}</b></div>
              <div className="kv"><span>They paid</span><b>{inr(head.theirs)}</b></div>
              {head.extras ? <div className="kv"><span>Extras, 100% ours</span><b>{inr(head.extras)}</b></div> : null}
              {head.agreed != null && head.agreed < 99.5 ? <div className="kv"><span>At the agreed {head.agreed}%</span><b>{inr(head.agreed * head.burn / 100)}</b></div> : null}
              {head.above_deal ? <div className="kv"><span>Paid above deal</span><b style={{ color: '#872724' }}>{inr(head.above_deal)}</b></div> : null}
              {head.agreed != null && head.agreed < 99.5 && head.ours < head.agreed * head.burn / 100 ? <div className="kv"><span>Their extra funding</span><b style={{ color: '#2F5630' }}>{inr(head.agreed * head.burn / 100 - head.ours)}</b></div> : null}
            </div>
          </div>

          <div className="card">
            <h2>Day by day</h2>
            <div className="strip">{d.byDay.map(x => (
              <div className="dcell" key={x.business_date}><div className="dl">{dayLabel(x.business_date)}</div><div className="dv">{pct(x.share)}</div><div className="dn">{num(x.n)} orders</div></div>
            ))}</div>
            {d.byWeek.length > 1 ? (
              <>
                <div className="pt" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginTop: 8 }}>Week by week, last 120 days</div>
                <div className="strip">{d.byWeek.map(x => (
                  <div className={'dcell'} key={x.week}><div className="dl">wk of {dayLabel(x.week)}</div><div className="dv">{pct(x.share)}</div><div className="dn">{num(x.n)} orders</div></div>
                ))}</div>
              </>
            ) : null}
          </div>

          <div className="card">
            <h2>How this coupon is set up across outlets <span className="subtle">{tierRows.length} share tier{tierRows.length === 1 ? '' : 's'}</span></h2>
            <div className="scroll-x"><table className="sheet">
              <thead><tr><th>Tier</th><th className="num">Outlets</th><th className="num">Orders</th><th className="num">Our share</th><th className="num">We paid</th><th>Status</th><th>Which outlets</th></tr></thead>
              <tbody>{tierRows.map(t => (
                <tr key={t.label}>
                  <td className="name">{t.label}</td><td className="num">{t.outlets.length}</td><td className="num">{num(t.n)}</td>
                  <td className={'num ' + STATUS_HEAT[status(t.burn ? 100 * t.ours / t.burn : null, t.outlets[0].agreed, tol)]}><b>{pct(t.burn ? 100 * t.ours / t.burn : null)}</b></td>
                  <td className="num">{inr(t.ours)}</td>
                  <td><Chip s={status(t.burn ? 100 * t.ours / t.burn : null, t.outlets[0].agreed, tol)} /></td>
                  <td className="wrap small">{t.outlets.map(o => o.outlet_code.replace('CC-', '')).join(', ')}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <p className="note">Outlets grouped by the whole-number share they sit on (3+ orders). One coupon can run at two exact deals; the blend on the card is only the average. An outlet-specific deal can be recorded above.</p>
            <details style={{ marginTop: 8 }}>
              <summary className="note" style={{ cursor: 'pointer' }}>Every outlet ({d.byOutlet.length})</summary>
              <div className="scroll-x"><table className="sheet">
                <thead><tr><th>Outlet</th><th>City</th><th className="num">Orders</th><th className="num">Discount</th><th className="num">We paid</th><th className="num">Our share</th><th className="num">Agreed</th><th className="num">Avg bill</th></tr></thead>
                <tbody>{d.byOutlet.map(o => (
                  <tr key={o.outlet_code}><td className="name"><Link href={base + qs({ ...f, outlet: o.outlet_code }, { p: null })}>{o.outlet_code.replace('CC-', '')}</Link></td><td className="small">{o.city ?? ''}</td>
                    <td className="num">{num(o.n)}</td><td className="num">{inr(o.burn)}</td><td className="num">{inr(o.ours)}</td>
                    <td className={'num ' + STATUS_HEAT[status(o.share, o.agreed, tol)]}><b>{pct(o.share)}</b></td><td className="num"><Agreed v={o.agreed} /></td><td className="num">{o.avg_bill == null ? '' : '₹' + Math.round(o.avg_bill)}</td></tr>
                ))}</tbody>
              </table></div>
            </details>
          </div>

          <div className="card">
            <h2>The orders <span className="subtle">first {d.orders.length} of {num(head.n)}, newest first</span></h2>
            <div className="scroll-x"><table className="sheet">
              <thead><tr><th>Order</th><th>Day</th><th>Outlet</th>{platform === 'zomato' ? <th>What it printed</th> : null}<th className="num">Bill</th><th className="num">Discount</th><th className="num">We paid</th><th className="num">They paid</th><th className="num">Extras</th><th className="num">Our share</th></tr></thead>
              <tbody>{d.orders.map(o => (
                <tr key={o.order_no}><td className="mono">{o.order_no}</td><td className="small">{dayLabel(o.business_date)}</td><td className="small">{(o.outlet_code ?? '').replace('CC-', '')}</td>
                  {platform === 'zomato' ? <td className="small">{o.construct ?? ''}</td> : null}
                  <td className="num">{o.bill == null ? '' : '₹' + Math.round(o.bill)}</td><td className="num">{inr(o.burn)}</td><td className="num">{inr(o.ours)}</td><td className="num">{inr(o.theirs)}</td><td className="num">{o.extras ? inr(o.extras) : ''}</td>
                  <td className={'num ' + STATUS_HEAT[status(o.share_pct, head.agreed, tol)]}>{pct(o.share_pct)}</td></tr>
              ))}</tbody>
            </table></div>
            <p className="note">Export CSV (top right) gives every order in the period with all fourteen columns.</p>
          </div>
        </>
      )}
    </>
  );
}
