import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { getDashboardHtml, prettyDate } from '@/lib/dashboards';
import TopBar from '@/app/TopBar';

// View one day's dashboard. The self-contained HTML is served, gated, by the
// sibling /view route and shown in an iframe so its own styles stay sandboxed.
export default async function DashboardView({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const user = await requireUser();
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  // Confirm it exists (and fail to a 404 rather than an empty frame).
  const html = await getDashboardHtml(date);
  if (html === null) notFound();

  return (
    <main>
      <TopBar user={user} />
      <div className="frameback">
        <Link className="ghostbtn" href="/dashboards">All dashboards</Link>
        <span style={{ marginLeft: 12, color: 'var(--muted)' }}>{prettyDate(date)}</span>
      </div>
      <iframe className="dash" src={`/dashboards/${date}/view`} title={`Dashboard ${date}`} />
    </main>
  );
}
