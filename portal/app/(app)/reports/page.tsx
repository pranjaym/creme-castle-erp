import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { REPORTS, REPORT_GROUPS } from '@/lib/reports';

// The reports hub: cards grouped in sections, the OMS finance-reports pattern.
// Every live dataset in the spine has a card; a card opens the report page
// with a date range, a preview, and the download. Management roles only.
export default async function ReportsHub() {
  const user = await requireUser();
  if (!['admin', 'central', 'viewer'].includes(user.role)) redirect('/');

  const defs = Object.values(REPORTS);
  return (
    <main>
      <h1 className="page">Reports</h1>
      <p className="hint">
        Every live dataset in the spine, downloadable as CSV. Pick a report, choose the dates,
        preview, download.
      </p>
      {REPORT_GROUPS.map(group => {
        const inGroup = defs.filter(d => d.group === group);
        if (!inGroup.length) return null;
        return (
          <div key={group}>
            <div className="rptgroup">{group}</div>
            <div className="rptgrid">
              {inGroup.map(d => (
                <Link key={d.key} className="rptcard" href={`/reports/${d.key}`}>
                  <div className="t">{d.label}</div>
                  <div className="d">{d.desc}</div>
                  <div className="m">{d.columns.length} columns{d.dateless ? ' · whole table' : ' · by date range'}</div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
      <p className="note" style={{ marginTop: 20 }}>
        Data honesty: Zomato restates its last 3 days; ads restate longer. Kitchen preparation
        time is excluded everywhere (verified as meaningless). Petpooja stock figures are raw
        history, not trustworthy stock-on-hand.
      </p>
    </main>
  );
}
