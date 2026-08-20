// Who is logged in and what they may touch. Kitchen roles (migration 100,
// Pranjay 19 Aug 2026), on the same profiles table and Auth project as the
// ERP portal, so one email + password works on both apps:
//   department  : only its own department screen (write)
//   exec_chef   : every department screen + the admin Today/Watch pages
//   tech        : everything incl. master edits
//   super_admin : everything incl. user management
// Fail-closed: no kitchen_role (or inactive) = no access at all.
import 'server-only';
import { redirect } from 'next/navigation';
import { authClient } from '@/lib/supabase/authClient';
import { spine } from '@/lib/supabase/server';

export type KitchenRole = 'department' | 'exec_chef' | 'tech' | 'super_admin';

export interface KitchenUser {
  id: string;
  email: string;
  fullName: string | null;
  role: KitchenRole;
  deptCode: string | null;   // only for the department role
  deptName: string | null;
}

export async function getKitchenUser(): Promise<KitchenUser | null> {
  const supabase = await authClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const db = spine();
  const { data: profile } = await db
    .from('profiles')
    .select('full_name, active, kitchen_role, kitchen_department_location_id')
    .eq('id', user.id).single();
  if (!profile || profile.active === false || !profile.kitchen_role) return null;

  let deptCode: string | null = null;
  let deptName: string | null = null;
  if (profile.kitchen_department_location_id) {
    const { data: loc } = await db.from('locations').select('code, name')
      .eq('id', profile.kitchen_department_location_id).single();
    deptCode = loc?.code ?? null;
    deptName = loc?.name ?? null;
  }
  return {
    id: user.id,
    email: user.email ?? '',
    fullName: profile.full_name ?? null,
    role: profile.kitchen_role as KitchenRole,
    deptCode, deptName,
  };
}

/** Any signed-in, provisioned kitchen user; else the login screen. */
export async function requireKitchenUser(): Promise<KitchenUser> {
  const u = await getKitchenUser();
  if (!u) redirect('/login');
  return u;
}

/** Pages restricted to specific roles; others land on their home. */
export async function requireRoles(roles: KitchenRole[]): Promise<KitchenUser> {
  const u = await requireKitchenUser();
  if (!roles.includes(u.role)) redirect(homeFor(u));
  return u;
}

/** May this user open (and write on) this department's screen? */
export function mayUseDept(u: KitchenUser, deptCode: string): boolean {
  if (u.role === 'department') return u.deptCode === deptCode;
  return true; // exec_chef, tech, super_admin reach every department screen
}

/** Where a user lands after login. */
export function homeFor(u: KitchenUser): string {
  if (u.role === 'department' && u.deptCode) return `/dept/${u.deptCode}`;
  return '/admin';
}
