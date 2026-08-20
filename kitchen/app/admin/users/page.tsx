// Admin · Users (super_admin only): who can sign in and what they may touch.
// One account per department for the floor tablets; one per person for
// management. Same credentials work on the ERP portal (same Auth project).
import UsersClient from './UsersClient';
import { spine } from '@/lib/supabase/server';
import { requireRoles } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  await requireRoles(['super_admin']);
  const db = spine();

  const [{ data: profiles }, { data: depts }] = await Promise.all([
    db.from('profiles')
      .select('id, email, full_name, role, active, kitchen_role, kitchen_department_location_id, created_at')
      .order('created_at'),
    db.from('department_settings').select('sort_order, locations(id, code, name)').eq('active', true).order('sort_order'),
  ]);
  const deptRows = (depts ?? []).map((d: any) => ({ id: d.locations.id, code: d.locations.code, name: d.locations.name }));
  const deptByLocId = new Map(deptRows.map((d) => [d.id, d]));

  const users = (profiles ?? []).map((p) => ({
    id: p.id, email: p.email ?? '', fullName: p.full_name ?? '',
    portalRole: p.role, active: p.active,
    kitchenRole: p.kitchen_role ?? '',
    deptCode: p.kitchen_department_location_id ? (deptByLocId.get(p.kitchen_department_location_id)?.code ?? '') : '',
  }));

  return (
    <>
      <div className="adminhead">
        <span className="title">Users</span>
        <span className="blurb">who can sign in and what they may touch · deactivate, never delete · same password works on the ERP portal</span>
      </div>
      <div className="adminbody">
        <UsersClient users={users} depts={deptRows.map((d) => ({ code: d.code, name: d.name }))} />
      </div>
    </>
  );
}
