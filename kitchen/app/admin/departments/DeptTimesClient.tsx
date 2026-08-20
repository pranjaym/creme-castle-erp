'use client';
// Admin · Departments: edit day-start and count-by times inline.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { setDeptTimes } from '../actions';

type Dept = { code: string; name: string; dayStart: string; closingBefore: string; active: boolean };

export default function DeptTimesClient({ depts }: { depts: Dept[] }) {
  const router = useRouter();
  const [who, setWho] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState('');
  useEffect(() => { const w = localStorage.getItem('cc-who-admin'); if (w) setWho(w); }, []);
  const actor = `admin${who ? `/${who.trim()}` : ''}`;

  async function save(code: string, ds: string, cb: string) {
    setBusyKey(code); setMsg(null);
    const res = await setDeptTimes(code, ds, cb, actor);
    setBusyKey('');
    setMsg({ ok: res.ok, text: res.message });
    if (res.ok) router.refresh();
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <div className="eyebrow" style={{ margin: 0 }}>Day windows (IST)</div>
        <input className="whoin" placeholder="Your name (for the audit)" style={{ width: 200 }}
          value={who} onChange={(e) => { setWho(e.target.value); localStorage.setItem('cc-who-admin', e.target.value); }} />
        {msg && <span className={msg.ok ? 'saved-pill' : 'err'}>{msg.text}</span>}
      </div>
      <div className="tablewrap admincard" style={{ maxWidth: 680 }}>
        <table className="sheet slim" style={{ border: 'none' }}>
          <thead><tr><th>Department</th><th>Day starts</th><th>Count by</th><th></th></tr></thead>
          <tbody>
            {depts.map((d) => <Row key={d.code} d={d} busy={busyKey === d.code} onSave={save} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Row({ d, busy, onSave }: { d: Dept; busy: boolean; onSave: (code: string, ds: string, cb: string) => void }) {
  const [ds, setDs] = useState(d.dayStart);
  const [cb, setCb] = useState(d.closingBefore);
  const dirty = ds !== d.dayStart || cb !== d.closingBefore;
  return (
    <tr>
      <td className="name">{d.name} <small className="unit">{d.code}</small></td>
      <td><input className="qtyin" style={{ width: 90 }} value={ds} onChange={(e) => setDs(e.target.value)} placeholder="HH:MM" /></td>
      <td><input className="qtyin" style={{ width: 90 }} value={cb} onChange={(e) => setCb(e.target.value)} placeholder="HH:MM" /></td>
      <td>{dirty && <button className="ghostbtn" disabled={busy} onClick={() => onSave(d.code, ds, cb)}>{busy ? 'Saving…' : 'Save'}</button>}</td>
    </tr>
  );
}
