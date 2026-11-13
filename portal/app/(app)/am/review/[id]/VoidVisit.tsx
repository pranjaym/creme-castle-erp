'use client';
// Void a mistaken visit or audit with a reason (never deleted). Reviewers only;
// the API re-checks the am:review grant.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import s from '../../am.module.css';

export default function VoidVisit({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  if (!open) return <button className={s.link} onClick={() => setOpen(true)}>Void this visit (a mistake)</button>;
  return (
    <div className={s.card}>
      <div className={s.cardh}>Void this visit</div>
      <div className={s.sub}>It stays on record with your reason and drops out of every score. Nothing is deleted.</div>
      {err ? <div className={s.err} role="alert">{err}</div> : null}
      <label className={s.lbl} htmlFor="am-void">Reason</label>
      <input id="am-void" className={s.txt} value={reason} onChange={e => setReason(e.target.value)} placeholder="For example: checked in at the wrong store" />
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className={`${s.btn} ${s.small}`} disabled={busy || reason.trim().length < 5} onClick={async () => {
          setBusy(true); setErr(null);
          const r = await fetch('/am/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'void', id, reason }) });
          const j = await r.json().catch(() => ({}));
          setBusy(false);
          if (!r.ok) { setErr(j.error ?? 'Could not void.'); return; }
          router.push('/am/review'); router.refresh();
        }}>Void</button>
        <button className={s.link} onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
