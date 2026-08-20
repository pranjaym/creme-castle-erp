// Admin · Day ledger: the management view of every department's day, any date
// range. Filter bar is a GET form (shareable URLs), the table downloads as CSV
// (the OMS reports pattern). Consumption/gap is derived, never entered.
import { spine } from '@/lib/supabase/server';
import { istCalendarDate, ymdAddDays } from '@/lib/business-day';

export const dynamic = 'force-dynamic';

const fmt = (n: number | null) => (n == null ? '' : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

export default async function AdminLedgerPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const db = spine();

  const { data: depts } = await db
    .from('department_settings').select('sort_order, locations(code, name)').eq('active', true).order('sort_order');
  const deptOptions = (depts ?? []).map((d: any) => ({ code: d.locations.code, name: d.locations.name }));

  const today = istCalendarDate(new Date());
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  const from = ymd.test(one(sp.from)) ? one(sp.from) : ymdAddDays(today, -1);
  const to = ymd.test(one(sp.to)) ? one(sp.to) : today;
  const dept = deptOptions.some((d) => d.code === one(sp.dept)) ? one(sp.dept) : '';

  let q = db.from('v_dept_day_ledger').select('*')
    .gte('business_date', from).lte('business_date', to)
    .order('business_date', { ascending: false }).order('dept_code').order('sku_code').limit(1000);
  if (dept) q = q.eq('dept_code', dept);
  const { data: rows } = await q;

  const qs = new URLSearchParams({ from, to, ...(dept ? { dept } : {}) });
  const totalGaps = (rows ?? []).filter((r: any) => r.gap != null && Number(r.gap) !== 0).length;

  // group rows by date + dept for readable sections
  const groups: { key: string; date: string; deptName: string; rows: any[] }[] = [];
  for (const r of rows ?? []) {
    const key = `${r.business_date}|${r.dept_code}`;
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, date: r.business_date, deptName: r.dept_code, rows: [] }; groups.push(g); }
    g.rows.push(r);
  }
  const deptName = (code: string) => deptOptions.find((d) => d.code === code)?.name ?? code;

  return (
    <>
      <div className="adminhead">
        <span className="title">Day ledger</span>
        <span className="blurb">plan vs actual, and: opening + made + in - out - waste - closing = gap · a non-zero gap is a miscount or an unlogged movement</span>
        <span className="headright">
          <a className="csvlink" href={`/admin/ledger/csv?${qs}`}>Download CSV</a>
        </span>
      </div>
      <div className="adminbody">
        <form method="get" className="filterbar">
          <label>Department
            <select name="dept" defaultValue={dept} style={{ minWidth: 150 }}>
              <option value="">All departments</option>
              {deptOptions.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
            </select>
          </label>
          <label>from <input type="date" name="from" defaultValue={from} /></label>
          <label>to <input type="date" name="to" defaultValue={to} /></label>
          <button className="ghostbtn" type="submit">Apply</button>
          {totalGaps > 0 && <span className="stchip st-open">{totalGaps} gap{totalGaps === 1 ? '' : 's'} in this range</span>}
        </form>

        {groups.length === 0 && <p className="hint">Nothing in this range. Widen the dates or clear the department filter.</p>}
        {groups.map((g) => (
          <div className="adminsect" key={g.key}>
            <div className="eyebrow">{g.date} · {deptName(g.deptName)}</div>
            <div className="tablewrap admincard">
              <table className="sheet slim" style={{ border: 'none' }}>
                <thead><tr>
                  <th>Item</th><th className="num">Plan</th><th className="num">Open</th><th className="num">Made</th><th className="num">In</th>
                  <th className="num">Out</th><th className="num">Waste</th><th className="num">Close</th><th className="num">Gap</th>
                </tr></thead>
                <tbody>
                  {g.rows.map((r: any) => (
                    <tr key={r.sku_code}>
                      <td className="name">{r.sku_name} <small className="unit">{r.uom}</small></td>
                      <td className="num">{fmt(r.planned != null ? Number(r.planned) : null)}</td>
                      <td className="num">{fmt(r.opening != null ? Number(r.opening) : null)}</td>
                      <td className="num">{fmt(Number(r.made)) || ''}</td>
                      <td className="num">{fmt(Number(r.received)) || ''}{Number(r.receipts_pending) > 0 && <span className="penddot" title="includes unconfirmed">•</span>}</td>
                      <td className="num">{fmt(Number(r.sent)) || ''}</td>
                      <td className="num">{fmt(Number(r.wasted)) || ''}</td>
                      <td className="num">{fmt(r.closing != null ? Number(r.closing) : null)}</td>
                      <td className={`num ${r.gap != null && Number(r.gap) !== 0 ? 'neg' : ''}`}>{r.gap != null ? fmt(Number(r.gap)) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
