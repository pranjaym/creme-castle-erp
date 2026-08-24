'use server';

// Admin actions for the users module. Every action re-checks the caller is an
// active admin (server actions are directly callable, so the page-level gate is
// not enough). All writes go through the service-role client, and every change
// is appended to public.portal_admin_log (append-only, never updated).
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

function bounce(msg: string, kind: 'ok' | 'err' = 'ok'): never {
  redirect(`/users?${kind}=${encodeURIComponent(msg)}`);
}

async function log(actor: SessionUser, action: string, target: string, detail: object) {
  await spine().from('portal_admin_log').insert({
    actor_id: actor.id, actor_email: actor.email, action, target, detail,
  });
}

// Validate a role + outlet-scope combination. Returns an error string or null.
function scopeError(role: Role, outlets: string[]): string | null {
  if (role === 'store' && outlets.length !== 1) {
    return 'A store account needs exactly one outlet.';
  }
  if (role === 'area_manager' && outlets.length === 0) {
    return 'An area manager account needs at least one outlet.';
  }
  return null;
}

export async function createUser(formData: FormData): Promise<void> {
  const actor = await requireAdminAction();

  const email = String(formData.get('email') || '').trim().toLowerCase();
  const fullName = String(formData.get('full_name') || '').trim();
  const role = String(formData.get('role') || 'viewer') as Role;
  const password = String(formData.get('password') || '');
  const outlets = formData.getAll('outlets').map(String).filter(Boolean);

  if (!email || !email.includes('@')) bounce('Enter a valid email address.', 'err');
  if (password.length < 8) bounce('The temporary password needs at least 8 characters.', 'err');
  if (!ROLES.includes(role)) bounce('Unknown role.', 'err');
  const scopeErr = scopeError(role, outlets);
  if (scopeErr) bounce(scopeErr, 'err');

  const db = spine();
  const { data: created, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error || !created.user) {
    bounce(`Could not create the account: ${error?.message ?? 'unknown error'}`, 'err');
  }

  // The on-auth-insert trigger (migration 040) has already created an inactive
  // viewer profile; promote it to what the admin chose.
  const { error: profErr } = await db.from('profiles')
    .update({ email, full_name: fullName || null, role, outlet_codes: outlets, active: true })
    .eq('id', created.user.id);
  if (profErr) bounce(`Account created but the profile update failed: ${profErr.message}`, 'err');

  await log(actor, 'user_created', email, { role, outlets, full_name: fullName });
  revalidatePath('/users');
  bounce(`${email} created as ${role.replace('_', ' ')}. Share the temporary password with them directly.`);
}

export async function updateUser(formData: FormData): Promise<void> {
  const actor = await requireAdminAction();

  const id = String(formData.get('id') || '');
  const email = String(formData.get('email') || '');
  const role = String(formData.get('role') || 'viewer') as Role;
  const active = formData.get('active') === 'on';
  const outlets = formData.getAll('outlets').map(String).filter(Boolean);

  if (!id) bounce('Missing account id.', 'err');
  if (!ROLES.includes(role)) bounce('Unknown role.', 'err');
  const scopeErr = scopeError(role, outlets);
  if (scopeErr) bounce(scopeErr, 'err');
  if (id === actor.id && (role !== 'admin' || !active)) {
    bounce('You cannot demote or deactivate your own admin account.', 'err');
  }

  const { error } = await spine().from('profiles')
    .update({ role, outlet_codes: outlets, active })
    .eq('id', id);
  if (error) bounce(`Update failed: ${error.message}`, 'err');

  await log(actor, 'user_updated', email || id, { role, outlets, active });
  revalidatePath('/users');
  bounce(`${email || 'Account'} saved: ${role.replace('_', ' ')}${active ? '' : ', deactivated'}.`);
}
