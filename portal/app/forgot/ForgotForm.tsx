'use client';

import { useActionState } from 'react';
import { askForLink, type ForgotState } from './actions';

export default function ForgotForm({ from, backHref }: { from: string; backHref: string }) {
  const [state, action, pending] = useActionState<ForgotState, FormData>(askForLink, null);

  if (state?.kind === 'sent') {
    return (
      <div className="center">
        <div className="h-reset">Check your email</div>
        <p className="lede">If <b className="addr">{state.email}</b> has an account, a link is on its way.</p>
        <p className="note">
          The link works once, within 1 hour. Your current password keeps working until you use it.
          Not there in 2 minutes? Check Spam. You can ask for another link at {state.againAt}.
        </p>
        <a className="ghostbtn" href={backHref}>Back to sign in</a>
      </div>
    );
  }

  return (
    <form action={action}>
      <input type="hidden" name="from" value={from} />
      <p className="lede">Type the email you sign in with. We will email you a link to choose a new password.</p>
      <label className="fld" htmlFor="email">Email</label>
      <input className="txt" id="email" name="email" type="email" autoComplete="username"
        autoFocus required placeholder="you@cremecastle.in" defaultValue={state?.email ?? ''} />
      {state?.kind === 'error' ? <div className="err">{state.message}</div> : null}
      <button className="primary" type="submit" disabled={pending}>
        {pending ? 'Sending...' : 'Email me a link'}
      </button>
      <a className="ghostbtn" href={backHref}>Back to sign in</a>
    </form>
  );
}
