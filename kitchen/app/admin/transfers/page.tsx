// Admin · Transfers: the discrepancy register (sent vs received, both names)
// and everything still waiting for a receiver's confirmation. GET-form filters
// and CSV, the OMS reports pattern.
import { spine } from '@/lib/supabase/server';
import { istCalendarDate, ymdAddDays } from '@/lib/business-day';

export const dynamic = 'force-dynamic';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));
const clock = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' });

export default async function AdminTransfersPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const db = spine();

  const { data: allDepts } = await db.from('locations').select('code, name')
    .in('type', ['kitchen_department', 'assembly_spoke']).order('name');
  const deptOptions = allDepts ?? [];
  const dept = deptOptions.some((d) => d.code === one(sp.dept)) ? one(sp.dept) : '';
  const deptName = deptOptions.find((d) => d.code === dept)?.name ?? '';

  const today = istCalendarDate(new Date());
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const from = ymd.test(one(sp.from)) ? one(sp.from) : ymdAddDays(today, -13);
  const to = ymd.test(one(sp.to)) ? one(sp.to) : today;

  let mq = db.from('v_transfer_mismatches').select('*')
    .gte('business_date', from).lte('business_date', to)
    .order('received_at', { ascending: false }).limit(200);
  let pq = db.from('v_pending_receipts').select('*')
    .gte('business_date', from).lte('business_date', to)
    .order('sent_at', { ascending: false }).limit(200);
  if (dept) {
    mq = mq.or(`from_name.eq.${deptName},to_name.eq.${deptName}`);
    pq = pq.eq('to_code', dept);
  }
  const [{ data: mismatches }, { data: pending }] = await Promise.all([mq, pq]);
  const qs = new URLSearchParams({ from, to, ...(dept ? { dept } : {}) });

  return (
    <>
      <div className="adminhead">
        <span className="title">Transfers</span>
        <span className="blurb">differences between sent and received, and sends still waiting for confirmation</span>
        <span className="headright"><a className="csvlink" href={`/admin/transfers/csv?${qs}`}>Download CSV</a></span>
      </div>
      <div className="adminbody">
        <form method="get" className="filterbar">
          <label>Location
            <select name="dept" defaultValue={dept} style={{ minWidth: 170 }}>
              <option value="">Any location</option>
              {deptOptions.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
            </select>
          </label>
          <label>from <input type="date" name="from" defaultValue={from} /></label>
          <label>to <input type="date" name="to" defaultValue={to} /></label>
          <button className="ghostbtn" type="submit">Apply</button>
        </form>

        <div className="statgrid">
          <div className="statcard"><div className="k">Differences</div><div className="v">{(mismatches ?? []).length}</div><div className="s">received ≠ sent, both names kept</div></div>
          <div className="statcard"><div className="k">Unconfirmed</div><div className="v">{(pending ?? []).length}</div><div className="s">sent, receiver yet to confirm</div></div>
        </div>

        <div className="adminsect">
          <div className="eyebrow">Differences (received ≠ sent)</div>
          <div className="tablewrap admincard">
            <table className="sheet slim" style={{ border: 'none' }}>
              <thead><tr>
                <th>Day</th><th>Item</th><th>Route</th>
                <th className="num">Sent</th><th className="num">Received</th><th className="num">Difference</th>
                <th>Sent by</th><th>Confirmed by</th><th>When</th>
              </tr></thead>
              <tbody>
                {(mismatches ?? []).length === 0 && (
                  <tr><td colSpan={9} className="unit" style={{ padding: 16 }}>No differences in this range. Every confirmed transfer matched.</td></tr>
                )}
                {(mismatches ?? []).map((m: any) => (
                  <tr key={m.production_log_id}>
                    <td className="unit">{m.business_date}</td>
                    <td className="name">{m.sku_name} <small className="unit">{m.uom}</small></td>
                    <td>{m.from_name} → {m.to_name}</td>
                    <td className="num">{fmt(Number(m.sent_qty))}</td>
                    <td className="num">{fmt(Number(m.received_qty))}</td>
                    <td className="num neg">{fmt(Number(m.difference))}</td>
                    <td className="unit">{m.sent_by}</td>
                    <td className="unit">{m.received_by}</td>
                    <td className="unit">{clock(m.received_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="adminsect">
          <div className="eyebrow">Waiting for the receiver</div>
          <div className="tablewrap admincard">
            <table className="sheet slim" style={{ border: 'none' }}>
              <thead><tr>
                <th>Day</th><th>Item</th><th>Route</th><th className="num">Sent</th><th>Sent by</th><th>When</th>
              </tr></thead>
              <tbody>
                {(pending ?? []).length === 0 && (
                  <tr><td colSpan={6} className="unit" style={{ padding: 16 }}>Nothing waiting in this range.</td></tr>
                )}
                {(pending ?? []).map((p: any) => (
                  <tr key={p.production_log_id}>
                    <td className="unit">{p.business_date}</td>
                    <td className="name">{p.sku_name} <small className="unit">{p.uom}</small></td>
                    <td>{p.from_name} → {p.to_name}</td>
                    <td className="num">{fmt(Number(p.sent_qty))}</td>
                    <td className="unit">{p.sent_by}</td>
                    <td className="unit">{clock(p.sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            A send to a department with a screen (Sponges, Liquids) waits for their one-tap confirm. Sends to
            Cakes, Desserts and the spokes stay here until those screens exist; they are counted as sent in the ledger meanwhile.
          </p>
        </div>
      </div>
    </>
  );
}
