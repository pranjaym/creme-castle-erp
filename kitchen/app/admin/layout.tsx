// Admin console shell: maroon sidebar, header band per page, content column.
// Gate: exec_chef (Daily + Watch, read), tech and super_admin (everything).
// Masters and Users pages carry their own stricter gates on top.
import AdminNav from './AdminNav';
import { requireRoles } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRoles(['exec_chef', 'tech', 'super_admin']);
  return (
    <div className="adminshell">
      <AdminNav role={user.role} email={user.email} />
      <div className="adminmain">{children}</div>
    </div>
  );
}
