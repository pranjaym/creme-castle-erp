'use server';

// The page an emailed reset link opens. The one-time token is used here, when
// the person submits their new password, never when the page loads (mail apps
// sometimes open links to scan them, which would use the token up).
import { redirect } from 'next/navigation';
import { authClient } from '@/lib/supabase/authClient';
import { spine } from '@/lib/supabase/service';
import {
  LINK_MINUTES, asFrom, checkNewPassword, lastLinkSentAt, logPasswordEvent,
  sendChangedNotice, setOwnPassword,
} from '@/lib/password-reset';

export type ResetState = null | { kind: 'error'; message: string } | { kind: 'expired' };

export async function chooseNewPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const token = String(formData.get('token') || '');
  const from = asFrom(formData.get('from'));
  const pw1 = String(formData.get('password') || '').trim();
  const pw2 = String(formData.get('password2') || '').trim();

  const bad = checkNewPassword(pw1, pw2);
  if (bad) return { kind: 'error', message: bad };
  if (!token) return { kind: 'expired' };

  const supabase = await authClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: token, type: 'recovery' });
  const user = data?.user;
  if (error || !user || !user.email) return { kind: 'expired' };

  // Keep the promise in the email: the link works for LINK_MINUTES after it was sent.
  const sentAt = await lastLinkSentAt(user.email);
  if (!sentAt || Date.now() - sentAt.getTime() > LINK_MINUTES * 60 * 1000) {
    await supabase.auth.signOut();
    await logPasswordEvent({ id: user.id, email: user.email }, 'password_link_expired', user.email, { from });
    return { kind: 'expired' };
  }

  const { data: profile } = await spine().from('profiles').select('active').eq('id', user.id).maybeSingle();
  if (!profile || profile.active === false) {
    await supabase.auth.signOut();
    return { kind: 'error', message: 'This account is switched off. Ask the admin to switch it on.' };
  }

  const failed = await setOwnPassword(user.id, pw1);
  if (failed) {
    // The link is used up but they are signed in. Send them to the
    // choose-your-own page rather than leave them with nothing.
    await spine().auth.admin.updateUserById(user.id, { app_metadata: { must_change_password: true } });
    redirect('/change-password?err=' + encodeURIComponent(`That password was not accepted (${failed}). Choose another.`));
  }

  await logPasswordEvent({ id: user.id, email: user.email }, 'password_changed_by_link', user.email, { from });
  await sendChangedNotice(user.email);
  redirect(`/reset/done${from === 'kitchen' ? '?from=kitchen' : ''}`);
}
