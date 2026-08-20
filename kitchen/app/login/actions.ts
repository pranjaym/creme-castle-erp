'use server';
// Sign in with email + password (same Auth project as the ERP portal, so the
// same credentials work on both). Accounts are provisioned by a super admin;
// there is no public signup. Fail closed: an auth user without an active
// kitchen_role profile is signed straight back out.
import { redirect } from 'next/navigation';
import { authClient } from '@/lib/supabase/authClient';
import { spine } from '@/lib/supabase/server';
import { homeFor, type KitchenUser } from '@/lib/session';

export async function login(_prev: unknown, formData: FormData): Promise<{ error: string } | void> {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  const next = String(formData.get('next') || '') || '';

  if (!email || !password) return { error: 'Enter your email and password.' };

  const supabase = await authClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { error: 'Email or password is not correct.' };

  const db = spine();
  const { data: profile } = await db
    .from('profiles')
    .select('active, full_name, kitchen_role, kitchen_department_location_id')
    .eq('id', data.user.id).single();

  if (!profile || profile.active === false || !profile.kitchen_role) {
    await supabase.auth.signOut();
    return { error: 'This account has no kitchen access. Ask an admin to enable it.' };
  }

  let deptCode: string | null = null;
  if (profile.kitchen_department_location_id) {
    const { data: loc } = await db.from('locations').select('code')
      .eq('id', profile.kitchen_department_location_id).single();
    deptCode = loc?.code ?? null;
  }
  const u = {
    role: profile.kitchen_role, deptCode,
  } as Pick<KitchenUser, 'role' | 'deptCode'> as KitchenUser;

  // Only relative paths as the destination (no open redirect); otherwise the
  // role's own home: a department lands on its screen, everyone else on admin.
  const dest = next.startsWith('/') && !next.startsWith('//') && next !== '/login'
    ? next : homeFor(u);
  redirect(dest);
}

export async function logout() {
  const supabase = await authClient();
  await supabase.auth.signOut();
  redirect('/login');
}
