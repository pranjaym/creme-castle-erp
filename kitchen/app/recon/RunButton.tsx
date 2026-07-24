'use client';
import { useState } from 'react';
import { runRecon } from './actions';

export default function RunButton({ businessDate }: { businessDate: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [date, setDate] = useState(businessDate);

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
        style={{ padding: 10, fontSize: 16, border: '2px solid var(--line)', borderRadius: 10 }} />
      <button className="big-btn" style={{ width: 'auto', margin: 0 }} disabled={busy || !date}
        onClick={async () => { setBusy(true); const r = await runRecon(date); setBusy(false); setMsg(r.message); }}>
        {busy ? 'Running…' : 'Run reconciliation'}
      </button>
      {msg && <span className="pill b-made">{msg}</span>}
    </div>
  );
}
