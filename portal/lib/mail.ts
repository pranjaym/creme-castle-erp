// Sending email from the portal. Used only by the password reset flow
// (9 Nov 2026). Mail goes out through the company Google Workspace mailbox over
// SMTP, the same mailbox the daily mailers use, with a Google app password.
//
// Server settings (Vercel > creme-castle-erp > Settings > Environment Variables):
//   SMTP_USER       the mailbox address
//   SMTP_PASS       a Google app password for that mailbox (not its real password)
//   SMTP_HOST       optional, default smtp.gmail.com
//   SMTP_PORT       optional, default 465
//   MAIL_FROM_NAME  optional, default "Creme Castle ERP"
// With SMTP_USER or SMTP_PASS missing, mailConfigured() is false and the reset
// pages say email is not switched on yet. Nothing else in the portal changes.
//
// Local testing only: MAIL_DEV_OUTBOX=<folder> writes each message there as a
// .eml file instead of sending it. Ignored in production.
import 'server-only';
import nodemailer from 'nodemailer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function devOutbox(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  return process.env.MAIL_DEV_OUTBOX || null;
}

export function mailConfigured(): boolean {
  return Boolean(devOutbox() || (process.env.SMTP_USER && process.env.SMTP_PASS));
}

export interface Mail { to: string; subject: string; text: string; html: string; }

// Throws on failure, so the caller can tell the person it did not go.
export async function sendMail(m: Mail): Promise<void> {
  const box = devOutbox();
  if (box) {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const info = await transport.sendMail({ from: 'Creme Castle ERP <dev@localhost>', ...m });
    mkdirSync(box, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(box, `${stamp}.eml`), info.message as Buffer);
    return;
  }
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) throw new Error('Email is not set up on the server.');
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });
  const fromName = process.env.MAIL_FROM_NAME || 'Creme Castle ERP';
  await transport.sendMail({ from: `${fromName} <${user}>`, ...m });
}

// Times in mails and on screen are India time, written the way people say them:
// "10:42 am", "9 Nov".
export function istTime(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d).toLowerCase();
}
export function istDay(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(d);
}
export function istStamp(d: Date): string {
  const y = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(d);
  return `${istDay(d)} ${y}, ${istTime(d)} IST`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The house look in an email: maroon band, white card, coral button. Inline
// styles only, because mail apps drop style sheets.
export function mailShell(bodyHtml: string, footer: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#FAF8F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#2A1A1D;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #EDE3E5;border-radius:10px;overflow:hidden;">
<tr><td style="background:#3C0618;color:#FFFFFF;font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:18px;padding:14px 20px;">Creme Castle ERP</td></tr>
<tr><td style="padding:18px 20px;font-size:15px;line-height:1.5;">${bodyHtml}</td></tr>
<tr><td style="border-top:1px solid #EDE3E5;padding:12px 20px;font-size:12px;color:#7E6B6E;">${footer}</td></tr>
</table></body></html>`;
}

export function mailButton(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:#DB5436;color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:6px;margin:6px 0 14px;">${escapeHtml(label)}</a>`;
}
