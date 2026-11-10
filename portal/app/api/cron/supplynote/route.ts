// The SupplyNote sync, called by the Vercel scheduler (portal/vercel.json).
//   GET /api/cron/supplynote?mode=light   every hour, 08:00 to 23:00 IST
//   GET /api/cron/supplynote?mode=heavy   five times a day, at a quarter past
//
// Not behind the login (the scheduler has none), so it checks the secret
// itself: Vercel sends "Authorization: Bearer <CRON_SECRET>" on every scheduled
// call. Without CRON_SECRET set, or with the wrong value, the answer is 401 and
// nothing runs. It only reads SupplyNote and writes the spine's landing tables.
//
// Alert flood rule (F50): at most one mail a day. The check runs only on the
// 21:00 IST light run, and mails only if a dataset has actually gone stale.
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runSync, syncStatus, staleList, type SyncMode } from '@/lib/supplynote-sync';
import { mailConfigured, sendMail, escapeHtml, mailShell, istStamp } from '@/lib/mail';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorised(req)) return NextResponse.json({ error: 'not authorised' }, { status: 401 });
  const m = new URL(req.url).searchParams.get('mode');
  if (m !== 'light' && m !== 'heavy') return NextResponse.json({ error: 'mode must be light or heavy' }, { status: 400 });
  const now = new Date();
  const out = await runSync(m as SyncMode, now);

  let alert = 'not due';
  const istHour = new Date(now.getTime() + 330 * 60_000).getUTCHours();
  if (m === 'light' && istHour === 21) {
    try {
      const stale = staleList(await syncStatus(), now);
      const to = process.env.INVENTORY_ALERT_TO || process.env.SMTP_USER;
      if (stale.length === 0) alert = 'checked, nothing stale';
      else if (!mailConfigured() || !to) alert = 'stale, but mail is not configured';
      else {
        const text = `The SupplyNote sync for the inventory module has fallen behind (checked ${istStamp(now)}).\n\n${stale.join('\n')}\n\nThe inventory screens keep the last good reading until a sync succeeds. This check runs once a day.`;
        await sendMail({ to, subject: 'Inventory: SupplyNote sync has fallen behind', text, html: mailShell(`<p>The SupplyNote sync for the inventory module has fallen behind.</p><ul>${stale.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul><p>The inventory screens keep the last good reading until a sync succeeds.</p>`, 'This check runs once a day.') });
        alert = 'mail sent';
      }
    } catch (e) {
      alert = `check failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return NextResponse.json({ ...out, alert }, { status: out.ok ? 200 : 500 });
}
