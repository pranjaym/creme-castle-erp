'use client';
import { useActionState } from 'react';
import { login } from './actions';

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="loginform">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="username"
        autoFocus required placeholder="you@cremecastle.in" />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password"
        autoComplete="current-password" required placeholder="Your password" />
      {/* Password reset by emailed link lives in the ERP portal (same login);
          ?from=kitchen sends the person back here afterwards. */}
      <a href="https://creme-castle-erp.vercel.app/forgot?from=kitchen"
        style={{ alignSelf: 'flex-end', fontSize: 13, fontWeight: 600, color: 'var(--coral-dark, #BE4127)', marginTop: 6 }}>
        Forgot password?
      </a>
      {state?.error ? <div className="err">{state.error}</div> : null}
      <button className="primary" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
