'use server';

// Admin actions for the users module. Every action re-checks the caller is an
// active admin (server actions are directly callable, so the page-level gate is
// not enough). All writes go through the service-role client, and every change
// is appended to public.portal_admin_log (append-only, never updated).
//
// Phase 3b (24 Aug 2026): the form is role-first, so scope arrives in the shape
// that role actually uses. A STORE account posts one outlet code. An AREA
// MANAGER posts one AREA NAME and the outlet list is derived here from the
// outlet master, never hand-picked, so an account's stores can never drift out
// of step with the master. Central and admin post no scope at all.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getSessionUser, type Role, type SessionUser } from '@/lib/session';
import { spine } from '@/lib/supabase/service';

const ROLES: Role[] = ['admin', 'central', 'area_manager', 'store', 'viewer'];

async function requireAdminAction(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u || u.role !== 'admin') redirect('/');
  return u;
}

function bounce(to: string, msg: string, kind: 'ok' | 'err' = 'ok'): never {
  redirect(`${to}${to.includes('?') ? '&' : '?'}${kind}=${encodeURIComponent(msg)}`);
}

async function log(actor: SessionUser, action: string, target: string, detail: object) {
  await spine().from('portal_admin_log').insert({
    actor_id: actor.id, actor_email: actor.email, action, target, detail,
  });
}

// The outlets an area manager's account covers: everything the outlet master
// assigns to that area, active outlets only.
async function outletsForArea(area: string): Promise<string[]> {
  const { data } = await spine().from('outlets')
    .select('internal_code').eq('area_manager', area).eq('active', true)
    .order('internal_code');
  return (data ?? []).map(r => r.internal_code as string);
}

// Turn what the role-specific form posted into the outlet_codes array, or an
// error sentence fit to show a human.
async function resolveScope(role: Role, form: FormData):
  Promise<{ codes: string[] } | { error: string }> {
  if (role === 'store') {
    const code = String(form.get('outlet') || '').trim();
    if (!code) return { error: 'Pick the store this person manages.' };
    return { codes: [code] };
  }
  if (role === 'area_manager') {
    const area = String(form.get('area') || '').trim();
    if (!area) return { error: 'Pick the area this person manages.' };
    const codes = await outletsForArea(area);
    if (!codes.length) {
      return { error: `The outlet master lists no active stores under ${area}.` };
    }
    return { codes };
  }
  // admin, central, viewer: the whole network, expressed as no scope at all.
  return { codes: [] };
}

export async function createUser(formData: FormData): Promise<void> {
  const actor = await requireAdminAction();

  const email = String(formData.get('email') || '').trim().toLowerCase();
  const fullName = String(formData.get('full_name') || '').trim();
  const role = String(formData.get('role') || '') as Role;
  const password = String(formData.get('password') || '');
  const back = `/users/new?role=${encodeURIComponent(role)}`;

  if (!ROLES.includes(role)) bounce('/users/new', 'Pick a role first.', 'err');
  if (!email || !email.includes('@')) bounce(back, 'Enter a valid email address.', 'err');
  if (password.length < 8) bounce(back, 'The temporary password needs at least 8 characters.', 'err');

  const scope = await resolveScope(role, formData);
  if ('error' in scope) bounce(back, scope.error, 'err');

  const db = spine();
  const { data: created, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error || !created.user) {
    bounce(back, `Could not create the account: ${error?.message ?? 'unknown error'}`, 'err');
  }

  // The on-auth-insert trigger (migration 040) has already created an inactive
  // viewer profile; promote it to what the admin chose.
  const { error: profErr } = await db.from('profiles')
    .update({ email, full_name: fullName || null, role, outlet_codes: scope.codes, active: true })
    .eq('id', created.user.id);
  if (profErr) bounce(back, `Account created but the profile update failed: ${profErr.message}`, 'err');

  await log(actor, 'user_created', email, { role, outlets: scope.codes, full_name: fullName });
  revalidatePath('/users');
  bounce('/users', `${email} added as ${ROLE_WORD[role]}. Give them the temporary password in person or on a call, not by email.`);
}

export async function updateUser(formData: FormData): Promise<void> {
  const actor = await requireAdminAction();

  const id = String(formData.get('id') || '');
  const email = String(formData.get('email') || '');
  const fullName = String(formData.get('full_name') || '').trim();
  const role = String(formData.get('role') || '') as Role;
  const active = formData.get('active') === 'on';
  const back = `/users/${id}?role=${encodeURIComponent(role)}`;

  if (!id) bounce('/users', 'Missing account id.', 'err');
  if (!ROLES.includes(role)) bounce(back, 'Unknown role.', 'err');

  const scope = await resolveScope(role, formData);
  if ('error' in scope) bounce(back, scope.error, 'err');

  if (id === actor.id && (role !== 'admin' || !active)) {
    bounce(back, 'You cannot change your own account out of admin, or switch it off.', 'err');
  }

  const { error } = await spine().from('profiles')
    .update({ role, full_name: fullName || null, outlet_codes: scope.codes, active })
    .eq('id', id);
  if (error) bounce(back, `Save failed: ${error.message}`, 'err');

  await log(actor, 'user_updated', email || id, { role, outlets: scope.codes, active });
  revalidatePath('/users');
  bounce('/users', `${email || 'Account'} saved: ${ROLE_WORD[role]}${active ? '' : ', switched off'}.`);
}

// Passwords were issued on paper, so "they lost it" is a routine request and
// needs to be one button, not a support ticket. The admin types the new
// temporary password and hands it over the same way.
export async function resetPassword(formData: FormData): Promise<void> {
  const actor = await requireAdminAction();

  const id = String(formData.get('id') || '');
  const email = String(formData.get('email') || '');
  const password = String(formData.get('password') || '');
  const back = `/users/${id}`;

  if (!id) bounce('/users', 'Missing account id.', 'err');
  if (password.length < 8) bounce(back, 'The new password needs at least 8 characters.', 'err');

  const { error } = await spine().auth.admin.updateUserById(id, { password });
  if (error) bounce(back, `Could not set the password: ${error.message}`, 'err');

  // The password itself is never logged, only that it was reset and by whom.
  await log(actor, 'password_reset', email || id, { by_admin: true });
  bounce(back, `New temporary password set for ${email || 'the account'}. Give it to them directly, not by email.`);
}

const ROLE_WORD: Record<Role, string> = {
  admin: 'an admin',
  central: 'central office',
  area_manager: 'an area manager',
  store: 'a store account',
  viewer: 'a viewer',
};
