import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import LoginForm from './LoginForm';

// The one public page. If already signed in, skip straight to the destination.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';

  const user = await getSessionUser();
  if (user) redirect(dest);

  return (
    <div className="loginwrap">
      <div className="card">
        <span className="brand">Creme Castle ERP</span>
        <span className="sub">Sign in to continue</span>
        <LoginForm next={dest} />
        <div className="note">Accounts are created by an admin. Ask if you need access.</div>
      </div>
    </div>
  );
}
