// Admin · Requests: every request across departments with its derived state.
// GET-form filters (shareable URLs) and CSV, the OMS reports pattern.
import { spine } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const STATES = ['all', 'open', 'partial', 'fulfilled', 'cancelled'] as const;
const CHIP: Record<string, string> = {
  open: 'st-open', partial: 'st-partial', fulfilled: 'st-done', cancelled: 'st-cancel',
};
const LABEL: Record<string, string> = {
  open: 'Waiting', partial: 'Part sent', fulfilled: 'Done', cancelled: 'Closed',
};
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));
const clock = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

export default async function AdminRequestsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const state = (STATES as readonly string[]).includes(one(sp.state)) ? one(sp.state) : 'all';

  const db = spine();
  const { data: depts } = await db
    .from('department_settings').select('sort_order, locations(code, name)').eq('active', true).order('sort_order');
  const deptOptions = (depts ?? []).map((d: any) => ({ code: d.locations.code, name: d.locations.name }));
  const maker = deptOptions.some((d) => d.code === one(sp.maker)) ? one(sp.maker) : '';

  let q = db.from('v_request_status').select('*').order('entered_at', { ascending: false }).limit(200);
  if (state !== 'all') q = q.eq('state', state);
  if (maker) q = q.eq('maker_code', maker);
  const { data: reqs } = await q;
  const { data: counts } = await db.from('v_request_status').select('state');
  const countBy = (s: string) => (counts ?? []).filter((r: any) => r.state === s).length;
  const qs = new URLSearchParams({ ...(state !== 'all' ? { state } : {}), ...(maker ? { maker } : {}) });

  return (
    <>
      <div className="adminhead">
        <span className="title">Purchase requests</span>
        <span className="blurb">internal purchase requests between departments · state is derived from the linked transfers, never typed</span>
        <span className="headright"><a className="csvlink" href={`/admin/requests/csv?${qs}`}>Download CSV</a></span>
      </div>
      <div className="adminbody">
        <div className="statgrid">
          <div className="statcard"><div className="k">Waiting</div><div className="v">{countBy('open')}</div><div className="s">nothing sent yet</div></div>
          <div className="statcard"><div className="k">Part sent</div><div className="v">{countBy('partial')}</div><div className="s">some quantity still to go</div></div>
          <div className="statcard"><div className="k">Done</div><div className="v">{countBy('fulfilled')}</div><div className="s">sent in full</div></div>
          <div className="statcard"><div className="k">Closed</div><div className="v">{countBy('cancelled')}</div><div className="s">withdrawn or declined, reason kept</div></div>
        </div>

        <form method="get" className="filterbar">
          <label>State
            <select name="state" defaultValue={state} style={{ minWidth: 130 }}>
              {STATES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All states' : LABEL[s]}</option>)}
            </select>
          </label>
          <label>Asked of
            <select name="maker" defaultValue={maker} style={{ minWidth: 150 }}>
              <option value="">Any department</option>
              {deptOptions.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
            </select>
          </label>
          <button className="ghostbtn" type="submit">Apply</button>
        </form>

        <div className="tablewrap admincard">
          <table className="sheet slim" style={{ border: 'none' }}>
            <thead><tr>
              <th>#</th><th>State</th><th>Item</th><th className="num">Asked</th><th className="num">Sent</th>
              <th>By</th><th>From (maker)</th><th>Needed by</th><th>Raised</th><th>Closed reason</th>
            </tr></thead>
            <tbody>
              {(reqs ?? []).length === 0 && (
                <tr><td colSpan={10} className="unit" style={{ padding: 16 }}>No requests match these filters.</td></tr>
              )}
              {(reqs ?? []).map((r: any) => (
                <tr key={r.id}>
                  <td className="unit">#{r.id}</td>
                  <td><span className={`stchip ${CHIP[r.state]}`}>{LABEL[r.state]}</span></td>
                  <td className="name">{r.sku_name} <small className="unit">{r.uom}</small></td>
                  <td className="num">{fmt(Number(r.requested_qty))}</td>
                  <td className="num">{fmt(Number(r.sent_qty))}</td>
                  <td>{r.requester_name}</td>
                  <td>{r.maker_name}</td>
                  <td className="unit">{r.needed_by ?? ''}</td>
                  <td className="unit">{clock(r.entered_at)} · {r.entered_by}</td>
                  <td className="unit">{r.cancel_reason ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
