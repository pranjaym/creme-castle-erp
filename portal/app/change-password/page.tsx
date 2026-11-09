import { redirect } from 'next/navigation';
import { authClient } from '@/lib/supabase/authClient';
import ChangeForm from './ChangeForm';
import { signOutHere } from './actions';

// Where the middleware sends anyone whose login is marked "must change
// password" (an admin-typed temporary password, or a brand new account).
// Nothing else in the portal opens until they choose their own.
export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const supabase = await authClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  if (user.app_metadata?.must_change_password !== true) redirect('/');
  const { err } = await searchParams;
  return (
    <div className="loginwrap">
      <div className="card">
        <span className="brand">Creme Castle ERP</span>
        <span className="sub">Choose your own password</span>
        <div className="hint warn" style={{ margin: '0 0 6px' }}>
          You signed in with a temporary password from the admin. Choose your own to carry on.
        </div>
        <p className="note" style={{ marginTop: 0 }}>Signed in as {user.email}</p>
        <ChangeForm initialError={err ?? null} />
        <form action={signOutHere}>
          <button className="ghostbtn" type="submit">Sign out</button>
        </form>
      </div>
    </div>
  );
}
