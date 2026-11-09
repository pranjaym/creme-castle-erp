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
import { ROLE_DEFS, ROLE_LABEL } from '@/lib/roles';
import { requestResetLink } from '@/lib/password-reset';
import { istTime } from '@/lib/mail';

// The roles an admin may save. Read from ROLE_DEFS, never typed out again: a
// hand-kept second list is how chef and controls were added to the form on
// 15 Sep 2026 and silently rejected here, which bounced the admin back to
// step 1 with "Pick a role first" on a role they had already picked.
const ROLES: Role[] = ROLE_DEFS.map(d => d.role);

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
  // Every other role: no outlet scope; the role alone decides what it sees.
  return { codes: [] };
}


// The module grants posted by the form (recipes, coupons), as the modules array
// to store: any other module's grants are kept, the posted entries are replaced.
async function modulesFor(id: string | null, formData: FormData): Promise<string[]> {
  const grant = String(formData.get('recipe_grant') || '').trim();
  let current: string[] = [];
  if (id) {
    const { data } = await spine().from('profiles').select('modules').eq('id', id).maybeSingle();
    current = ((data as { modules?: string[] } | null)?.modules) ?? [];
  }
  const cgrant = String(formData.get('coupon_grant') || '').trim();
  const kept = current.filter(m => !m.startsWith('recipes:') && !m.startsWith('coupons:'));
  const out = grant.startsWith('recipes:') ? [...kept, grant] : kept;
  return cgrant.startsWith('coupons:') ? [...out, cgrant] : out;
}

export async function createUser(formData: FormData): Promise<void> {
  const actor = await requireAdminAction();

  const email = String(formData.get('email') || '').trim().toLowerCase();
  const fullName = String(formData.get('full_name') || '').trim();
  const role = String(formData.get('role') || '') as Role;
  const password = String(formData.get('password') || '');
  const back = `/users/new?role=${encodeURIComponent(role)}`;

  if (!ROLES.includes(role)) bounce('/users/new', `"${role || 'nothing'}" is not a role this screen can save. Pick one of the cards.`, 'err');
  if (!email || !email.includes('@')) bounce(back, 'Enter a valid email address.', 'err');
  if (password.length < 8) bounce(back, 'The temporary password needs at least 8 characters.', 'err');

  const scope = await resolveScope(role, formData);
  if ('error' in scope) bounce(back, scope.error, 'err');

  const db = spine();
  // The typed password is a handover, not the one they keep: they must choose
  // their own at first sign-in (9 Nov 2026, middleware + /change-password).
  const { data: created, error } = await db.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { must_change_password: true },
  });
  if (error || !created.user) {
    bounce(back, `Could not create the account: ${error?.message ?? 'unknown error'}`, 'err');
  }

  // The on-auth-insert trigger (migration 040) has already created an inactive
  // viewer profile; promote it to what the admin chose.
  const { error: profErr } = await db.from('profiles')
    .update({ email, full_name: fullName || null, role, outlet_codes: scope.codes, active: true, modules: await modulesFor(null, formData) })
    .eq('id', created.user.id);
  if (profErr) bounce(back, `Account created but the profile update failed: ${profErr.message}`, 'err');

  await log(actor, 'user_created', email, { forced: true, role, outlets: scope.codes, full_name: fullName, recipe_grant: String(formData.get('recipe_grant') || '') });
  revalidatePath('/users');
  bounce('/users', `${email} added as ${ROLE_LABEL(role)}. Give them the temporary password in person or on a call, not by email. They will choose their own when they first sign in.`);
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
    .update({ role, full_name: fullName || null, outlet_codes: scope.codes, active, modules: await modulesFor(id, formData) })
    .eq('id', id);
  if (error) bounce(back, `Save failed: ${error.message}`, 'err');

  await log(actor, 'user_updated', email || id, { role, outlets: scope.codes, active, recipe_grant: String(formData.get('recipe_grant') || '') });
  revalidatePath('/users');
  bounce('/users', `${email || 'Account'} saved: ${ROLE_LABEL(role)}${active ? '' : ', switched off'}.`);
}

// Passwords were issued on paper, so "they lost it" is a routine request and
// needs to be one button, not a support ticket. The admin types the new
// temporary password and hands it over the same way. Since 9 Nov 2026 it is a
// handover only: the person must choose their own at next sign-in. The usual
// route now is emailResetLink below.
export async function resetPassword(formData: FormData): Promise<void> {
  const actor = await requireAdminAction();

  const id = String(formData.get('id') || '');
  const email = String(formData.get('email') || '');
  const password = String(formData.get('password') || '');
  const back = `/users/${id}`;

  if (!id) bounce('/users', 'Missing account id.', 'err');
  if (password.length < 8) bounce(back, 'The new password needs at least 8 characters.', 'err');

  const { error } = await spine().auth.admin.updateUserById(id, {
    password, app_metadata: { must_change_password: true },
  });
  if (error) bounce(back, `Could not set the password: ${error.message}`, 'err');

  // The password itself is never logged, only that it was reset and by whom.
  await log(actor, 'password_reset', (email || id).toLowerCase(), { by_admin: true, forced: true });
  bounce(back, `Temporary password set for ${email || 'the account'}. Read it out on a call, not by email. They will be asked to choose their own the moment they sign in.`);
}

// Email the person a one-time reset link (the same one "Forgot password?" on
// the sign-in page sends). The admin never knows their password. Counts toward
// the same limit of 3 links an hour.
export async function emailResetLink(formData: FormData): Promise<void> {
  const actor = await requireAdminAction();

  const id = String(formData.get('id') || '');
  const back = `/users/${id}`;
  if (!id) bounce('/users', 'Missing account id.', 'err');

  const { data: prof } = await spine().from('profiles').select('email, active').eq('id', id).maybeSingle();
  const email = (prof?.email as string | undefined) ?? '';
  if (!email) bounce(back, 'This account has no email address on file.', 'err');
  if (prof?.active === false) bounce(back, 'This account is switched off. Switch it on first, then send the link.', 'err');

  const r = await requestResetLink(email, 'portal', { id: actor.id, email: actor.email });
  switch (r.status) {
    case 'sent':
      bounce(back, `Reset link emailed to ${email} at ${istTime(r.sentAt)}. It works until ${istTime(r.until)}. Their current password keeps working until they use it.`);
    case 'limited':
      bounce(back, `3 links already went to ${email} in the last hour. Ask them to use the newest email, or set a temporary password below. Next link possible at ${istTime(r.nextAt)}.`, 'err');
    case 'wait':
      bounce(back, `A link went to ${email} at ${istTime(r.lastAt)}. Wait until ${istTime(r.nextAt)} before sending another.`, 'err');
    case 'not_configured':
      bounce(back, 'Email is not set up on the server yet (SMTP_USER and SMTP_PASS). Set a temporary password below instead.', 'err');
    case 'no_account':
      bounce(back, `No login exists for ${email}. Check the address on this account.`, 'err');
    case 'inactive':
      bounce(back, 'This account is switched off. Switch it on first, then send the link.', 'err');
    default:
      bounce(back, 'The email could not be sent just now. Try again in a few minutes, or set a temporary password below.', 'err');
  }
}

