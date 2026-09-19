import Link from 'next/link';
import { requireUser, couponPerms } from '@/lib/session';
import { glossaryRows, inr, pct, num, dateLabel, type GlossaryRow } from '@/lib/coupons';
import { Tag, Agreed, Tabs, Flash } from '../ui';
import { saveCoupon } from '../actions';

// The glossary: every coupon name the platforms have printed on an order, what
// it does, who it is for. The first columns fill themselves from the data every
// night; "what it is", "for whom" and "segment" are typed once and kept.
export const dynamic = 'force-dynamic';

const KINDS = [['', 'kind'], ['percent', '% code'], ['flat', 'Flat off'], ['flat_percent', 'Flat % off'], ['bogo', 'Buy 1 get 1'], ['payment', 'Payment offer'], ['other', 'Other']];
const WHOM = ['', 'New user', 'Repeat user', 'All users', 'New to platform', 'High RTR'];
const SEG = ['', 'LA/MM', 'UM', 'All'];

export default async function GlossaryPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; all?: string; p?: string; q?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const canEdit = couponPerms(user).edit;
  let rows = await glossaryRows();
  if (sp.p === 'zomato' || sp.p === 'swiggy') rows = rows.filter(r => r.platform === sp.p);
  if (sp.q) { const s = sp.q.toLowerCase(); rows = rows.filter(r => r.code.toLowerCase().includes(s) || (r.what_it_is ?? '').toLowerCase().includes(s) || (r.constructs ?? '').toLowerCase().includes(s)); }
  const showAll = sp.all === '1' || !!sp.q;
  const main = showAll ? rows : rows.filter(r => r.n28 >= 10);
  const hidden = rows.length - main.length;
  const untyped = rows.filter(r => r.n28 >= 40 && !r.for_whom);
  const back = '/coupons/glossary' + (sp.all ? '?all=1' : '');

  return (
    <>
      <h1 className="page">Coupon glossary</h1>
      <p className="hint">
        One row per coupon name per platform. Zomato prints both the name (GET175) and what it does (Flat Rs.175 off) on every order, and the deal follows the <b>name</b>.
        Swiggy prints the code but not what it does, so that column is typed from the discount sheet. A name seen for the first time lands here by itself.
      </p>
      <Tabs on="glossary" />
      <Flash ok={sp.ok} err={sp.err} />

      <div className="kpis">
        <div className="kpi"><div className="l">Names in the book</div><div className="v">{num(rows.length)}</div><div className="d">{rows.filter(r => r.platform === 'zomato').length} Zomato, {rows.filter(r => r.platform === 'swiggy').length} Swiggy</div></div>
        <div className="kpi"><div className="l">Active last 28 days</div><div className="v">{num(rows.filter(r => r.n28 > 0).length)}</div><div className="d">{num(rows.filter(r => r.n28 >= 40).length)} with 40+ orders</div></div>
        <div className={'kpi' + (untyped.length ? ' hot' : '')}><div className="l">Waiting to be typed</div><div className="v">{num(untyped.length)}</div><div className="d">busy names with no &ldquo;for whom&rdquo; yet</div></div>
        <div className="kpi"><div className="l">With a deal recorded</div><div className="v">{num(rows.filter(r => r.agreed != null).length)}</div><div className="d"><Link href="/coupons/deals">record deals</Link></div></div>
      </div>

      <form method="get" action="/coupons/glossary" className="filterbar">
        <label>Search<input type="text" name="q" defaultValue={sp.q ?? ''} placeholder="name or what it is" /></label>
        <label>Platform
          <select name="p" defaultValue={sp.p ?? ''}><option value="">Both</option><option value="zomato">Zomato</option><option value="swiggy">Swiggy</option></select>
        </label>
        <label className="small" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, textTransform: 'none' }}><input type="checkbox" name="all" value="1" defaultChecked={showAll} /> show every name, including rare ones</label>
        <button className="btn btn-primary" type="submit">Apply</button>
      </form>

      <div className="scroll-x"><table className="sheet">
        <thead><tr><th></th><th>Name</th><th>What it is</th><th>Type</th><th>For whom</th><th>Segment</th><th className="num">Orders, 28d</th><th className="num">Our share</th><th className="num">Min bill</th><th className="num">Outlets</th><th>First seen</th><th className="num">Agreed</th><th>Status</th>{canEdit ? <th></th> : null}</tr></thead>
        <tbody>{main.map(r => <Row key={r.id} r={r} canEdit={canEdit} back={back} />)}</tbody>
      </table></div>
      {hidden > 0 ? <p className="note">{hidden} names with fewer than 10 orders in the last 28 days are hidden. <Link href="/coupons/glossary?all=1">Show every name</Link>.</p> : null}
      <p className="note">Type: the module reads it from the construct where it can. Min bill is the smallest bill this coupon fired on in 28 days, which is the practical minimum order value. Zomato names under 10 orders are mostly stacked payment offers (PAYTMUPI, AMZNPAY3) that carry no restaurant share.</p>
    </>
  );
}

function Row({ r, canEdit, back }: { r: GlossaryRow; canEdit: boolean; back: string }) {
  const what = r.platform === 'zomato' && r.constructs ? r.constructs : r.what_it_is;
  const cells = (
    <>
      <td><Tag p={r.platform} /></td>
      <td className="name"><Link href={`/coupons/c/${r.platform}/${encodeURIComponent(r.code)}`}>{r.code}</Link></td>
    </>
  );
  const stats = (
    <>
      <td className="num">{num(r.n28)}</td>
      <td className="num">{pct(r.share28)}</td>
      <td className="num">{r.min_bill == null ? '' : '₹' + Math.round(r.min_bill)}</td>
      <td className="num">{r.outlets28 || ''}</td>
      <td className="small">{r.first_seen ? dateLabel(r.first_seen) : ''}</td>
      <td className="num"><Agreed v={r.agreed} /></td>
      <td><span className={'chip ' + (r.status === 'new' ? 'c-amber' : r.status === 'retired' ? 'c-grey' : 'c-ok')}>{r.status}</span></td>
    </>
  );
  if (!canEdit) {
    return <tr>{cells}<td className="wrap small">{what ?? <span className="muted">not typed yet</span>}</td><td className="small">{r.kind ?? ''}</td><td className="small">{r.for_whom ?? <span className="fill">you fill</span>}</td><td className="small">{r.segment ?? ''}</td>{stats}</tr>;
  }
  const fid = `g${r.id}`;
  return (
    <tr>
      {cells}
      <td className="wrap small">
        {r.platform === 'zomato' && r.constructs ? <div className="small">{r.constructs}</div> : null}
        <input form={fid} type="text" name="what_it_is" defaultValue={r.what_it_is ?? ''} placeholder={r.platform === 'swiggy' ? 'e.g. Flat 150, MOV 499 to 649' : 'note, optional'} style={{ height: 30, fontSize: 12.5, width: 220 }} />
      </td>
      <td><select form={fid} name="kind" defaultValue={r.kind ?? ''} style={{ height: 30, fontSize: 12.5 }}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
      <td><select form={fid} name="for_whom" defaultValue={r.for_whom ?? ''} style={{ height: 30, fontSize: 12.5 }}>{WHOM.map(v => <option key={v} value={v}>{v || 'for whom'}</option>)}</select></td>
      <td><select form={fid} name="segment" defaultValue={r.segment ?? ''} style={{ height: 30, fontSize: 12.5 }}>{SEG.map(v => <option key={v} value={v}>{v || 'segment'}</option>)}</select></td>
      {stats}
      <td>
        <form id={fid} action={saveCoupon} className="inline">
          <input type="hidden" name="platform" value={r.platform} /><input type="hidden" name="code" value={r.code} /><input type="hidden" name="back" value={back} />
          <select name="status" defaultValue={r.status === 'new' ? 'active' : r.status} style={{ height: 30, fontSize: 12.5 }}><option value="active">active</option><option value="retired">retired</option></select>
          <button className="smallbtn" type="submit">Save</button>
        </form>
      </td>
    </tr>
  );
}
