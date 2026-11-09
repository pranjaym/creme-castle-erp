'use server';

// The must-change page: a person signed in with a temporary password (typed by
// an admin, or given with a new account) chooses their own before anything
// else opens. Changes only the signed-in person's own password.
import { redirect } from 'next/navigation';
import { authClient } from '@/lib/supabase/authClient';
import { checkNewPassword, logPasswordEvent, sendChangedNotice, setOwnPassword } from '@/lib/password-reset';

export type ChangeState = null | { kind: 'error'; message: string };

export async function chooseOwnPassword(_prev: ChangeState, formData: FormData): Promise<ChangeState> {
  const supabase = await authClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) redirect('/login');

  const pw1 = String(formData.get('password') || '').trim();
  const pw2 = String(formData.get('password2') || '').trim();
  const bad = checkNewPassword(pw1, pw2);
  if (bad) return { kind: 'error', message: bad };

  const failed = await setOwnPassword(user.id, pw1);
  if (failed) return { kind: 'error', message: `That password was not accepted (${failed}). Choose another.` };

  await logPasswordEvent({ id: user.id, email: user.email }, 'password_changed_forced', user.email, {});
  await sendChangedNotice(user.email);
  redirect('/');
}

export async function signOutHere(): Promise<void> {
  const supabase = await authClient();
  await supabase.auth.signOut();
  redirect('/login');
}
