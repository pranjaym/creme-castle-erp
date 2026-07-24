import { requireUser } from '@/lib/session';
import { REPORTS, MAX_RANGE_DAYS } from '@/lib/reports';
import TopBar from '@/app/TopBar';

// Yesterday and a week before, in IST, as YYYY-MM-DD, for sensible defaults.
function istYmd(offsetDays: number): string {
  const nowIst = new Date(Date.now() + 5.5 * 3600_000);
  nowIst.setUTCDate(nowIst.getUTCDate() + offsetDays);
  return nowIst.toISOString().slice(0, 10);
}

export default async function ReportsPage() {
  const user = await requireUser();
  const to = istYmd(-1);
  const from = istYmd(-7);

  return (
    <main>
      <TopBar user={user} />
      <h1 className="page">Download reports</h1>
      <p className="hint">
        Clean CSV, straight from the spine. Customer names and phone numbers are never included.
        One download covers up to {MAX_RANGE_DAYS} days.
      </p>

      <form action="/reports/download" method="get" className="card" style={{ maxWidth: 520 }}>
        <label className="fld" htmlFor="report">Report</label>
        <select className="txt" id="report" name="report" defaultValue="order">
          {Object.values(REPORTS).map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </select>

        <div className="row" style={{ marginTop: 4 }}>
          <div>
            <label className="fld" htmlFor="from">From</label>
            <input className="txt" id="from" name="from" type="date" defaultValue={from} required />
          </div>
          <div>
            <label className="fld" htmlFor="to">To</label>
            <input className="txt" id="to" name="to" type="date" defaultValue={to} required />
          </div>
        </div>

        <button className="primary" type="submit" style={{ marginTop: 20 }}>Download CSV</button>
        <div className="note">Dates are the business day (04:00 to 03:59 IST) the spine stamps.</div>
      </form>
    </main>
  );
}
