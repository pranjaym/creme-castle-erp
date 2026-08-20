// Admin console shell: maroon sidebar, header band per page, content column.
// Gate: exec_chef (Daily + Watch, read), tech and super_admin (everything).
// Masters and Users pages carry their own stricter gates on top.
import AdminNav from './AdminNav';
import { requireRoles } from '@/lib/session';
import { getKitchenMode } from '@/lib/mode';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRoles(['exec_chef', 'tech', 'super_admin']);
  const mode = await getKitchenMode();
  return (
    <div className="adminshell">
      <AdminNav role={user.role} email={user.email} />
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
