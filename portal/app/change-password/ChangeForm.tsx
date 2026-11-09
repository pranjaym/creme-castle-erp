'use client';

import { useActionState } from 'react';
import { chooseOwnPassword, type ChangeState } from './actions';
import NewPasswordForm from '../reset/NewPasswordForm';

export default function ChangeForm({ initialError }: { initialError: string | null }) {
  const [state, action, pending] = useActionState<ChangeState, FormData>(chooseOwnPassword, null);
  const error = state?.kind === 'error' ? state.message : initialError;
  return (
    <form action={action}>
      <NewPasswordForm pending={pending} submitLabel="Save and carry on" error={error} />
    </form>
  );
}
