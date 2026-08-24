import { requireUser } from '@/lib/session';
import { changePassword } from './actions';

export default async function AccountPage({ searchParams }:
  { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireUser();
  const { ok, err } = await searchParams;
  return (
    <main>
      <h1 className="page">Change password</h1>
      <p className="hint">Signed in as {user.email}. Pick a password only you know; nobody can read it back later.</p>
      {ok ? <p className="ok">{ok}</p> : null}
      {err ? <p className="err">{err}</p> : null}
      <form action={changePassword} className="card" style={{ maxWidth: 420 }}>
        <label className="fld" htmlFor="pw1">New password</label>
        <input className="txt" id="pw1" name="password" type="password" required minLength={8} autoComplete="new-password" />
        <label className="fld" htmlFor="pw2">Same password, again</label>
        <input className="txt" id="pw2" name="password2" type="password" required minLength={8} autoComplete="new-password" />
        <div style={{ marginTop: 18 }}>
          <button className="primary" type="submit">Change password</button>
        </div>
      </form>
    </main>
  );
}
