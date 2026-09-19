import Link from 'next/link';
import { requireUser, couponPerms } from '@/lib/session';
import { deals, glossaryRows, currentUpload, uploadVsLive, tolerance, recentEvents, parseFilters, inr, pct, num, dateLabel, outlets, type UploadGrid } from '@/lib/coupons';
import { Tag, Agreed, Tabs, Flash } from '../ui';
import { setDeal, setTolerance } from '../actions';

// Deals and uploads: what we agreed on sharing (one line per coupon name, the
// most we pay, optionally per outlet), what we uploaded (the team's discount
// sheet, as it is), the check between the sheet and what actually fired, and
// the tolerance. A new deal supersedes the old one; nothing is deleted.
export const dynamic = 'force-dynamic';

export default async function DealsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const canEdit = couponPerms(user).edit;
  const f = parseFilters(sp);
  const [open, history, gl, zUp, sUp, check, tol, events, outletList] = await Promise.all([
    deals(false), deals(true), glossaryRows(), currentUpload('zomato'), currentUpload('swiggy'), uploadVsLive(f), tolerance(), recentEvents(25), outlets(),
  ]);
  const waiting = gl.filter(r => r.n28 >= 40 && r.agreed == null).sort((a, b) => b.ours28 - a.ours28);
  const who = (r: { platform: string; code: string }) => gl.find(g => g.platform === r.platform && g.code === r.code);

  return (
    <>
      <h1 className="page">Deals and uploads</h1>
      <p className="hint">
        Two things live here. <b>What we agreed</b>: one line per coupon name, the most we pay as a share of the discount, never guessed from the data.
        <b> What we uploaded</b>: the discount sheet, one row per outlet, one column per user type. And a check between the sheet and what actually fired.
      </p>
      <Tabs on="deals" />
      <Flash ok={sp.ok} err={sp.err} />

      <div className="card">
        <h2>Agreed deals <span className="subtle">{open.length} open, {history.length - open.length} superseded</span></h2>
        <div className="scroll-x"><table className="sheet">
          <thead><tr><th></th><th>Coupon</th><th>What it is</th><th>Where</th><th className="num">Most we pay</th><th>From</th><th>Agreed with</th><th>Note</th><th>Recorded by</th></tr></thead>
          <tbody>{open.map(d => (
            <tr key={d.id}>
              <td><Tag p={d.platform} /></td>
              <td className="name"><Link href={`/coupons/c/${d.platform}/${encodeURIComponent(d.code)}`}>{d.code}</Link></td>
              <td className="wrap small">{who(d)?.constructs ?? d.what_it_is ?? ''}</td>
              <td className="small">{d.outlet_code ? d.outlet_code.replace('CC-', '') : 'every outlet'}</td>
              <td className="num"><b>{d.max_our_share_pct}%</b></td>
              <td className="small">{dateLabel(d.effective_from)}</td>
              <td className="small">{d.agreed_with ?? ''}</td>
              <td className="wrap small">{d.note ?? ''}</td>
              <td className="small muted">{d.created_by ?? ''}</td>
            </tr>
          ))}
          {open.length === 0 ? <tr><td colSpan={9} className="muted">No deals recorded yet. Until a coupon has a deal, its rows show amber and nothing can go red.</td></tr> : null}
          </tbody>
        </table></div>
        {canEdit ? (
          <form action={setDeal} className="inline" style={{ marginTop: 12 }}>
            <input type="hidden" name="back" value="/coupons/deals" />
            <select name="platform" defaultValue="zomato"><option value="zomato">Zomato</option><option value="swiggy">Swiggy</option></select>
            <input className="w120" type="text" name="code" placeholder="coupon name" required list="couponnames" />
            <datalist id="couponnames">{gl.filter(g => g.n28 > 0).map(g => <option key={g.platform + g.code} value={g.code}>{g.platform}</option>)}</datalist>
            <select name="outlet" defaultValue=""><option value="">every outlet</option>{outletList.map(o => <option key={o.code} value={o.code}>{o.code.replace('CC-', '')}</option>)}</select>
            <input className="w60" type="number" name="pct" step="0.1" min="0" max="100" placeholder="% ours" required />
            <input type="date" name="from" defaultValue={new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })} />
            <input className="w120" type="text" name="agreed_with" placeholder="agreed with" />
            <input className="w200" type="text" name="note" placeholder="note" />
            <button className="btn btn-primary" type="submit">Record deal</button>
          </form>
        ) : <p className="note">Only an editor (admin, or the coupons:editor grant) records deals.</p>}
        <p className="note">A new line for the same coupon and scope supersedes the previous one from its date; the old line stays in the history. An outlet-specific deal wins over the network-wide one for that outlet.</p>
      </div>

      <div className="card">
        <h2>Waiting for a deal <span className="subtle">busy coupons with nothing recorded</span></h2>
        <div className="scroll-x"><table className="sheet">
          <thead><tr><th></th><th>Coupon</th><th>What it is</th><th className="num">Orders, 28d</th><th className="num">We paid, 28d</th><th className="num">Our share, 28d</th><th>First seen</th></tr></thead>
          <tbody>{waiting.map(r => (
            <tr key={r.id}><td><Tag p={r.platform} /></td><td className="name"><Link href={`/coupons/c/${r.platform}/${encodeURIComponent(r.code)}`}>{r.code}</Link></td>
              <td className="wrap small">{r.constructs ?? r.what_it_is ?? ''}</td><td className="num">{num(r.n28)}</td><td className="num">{inr(r.ours28)}</td><td className="num">{pct(r.share28)}</td><td className="small">{r.first_seen ? dateLabel(r.first_seen) : ''}</td></tr>
          ))}
          {waiting.length === 0 ? <tr><td colSpan={7} className="muted">Every coupon with 40+ orders in the last 28 days has a deal recorded.</td></tr> : null}
          </tbody>
        </table></div>
        <p className="note">The observed share is shown to help, not to be copied blindly: a coupon can have been running off-deal for weeks. Record what was agreed.</p>
      </div>

      <div className="card">
        <h2>Tolerance</h2>
        <p className="note" style={{ marginTop: 0 }}>
          Zomato pays in whole rupees, so 70% of a Rs 125 discount shows as Rs 87 (69.6%) rather than Rs 87.50. Tolerance is how far from the agreed number still counts as the agreed number.
          Current: <b>{tol} points</b>. Wider than 1 point starts hiding real drift; zero drowns the page in rounding.
        </p>
        {canEdit ? (
          <form action={setTolerance} className="inline">
            <input className="w60" type="number" name="tolerance" step="0.1" min="0" max="10" defaultValue={tol} />
            <button className="smallbtn" type="submit">Save</button>
          </form>
        ) : null}
      </div>

      {[zUp, sUp].map(up => up ? <UploadCard key={up.head.platform} up={up} /> : null)}

      {check ? (
        <div className="card">
          <h2>Uploaded versus live, Zomato <span className="subtle">{dateLabel(f.from)} to {dateLabel(f.to)}</span></h2>
          <p className="note" style={{ marginTop: 0 }}>
            Across the {check.matched} sheet outlets that match the outlet master: <b>{check.unexpected}</b> constructs fired that the sheet does not list, <b>{check.silent}</b> sheet constructs did not fire.
            Rows with something to say first.
          </p>
          <div className="scroll-x"><table className="sheet">
            <thead><tr><th>Outlet</th><th>Fired but not in the sheet <span className="tiny">(orders)</span></th><th>In the sheet, did not fire</th></tr></thead>
            <tbody>{[...check.rows].sort((a, b) => (b.unexpected.length + b.silent.length) - (a.unexpected.length + a.silent.length)).map(r => (
              <tr key={r.outlet_code}>
                <td className="name">{r.outlet_code.replace('CC-', '')}</td>
                <td className="wrap small">{r.unexpected.length ? r.unexpected.slice(0, 6).map((u, i) => <span key={u.construct}>{i ? ', ' : ''}{u.construct} <span className="tiny">({u.n})</span></span>) : <span className="muted">none</span>}</td>
                <td className="wrap small">{r.silent.length ? r.silent.slice(0, 6).join(', ') : <span className="muted">none</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <p className="note">Only constructs with 5+ orders at the outlet count as &ldquo;fired&rdquo;. Swiggy has no such check yet: its orders carry the code, not the construct.</p>
        </div>
      ) : null}

      <div className="card">
        <h2>Recent changes</h2>
        <div className="scroll-x"><table className="sheet">
          <thead><tr><th>When</th><th>What</th><th>Detail</th><th>Who</th></tr></thead>
          <tbody>{events.map((e, i) => (
            <tr key={i}><td className="small muted">{String(e.at).slice(0, 16).replace('T', ' ')}</td><td className="small">{e.entity} {e.action}</td>
              <td className="wrap small">{e.data ? Object.entries(e.data).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}: ${v}`).join(' · ') : ''}</td><td className="small muted">{e.actor ?? ''}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
    </>
  );
}

function UploadCard({ up }: { up: UploadGrid }) {
  // group headings span their columns, as on the sheet
  const groups: { title: string; span: number }[] = [];
  for (const c of up.cols) {
    const t = c.slot_group ?? '';
    if (groups.length && groups[groups.length - 1].title === t) groups[groups.length - 1].span++; else groups.push({ title: t, span: 1 });
  }
  const rows = up.rows;
  return (
    <div className="card">
      <h2>What we uploaded: <Tag p={up.head.platform} />{up.head.platform === 'zomato' ? 'Zomato' : 'Swiggy'} <span className="subtle">&ldquo;{up.head.label}&rdquo; · {rows.length} outlets · loaded {String(up.head.uploaded_at).slice(0, 10)} by {up.head.uploaded_by ?? ''}</span></h2>
      <div className="scroll-x"><table className="sheet">
        <thead>
          <tr><th rowSpan={2}>Outlet</th>{groups.map((g, i) => <th key={i} colSpan={g.span} className="grp">{g.title}</th>)}</tr>
          <tr>{up.cols.map(c => <th key={c.col_no}>{c.slot ?? ''}</th>)}</tr>
        </thead>
        <tbody>{rows.map(r => (
          <tr key={r.outlet_code}><td className="name">{r.outlet_code.replace('CC-', '')}</td>{up.cols.map(c => <td key={c.col_no} className="cell">{r.cells[c.col_no] ?? ''}</td>)}</tr>
        ))}</tbody>
      </table></div>
      <p className="note">The sheet as the team keeps it. A new version is loaded with <span className="mono">kitchen/workers/coupons/import_sheet.py</span>; the previous version is kept, never overwritten.</p>
    </div>
  );
}
