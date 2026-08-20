// Admin · Departments: each department's day window. The production day runs
// from its start time to the next start; the physical count happens just
// before. Changing a time here changes the team screen immediately.
import DeptTimesClient from './DeptTimesClient';
import { spine } from '@/lib/supabase/server';
import { requireRoles } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AdminDepartmentsPage() {
  await requireRoles(['tech', 'super_admin']);
  const db = spine();
  const { data: depts } = await db
    .from('department_settings')
    .select('location_id, day_start_time, closing_before, sort_order, active, locations(code, name)')
    .order('sort_order');

  const rows = (depts ?? []).map((d: any) => ({
    code: d.locations.code, name: d.locations.name,
    dayStart: String(d.day_start_time).slice(0, 5),
    closingBefore: String(d.closing_before).slice(0, 5),
    active: d.active,
  }));

  return (
    <>
      <div className="adminhead">
        <span className="title">Departments</span>
        <span className="blurb">each department&rsquo;s day runs start to start · the count happens just before the next start</span>
      </div>
      <div className="adminbody">
        <DeptTimesClient depts={rows} />
        <p className="hint" style={{ marginTop: 14 }}>
          Breads, Cakes and Desserts join here when their closing times and item lists are decided
          (parked questions in erp-plan/department-module-plan.md). Adding a department is a data change, not a rebuild.
        </p>
      </div>
    </>
  );
}
