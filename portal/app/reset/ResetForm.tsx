'use client';

import { useActionState } from 'react';
import { chooseNewPassword, type ResetState } from './actions';
import NewPasswordForm from './NewPasswordForm';
import Expired from './Expired';

export default function ResetForm({ token, from }: { token: string; from: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(chooseNewPassword, null);
  if (state?.kind === 'expired') return <Expired from={from} />;
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="from" value={from} />
      <NewPasswordForm pending={pending} submitLabel="Save and sign in"
        error={state?.kind === 'error' ? state.message : null} />
    </form>
  );
}
