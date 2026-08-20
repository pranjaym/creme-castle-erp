// Kitchen login. One account per department (shared on the floor tablet) or
// per person (management). Same email + password as the ERP portal.
import LoginForm from './LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const next = typeof sp.next === 'string' ? sp.next : '';
  return (
    <main className="loginwrap">
      <div className="logincard">
        <div className="brand" style={{ fontSize: 28 }}>Creme Castle</div>
        <div className="sub" style={{ marginBottom: 18 }}>Kitchen · sign in</div>
        <LoginForm next={next} />
        <p className="hint" style={{ marginTop: 16 }}>
          No self signup. Accounts are given out by the office; a department account
          opens straight onto that department&rsquo;s screen.
        </p>
      </div>
    </main>
  );
}
