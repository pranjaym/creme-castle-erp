// Admin console shell: maroon sidebar, header band per page, content column.
// Gate: exec_chef (Daily + Watch, read), tech and super_admin (everything).
// Masters and Users pages carry their own stricter gates on top.
import AdminNav from './AdminNav';
import { requireRoles } from '@/lib/session';
import { getKitchenMode } from '@/lib/mode';
import { spine } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRoles(['exec_chef', 'tech', 'super_admin']);
  const mode = await getKitchenMode();
  const { data: deptRows } = await spine()
    .from('department_settings').select('sort_order, locations(code, name)')
    .eq('active', true).order('sort_order');
  const depts = (deptRows ?? []).map((d: any) => ({ code: d.locations.code, name: d.locations.name }));
  return (
    <div className="adminshell">
      <AdminNav role={user.role} email={user.email} depts={depts} />
      <div className="adminmain">
        {mode === 'trial' && (
          <div className="trialbar" style={{ margin: '10px 20px 0' }}>
            <strong>TRIAL</strong> the team is rehearsing on real screens. These numbers are practice and are
            cleared the moment you start the real run (Masters, Departments).
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
