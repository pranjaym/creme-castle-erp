import Link from 'next/link';
import { requireUser } from '@/lib/session';
import TopBar from '@/app/TopBar';

// Home: the two Phase 1 destinations. More tiles land here as modules are added.
export default async function Home() {
  const user = await requireUser();
  return (
    <main>
      <TopBar user={user} />
      <h1 className="page">Welcome, {user.fullName || user.email}</h1>
      <p className="hint">Everything here reads from the spine, the one canonical database.</p>
      <div className="tiles">
        <Link className="tile" href="/dashboards">
          <div className="t">Daily dashboards</div>
          <div className="d">The Zomato and Swiggy sales dashboard: latest day and the full archive.</div>
        </Link>
        <Link className="tile" href="/reports">
          <div className="t">Download reports</div>
          <div className="d">Order and item reports as clean CSV, for any date or range.</div>
        </Link>
      </div>
    </main>
  );
}
