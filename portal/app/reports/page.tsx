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
      {/* This used to promise that customer names and phone numbers were never included.
          That stopped being true with the decision of 24 July 2026 (see lib/reports.ts:
          the order report exports customer_name and customer_phone, the item report adds
          customer_address). People were downloading personal data on the strength of a
          promise that it was absent, so the copy now says the opposite. Keep this warning
          in step with the columns in lib/reports.ts. */}
      <p className="hint">
        Clean CSV, straight from the spine. One download covers up to {MAX_RANGE_DAYS} days.
      </p>
      <p className="hint warn">
        The order, item and finance reports contain customer personal data: names, phone
        numbers and, on the item and finance reports, delivery addresses. Treat the file as
        confidential and do not share it outside the company.
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
