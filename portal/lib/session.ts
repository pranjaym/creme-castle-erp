// Who is logged in, and what may they do. Every gated page calls requireUser();
// admin-only pages call requireAdmin(). The role lives in public.profiles on the
// spine (migration 040), keyed to the Supabase Auth user id.
import 'server-only';
import { redirect } from 'next/navigation';
import { authClient } from '@/lib/supabase/authClient';
import { spine } from '@/lib/supabase/service';

// Phase 2 roles (migration 140). 'viewer' predates the role-equals-scope model and
// is treated as read-only central until reassigned in /users.
export type Role = 'admin' | 'central' | 'area_manager' | 'store' | 'viewer';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  // Scope: store = one internal_code, area_manager = their outlets,
  // admin/central/viewer = empty meaning all.
  outletCodes: string[];
}

// Returns the logged-in user with their profile, or null if not signed in / not
// provisioned / deactivated. A user with an auth account but no active profile row
// is treated as not allowed (accounts are provisioned deliberately, not by signup).
export async function getSessionUser(): Promise<SessionUser | null> {

  const supabase = await authClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await spine()
    .from('profiles')
    .select('role, full_name, active, outlet_codes')
    .eq('id', user.id)
    .single();

  if (error || !profile || profile.active === false) return null;

  return {
    id: user.id,
    email: user.email ?? '',
    fullName: profile.full_name ?? null,
    role: (profile.role as Role) ?? 'viewer',
    outletCodes: ((profile as { outlet_codes?: string[] }).outlet_codes) ?? [],
  };
}

// For pages: bounce to /login if not a valid, active user.
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect('/login');
  return u;
}

// For admin-only pages: bounce viewers to the home page.
export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== 'admin') redirect('/');
  return u;
}
