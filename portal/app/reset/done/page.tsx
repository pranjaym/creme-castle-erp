import { KITCHEN_URL } from '@/lib/password-reset';

// After a new password is saved through an emailed link. The person is already
// signed in to the portal; a kitchen user is pointed back to the kitchen app,
// where they sign in with the new password.
export default async function ResetDone({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  const kitchen = from === 'kitchen';
  return (
    <div className="loginwrap">
      <div className="card center">
        <span className="brand">Creme Castle ERP</span>
        <div className="ok" style={{ marginTop: 16 }}>Password changed.</div>
        <p className="lede">
          {kitchen
            ? 'Sign in to the kitchen app with your new password.'
            : 'You are signed in. Use the new password from now on.'}
        </p>
        <p className="note">A short email confirms the change, so a change nobody made gets noticed.</p>
        <a className="primary btnlink" href={kitchen ? `${KITCHEN_URL}/login` : '/'}>
          {kitchen ? 'Open the kitchen app' : 'Continue'}
        </a>
      </div>
    </div>
  );
}
