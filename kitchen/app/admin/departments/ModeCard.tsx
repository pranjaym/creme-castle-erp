'use client';
// The clean slate control (super admin only). Trial to live hides every trial
// row from every screen in one instant; nothing is deleted and it is
// reversible. Deliberately two steps, with a reason that goes on the record.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setKitchenMode } from '../actions';

export default function ModeCard({ mode, canSwitch }: { mode: 'trial' | 'live'; canSwitch: boolean }) {
  const router = useRouter();
  const [arming, setArming] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const target = mode === 'trial' ? 'live' : 'trial';

  async function go() {
    setBusy(true); setMsg(null);
    const res = await setKitchenMode(target, why);
    setBusy(false); setMsg({ ok: res.ok, text: res.message });
    if (res.ok) { setArming(false); setWhy(''); router.refresh(); }
  }

  return (
    <div className="admincard" style={{ padding: '16px 18px', maxWidth: 680 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span className="eyebrow" style={{ margin: 0 }}>Module mode</span>
        <span className={`stchip ${mode === 'trial' ? 'st-open' : 'st-done'}`}>{mode}</span>
      </div>
      {mode === 'trial' ? (
        <p className="hint" style={{ marginBottom: 12 }}>
          The team is rehearsing. Everything they enter is kept but marked as practice, and every screen,
          stock level and report is showing practice numbers. When you are satisfied the module works,
          switch to live: every screen starts empty and real operations begin. Nothing is deleted, the
          practice entries simply stop being counted, and this can be undone.
        </p>
      ) : (
        <p className="hint" style={{ marginBottom: 12 }}>
          Real operations. Only entries made since the switch are counted. Going back to trial would hide
          the real entries and show the practice ones again, so use it only to inspect an old trial.
        </p>
      )}
      {!canSwitch ? (
        <p className="hint">Only a super admin can change this.</p>
      ) : !arming ? (
        <button className="ghostbtn" onClick={() => { setArming(true); setMsg(null); }}>
          {mode === 'trial' ? 'Start the real run (clean slate)' : 'Return to trial'}
        </button>
      ) : (
        <div className="ractions">
          <input className="qtyin" style={{ width: 320, textAlign: 'left' }} autoFocus
            placeholder={mode === 'trial' ? 'Why now? e.g. trial signed off by the chef' : 'Why go back to trial?'}
            value={why} onChange={(e) => setWhy(e.target.value)} />
          <button className="primary" disabled={busy || !why.trim()} onClick={go}>
            {busy ? 'Switching…' : `Yes, switch to ${target}`}
          </button>
          <button className="ghostbtn" disabled={busy} onClick={() => { setArming(false); setWhy(''); }}>Cancel</button>
        </div>
      )}
      {msg && <p className={msg.ok ? 'saved-pill' : 'err'} style={{ display: 'inline-block', marginTop: 10 }}>{msg.text}</p>}
    </div>
  );
}
