// Forgot password by emailed link (decided by Pranjay 9 Nov 2026; record in
// erp-plan/password-reset-plan.md). The person gets a link that works once,
// within LINK_MINUTES, and chooses their own password. No password is ever
// emailed, and nothing changes until the link is used, so a reset somebody
// else asked for cannot lock a store out.
//
// The link carries a one-time recovery token made by Supabase Auth
// (auth.admin.generateLink). Making a new one cancels the older one. The token
// is used only when the person submits the new password (not when the page
// opens), so a mail app that pre-opens links cannot use it up.
//
// Limits, counted from portal_admin_log (never from server memory, which on
// Vercel is per instance and read zero in Rishabh's app): at most
// MAX_PER_HOUR links per email per hour, at least GAP_MINUTES apart. Every
// request is logged; a password never is.
//
// "Must change password" (an admin-typed temporary password, or a new account)
// is a mark on the login itself, auth app_metadata.must_change_password. The
// middleware sends a marked person to /change-password until they choose their
// own. Choosing one by any route clears it.
import 'server-only';
import { spine } from '@/lib/supabase/service';
import { escapeHtml, istDay, istStamp, istTime, mailButton, mailConfigured, mailShell, sendMail } from '@/lib/mail';

export const LINK_MINUTES = 60;
export const MAX_PER_HOUR = 3;
export const GAP_MINUTES = 2;
export const MIN_PASSWORD = 8;

// Fixed addresses, never taken from the request: a link built from the
// request's Host header could be pointed at another site by whoever sends the
// request, and would carry a live token there.
export const PORTAL_URL = (process.env.PORTAL_PUBLIC_URL || 'https://creme-castle-erp.vercel.app').replace(/\/$/, '');
export const KITCHEN_URL = 'https://cremecastle-kitchen.vercel.app';

export type From = 'portal' | 'kitchen';
export function asFrom(v: unknown): From { return v === 'kitchen' ? 'kitchen' : 'portal'; }

export type LinkResult =
  | { status: 'sent'; sentAt: Date; until: Date }
  | { status: 'no_account' | 'inactive' }                     // shown to the person exactly like 'sent'
  | { status: 'limited'; nextAt: Date }
  | { status: 'wait'; lastAt: Date; nextAt: Date }
  | { status: 'not_configured' }
  | { status: 'send_failed' };

interface Actor { id: string; email: string; }

async function logRow(actor: Actor | null, action: string, target: string, detail: object) {
  await spine().from('portal_admin_log').insert({
    actor_id: actor?.id ?? null, actor_email: actor?.email ?? null, action, target, detail,
  });
}

export function normEmail(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

// Ask for a link for `email`. `actor` is the admin when an admin sends it,
// null when the person asks on the sign-in page.
export async function requestResetLink(rawEmail: string, from: From, actor: Actor | null): Promise<LinkResult> {
  const email = normEmail(rawEmail);
  const by = actor ? 'admin' : 'self';
  if (!mailConfigured()) return { status: 'not_configured' };

  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const { data: recent } = await spine().from('portal_admin_log')
    .select('at').eq('action', 'password_link_requested').eq('target', email)
    .gte('at', hourAgo.toISOString()).order('at', { ascending: true });
  const times = (recent ?? []).map(r => new Date(r.at as string));
  if (times.length >= MAX_PER_HOUR) {
    const nextAt = new Date(times[times.length - MAX_PER_HOUR].getTime() + 60 * 60 * 1000);
    await logRow(actor, 'password_link_limited', email, { by, from });
    return { status: 'limited', nextAt };
  }
  const last = times[times.length - 1];
  if (last && now.getTime() - last.getTime() < GAP_MINUTES * 60 * 1000) {
    return { status: 'wait', lastAt: last, nextAt: new Date(last.getTime() + GAP_MINUTES * 60 * 1000) };
  }

  const db = spine();
  const { data: link, error } = await db.auth.admin.generateLink({ type: 'recovery', email });
  if (error || !link?.user || !link.properties?.hashed_token) {
    await logRow(actor, 'password_link_requested', email, { by, from, result: 'no_account' });
    return { status: 'no_account' };
  }
  const { data: profile } = await db.from('profiles').select('active').eq('id', link.user.id).maybeSingle();
  if (!profile || profile.active === false) {
    await logRow(actor, 'password_link_requested', email, { by, from, result: 'inactive' });
    return { status: 'inactive' };
  }

  const url = `${PORTAL_URL}/reset?token=${encodeURIComponent(link.properties.hashed_token)}${from === 'kitchen' ? '&from=kitchen' : ''}`;
  const until = new Date(now.getTime() + LINK_MINUTES * 60 * 1000);
  const to = link.user.email ?? email;
  const subject = `Reset your password (sent ${istDay(now)}, ${istTime(now)})`;
  const text = [
    `Someone asked to reset the password for ${to} on the Creme Castle ERP.`,
    '',
    'Choose a new password here:',
    url,
    '',
    `This link works once and stops working at ${istTime(until)}.`,
    '',
    'Did not ask for this? Ignore this email. Your password has not changed, and nobody can change it without this link.',
    '',
    `Sent ${istStamp(now)}. A newer reset email cancels this one.`,
  ].join('\n');
  const html = mailShell(
    `<p style="margin:0 0 12px;">Someone asked to reset the password for <b>${escapeHtml(to)}</b>.</p>` +
    mailButton(url, 'Choose a new password') +
    `<p style="margin:0 0 12px;">This link works once and stops working at <b>${istTime(until)}</b>.</p>` +
    `<p style="margin:0;"><b>Did not ask for this?</b> Ignore this email. Your password has not changed, and nobody can change it without this link.</p>`,
    `Sent ${istStamp(now)}. A newer reset email cancels this one.`,
  );

  try {
    await sendMail({ to, subject, text, html });
  } catch (e) {
    await logRow(actor, 'password_link_requested', email, { by, from, result: 'send_failed', error: String((e as Error)?.message ?? e).slice(0, 200) });
    return { status: 'send_failed' };
  }
  await logRow(actor, 'password_link_requested', email, { by, from, result: 'sent' });
  return { status: 'sent', sentAt: now, until };
}

// When was the newest link actually emailed to this address? The token in use
// can only be that one (a newer link cancels older ones), so this is how the
// one-hour promise in the email is kept even if Supabase's own expiry is longer.
export async function lastLinkSentAt(email: string): Promise<Date | null> {
  const { data } = await spine().from('portal_admin_log')
    .select('at').eq('action', 'password_link_requested').eq('target', normEmail(email))
    .eq('detail->>result', 'sent').order('at', { ascending: false }).limit(1);
  return data && data[0] ? new Date(data[0].at as string) : null;
}

// Set a person's own new password and clear the must-change mark, in one call.
export async function setOwnPassword(userId: string, password: string): Promise<string | null> {
  const { error } = await spine().auth.admin.updateUserById(userId, {
    password, app_metadata: { must_change_password: false },
  });
  return error ? error.message : null;
}

export async function logPasswordEvent(actor: Actor | null, action: string, target: string, detail: object) {
  await logRow(actor, action, normEmail(target), detail);
}

// A short note after any password change, so a change nobody made gets noticed.
// Best effort: a failure here never undoes the change.
export async function sendChangedNotice(email: string): Promise<void> {
  if (!mailConfigured()) return;
  const now = new Date();
  try {
    await sendMail({
      to: email,
      subject: `Your password was changed (${istDay(now)}, ${istTime(now)})`,
      text: `The password for ${email} on the Creme Castle ERP was changed at ${istTime(now)} on ${istDay(now)}.\n\nNot you? Tell the admin straight away.`,
      html: mailShell(
        `<p style="margin:0 0 12px;">The password for <b>${escapeHtml(email)}</b> was changed at <b>${istTime(now)}</b> on ${istDay(now)}.</p>` +
        `<p style="margin:0;"><b>Not you?</b> Tell the admin straight away.</p>`,
        `Sent ${istStamp(now)}.`,
      ),
    });
  } catch { /* the change stands; the notice is a courtesy */ }
}

export function checkNewPassword(pw1: string, pw2: string): string | null {
  if (pw1.length < MIN_PASSWORD) return `The new password needs at least ${MIN_PASSWORD} characters.`;
  if (pw1 !== pw2) return 'The two boxes do not match. Type the same password in both.';
  return null;
}

// How each logged event reads on the admin's Users page.
export function historyLine(action: string, detail: Record<string, unknown> | null, actorEmail: string | null): string | null {
  const d = detail ?? {};
  switch (action) {
    case 'password_link_requested': {
      const who = d.by === 'admin' ? `Reset link sent by ${actorEmail ?? 'an admin'}` : 'Asked for a reset link on the sign-in page';
      if (d.result === 'sent') return who + (d.from === 'kitchen' ? ' (from the kitchen app)' : '');
      if (d.result === 'inactive') return who + '; account switched off, nothing sent';
      if (d.result === 'send_failed') return who + '; the email could not be sent';
      return null;
    }
    case 'password_link_limited': return 'Asked for a reset link; refused, 3 already sent that hour';
    case 'password_changed_by_link': return 'Chose a new password using an emailed link';
    case 'password_changed_forced': return 'Chose their own password after a temporary one';
    case 'password_changed_self': return 'Changed their own password on the Account page';
    case 'password_reset': return `Temporary password set by ${actorEmail ?? 'an admin'}` + (d.forced ? '; must choose their own at next sign-in' : '');
    case 'user_created': return `Account created by ${actorEmail ?? 'an admin'}` + (d.forced ? '; must choose their own password at first sign-in' : '');
    case 'password_link_expired': return 'Opened a reset link after it had expired';
    default: return null;
  }
}
