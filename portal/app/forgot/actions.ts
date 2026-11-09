'use server';

// "Forgot password?" on the sign-in page (portal and kitchen). Public: the
// person is not signed in. Whatever happens, the answer never says whether an
// email has an account. See lib/password-reset.ts.
import { asFrom, requestResetLink } from '@/lib/password-reset';
import { istTime } from '@/lib/mail';

export type ForgotState =
  | null
  | { kind: 'sent'; email: string; againAt: string }
  | { kind: 'error'; message: string; email: string };

export async function askForLink(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get('email') || '').trim();
  const from = asFrom(formData.get('from'));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { kind: 'error', message: 'Type the full email address you sign in with.', email };
  }

  const r = await requestResetLink(email, from, null);
  switch (r.status) {
    case 'sent':
    case 'no_account':
    case 'inactive':
      return { kind: 'sent', email, againAt: istTime(new Date(Date.now() + 2 * 60 * 1000)) };
    case 'limited':
      return { kind: 'error', email, message: `3 links were sent to this email in the last hour. Use the newest email (its subject shows the time it was sent). You can ask again at ${istTime(r.nextAt)}, or ask the admin.` };
    case 'wait':
      return { kind: 'error', email, message: `A link was asked for at ${istTime(r.lastAt)}. Check the newest email first; you can ask again at ${istTime(r.nextAt)}.` };
    case 'not_configured':
      return { kind: 'error', email, message: 'Email reset is not switched on yet. Ask the admin for a new password.' };
    case 'send_failed':
    default:
      return { kind: 'error', email, message: 'The email could not be sent just now. Try again in a few minutes, or ask the admin.' };
  }
}
