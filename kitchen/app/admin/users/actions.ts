'use server';
// User management (super_admin only). Accounts live in Supabase Auth (the same
// project as the ERP portal, so one email + password works on both apps); the
// kitchen role and department live on public.profiles. Never a delete:
// deactivate instead. Every change is audited in spine_events.
import { spine } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getKitchenUser } from '@/lib/session';

const ROLES = ['department', 'exec_chef', 'tech', 'super_admin'] as const;

async function guardSuper(): Promise<string | null> {
  const u = await getKitchenUser();
  if (!u) return 'Not signed in.';
  if (u.role !== 'super_admin') return 'Only a super admin can manage users.';
  return null;
}

async function audit(action: string, actor: string, data: any, ref?: string) {
  await spine().from('spine_events').insert({ entity: 'kitchen_users', entity_ref: ref ?? null, action, actor, data });
}

async function actorLabel(): Promise<string> {
  const u = await getKitchenUser();
  return u ? `${u.email}` : 'unknown';
}

/** Create an account: auth user (email confirmed, temp password) + profile. */
export async function createUser(input: {
  email: string; password: string; fullName: string;
  role: string; deptCode?: string | null;
}) {
  const guard = await guardSuper();
  if (guard) return { ok: false, message: guard };
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, message: 'That email does not look right' };
  if (input.password.length < 8) return { ok: false, message: 'Password must be at least 8 characters' };
  if (!(ROLES as readonly string[]).includes(input.role)) return { ok: false, message: 'Unknown role' };

  const db = spine();
  let deptId: number | null = null;
  if (input.role === 'department') {
    if (!input.deptCode) return { ok: false, message: 'A department account needs a department' };
    const { data: loc } = await db.from('locations').select('id').eq('code', input.deptCode).single();
    if (!loc) return { ok: false, message: `Unknown department ${input.deptCode}` };
    deptId = loc.id;
  }

  const { data: created, error } = await db.auth.admin.createUser({
    email, password: input.password, email_confirm: true,
  });
  if (error || !created.user) return { ok: false, message: error?.message ?? 'Could not create the account' };

  // The 040 trigger already inserted an inactive viewer profile; finish it.
  const { error: pErr } = await db.from('profiles').update({
    full_name: input.fullName.trim() || null,
    kitchen_role: input.role,
    kitchen_department_location_id: deptId,
    active: true,
  }).eq('id', created.user.id);
  if (pErr) return { ok: false, message: `Account created but profile failed: ${pErr.message}` };

  await audit('user_created', await actorLabel(), { email, role: input.role, dept: input.deptCode ?? null }, email);
  revalidatePath('/admin/users');
  return { ok: true, message: `${email} created (${input.role}). Share the password with them; they can change it later.` };
}

/** Change role / department. */
export async function setUserAccess(userId: string, role: string, deptCode: string | null) {
  const guard = await guardSuper();
  if (guard) return { ok: false, message: guard };
  if (!(ROLES as readonly string[]).includes(role)) return { ok: false, message: 'Unknown role' };
  const db = spine();
  let deptId: number | null = null;
  if (role === 'department') {
    if (!deptCode) return { ok: false, message: 'A department account needs a department' };
    const { data: loc } = await db.from('locations').select('id').eq('code', deptCode).single();
    if (!loc) return { ok: false, message: `Unknown department ${deptCode}` };
    deptId = loc.id;
  }
  const { data: prof } = await db.from('profiles').select('email').eq('id', userId).single();
  const { error } = await db.from('profiles').update({
    kitchen_role: role, kitchen_department_location_id: deptId,
  }).eq('id', userId);
  if (error) return { ok: false, message: error.message };
  await audit('user_access_changed', await actorLabel(), { email: prof?.email, role, dept: deptCode }, prof?.email ?? userId);
  revalidatePath('/admin/users');
  return { ok: true, message: `Access updated for ${prof?.email ?? 'user'}` };
}

/** Deactivate / reactivate (never delete). An inactive account cannot sign in
 *  anywhere (portal checks the same flag). */
export async function setUserActive(userId: string, active: boolean) {
  const guard = await guardSuper();
  if (guard) return { ok: false, message: guard };
  const me = await getKitchenUser();
  if (me && me.id === userId && !active) return { ok: false, message: 'You cannot deactivate your own account' };
  const db = spine();
  const { data: prof } = await db.from('profiles').select('email').eq('id', userId).single();
  const { error } = await db.from('profiles').update({ active }).eq('id', userId);
  if (error) return { ok: false, message: error.message };
  await audit(active ? 'user_activated' : 'user_deactivated', await actorLabel(), { email: prof?.email }, prof?.email ?? userId);
  revalidatePath('/admin/users');
  return { ok: true, message: `${prof?.email ?? 'user'} is now ${active ? 'active' : 'inactive'}` };
}

/** Set a new temporary password (when someone forgets theirs). */
export async function resetPassword(userId: string, password: string) {
  const guard = await guardSuper();
  if (guard) return { ok: false, message: guard };
  if (password.length < 8) return { ok: false, message: 'Password must be at least 8 characters' };
  const db = spine();
  const { data: prof } = await db.from('profiles').select('email').eq('id', userId).single();
  const { error } = await db.auth.admin.updateUserById(userId, { password });
  if (error) return { ok: false, message: error.message };
  await audit('user_password_reset', await actorLabel(), { email: prof?.email }, prof?.email ?? userId);
  return { ok: true, message: `New password set for ${prof?.email ?? 'user'}. Share it with them.` };
}
