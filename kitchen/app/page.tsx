// Kitchen home, role-aware. A department account goes straight to its own
// screen (the floor tablet never sees a menu); management roles get the hub.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { spine } from '@/lib/supabase/server';
import { istCalendarDate, weekdayForYmd } from '@/lib/business-day';
import { requireKitchenUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await requireKitchenUser();
  if (user.role === 'department' && user.deptCode) redirect(`/dept/${user.deptCode}`);

  const db = spine();
  const { data: depts } = await db
    .from('department_settings')
    .select('day_start_time, closing_before, sort_order, locations(code, name)')
    .eq('active', true).order('sort_order');
  const today = istCalendarDate(new Date());
  const isMaster = user.role === 'tech' || user.role === 'super_admin';

  return (
    <main>
      <div className="topbar">
        <span className="brand">Creme Castle</span>
        <span className="sub">Kitchen · on the spine</span>
        <span className="when">{weekdayForYmd(today)} {today} · {user.email.split('@')[0]}</span>
      </div>

      <h2 className="sect">Department screens</h2>
      <div className="homegrid">
        {(depts ?? []).map((d: any) => (
          <Link key={d.locations.code} className="big-btn" href={`/dept/${d.locations.code}`}>
            {d.locations.name}
            <small>day starts {String(d.day_start_time).slice(0, 5)} · count by {String(d.closing_before).slice(0, 5)}</small>
          </Link>
        ))}
      </div>

      <h2 className="sect">Management</h2>
      <div className="homegrid">
        <Link className="big-btn" href="/admin">Daily dashboard<small>today per department, ledger, transfers, requests, activity</small></Link>
        <Link className="big-btn" href="/buffer">Frozen buffer<small>current level vs par, per item</small></Link>
      </div>
      {/* D2C reconciliation (Build 1a) is not linked here: it needs the OMS
          credentials, which this deployment does not carry. The code stays. */}

      {isMaster && (
        <>
          <h2 className="sect">Masters</h2>
          <div className="homegrid">
            <Link className="big-btn" href="/admin/items">Items<small>add, live switch, par, order</small></Link>
            <Link className="big-btn" href="/admin/departments">Departments<small>day windows</small></Link>
            {user.role === 'super_admin' && (
              <Link className="big-btn" href="/admin/users">Users<small>accounts, roles, departments</small></Link>
            )}
          </div>
        </>
      )}
    </main>
  );
}
