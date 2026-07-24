import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { listDashboards, prettyDate } from '@/lib/dashboards';
import TopBar from '@/app/TopBar';

// The archive: every daily dashboard, newest first. Click a day to open it.
export default async function DashboardsPage() {
  const user = await requireUser();
  const all = await listDashboards();

  return (
    <main>
      <TopBar user={user} />
      <h1 className="page">Daily dashboards</h1>
      <p className="hint">The Zomato and Swiggy sales dashboard, one per business day. Newest first.</p>

      {all.length === 0 ? (
        <div className="empty">
          No dashboards yet. The first one appears here after the next 8 AM run.
        </div>
      ) : (
        <>
          <p style={{ margin: '0 2px 14px' }}>
            <Link className="ghostbtn" href={`/dashboards/${all[0].date}`}>
              Open the latest ({prettyDate(all[0].date)})
            </Link>
          </p>
          <table className="sheet">
            <thead>
              <tr><th>Business day</th><th>Open</th></tr>
            </thead>
            <tbody>
              {all.map((d) => (
                <tr key={d.date}>
                  <td className="name">{prettyDate(d.date)}</td>
                  <td><Link href={`/dashboards/${d.date}`}>View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
