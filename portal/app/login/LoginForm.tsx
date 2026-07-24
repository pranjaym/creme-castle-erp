'use client';

import { useActionState } from 'react';
import { login } from './actions';

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <label className="fld" htmlFor="email">Email</label>
      <input className="txt" id="email" name="email" type="email" autoComplete="username"
        autoFocus required placeholder="you@cremecastle.in" />
      <label className="fld" htmlFor="password">Password</label>
      <input className="txt" id="password" name="password" type="password"
        autoComplete="current-password" required placeholder="Your password" />
      {state?.error ? <div className="err">{state.error}</div> : null}
      <button className="primary" type="submit" disabled={pending}>
        {pending ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
