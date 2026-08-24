'use server';

// Change your own password. Uses the logged-in Supabase session, so it can
// only ever change the caller's account. Logged (append-only) like every
// account change.
import { redirect } from 'next/navigation';
import { authClient } from '@/lib/supabase/authClient';
import { spine } from '@/lib/supabase/service';
import { getSessionUser } from '@/lib/session';

export async function changePassword(formData: FormData): Promise<void> {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const pw1 = String(formData.get('password') || '');
  const pw2 = String(formData.get('password2') || '');
  if (pw1.length < 8) redirect('/account?err=' + encodeURIComponent('The new password needs at least 8 characters.'));
  if (pw1 !== pw2) redirect('/account?err=' + encodeURIComponent('The two entries do not match.'));

  const supabase = await authClient();
  const { error } = await supabase.auth.updateUser({ password: pw1 });
  if (error) redirect('/account?err=' + encodeURIComponent(error.message));

  await spine().from('portal_admin_log').insert({
    actor_id: user.id, actor_email: user.email,
    action: 'password_changed_self', target: user.email, detail: {},
  });
  redirect('/account?ok=' + encodeURIComponent('Password changed. Use the new one from your next sign-in.'));
}
