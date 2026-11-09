'use client';

// Two boxes and two live checks; the button wakes up when both are ticked.
// Shared by the emailed-link page (/reset) and the must-change page
// (/change-password). The server checks the same rules again.
import { useState } from 'react';

const MIN = 8;

export default function NewPasswordForm({ pending, submitLabel, error }: {
  pending: boolean; submitLabel: string; error?: string | null;
}) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [show, setShow] = useState(false);
  const longEnough = a.trim().length >= MIN;
  const match = longEnough && a.trim() === b.trim();
  const type = show ? 'text' : 'password';
  return (
    <>
      <label className="fld" htmlFor="np1">New password</label>
      <input className="txt" id="np1" name="password" type={type} autoComplete="new-password" required
        minLength={MIN} placeholder={`At least ${MIN} characters`} value={a} onChange={(e) => setA(e.target.value)} />
      <label className="fld" htmlFor="np2">Type it again</label>
      <input className="txt" id="np2" name="password2" type={type} autoComplete="new-password" required
        minLength={MIN} value={b} onChange={(e) => setB(e.target.value)} />
      <label className="showpw" htmlFor="npshow">
        <input type="checkbox" id="npshow" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
      </label>
      <ul className="pwrules">
        <li className={longEnough ? 'met' : ''}><span className="dot">{longEnough ? '✓' : ''}</span>At least {MIN} characters</li>
        <li className={match ? 'met' : ''}><span className="dot">{match ? '✓' : ''}</span>Both boxes match</li>
      </ul>
      {error ? <div className="err">{error}</div> : null}
      <button className="primary" type="submit" disabled={pending || !match}>
        {pending ? 'Saving...' : submitLabel}
      </button>
    </>
  );
}
