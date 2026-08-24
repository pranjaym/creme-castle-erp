import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin, type Role } from '@/lib/session';
import { spine } from '@/lib/supabase/service';
import UserForm, { type Outlet, type ExistingUser } from '../UserForm';
import { ROLE_DEFS } from '../roles';
import { resetPassword } from '../actions';

// Edit one person. Same two-step shape as adding, with the role already
// chosen, plus the two things only an existing account needs: an on/off
// switch and a new temporary password (they were issued on paper, so
// "I lost mine" is routine and must be one button).
export const dynamic = 'force-dynamic';

export default async function EditUserPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ role?: string; ok?: string; err?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;

  const db = spine();
  const [{ data: profile }, { data: outlets }] = await Promise.all([
    db.from('profiles')
      .select('id, email, full_name, role, active, outlet_codes')
      .eq('id', id).maybeSingle(),
    db.from('outlets')
      .select('internal_code, area_manager').eq('active', true).order('internal_code'),
  ]);
  if (!profile) notFound();

  const existing = profile as ExistingUser;
  // The role cards double as a role CHANGE: ?role= wins over what is stored.
  const chosen: Role = ROLE_DEFS.some(d => d.role === sp.role)
    ? (sp.role as Role) : existing.role;

  return (
    <>
      <p className="note" style={{ marginTop: 0 }}>
        <Link href="/users">People and access</Link> / {existing.email}
      </p>
      <h1 className="page">{existing.full_name || existing.email}</h1>
      <p className="hint">
        Changing the role here changes what this person sees everywhere in the portal, the
        moment they next load a page.
      </p>
      {sp.ok ? <p className="ok">{sp.ok}</p> : null}
      {sp.err ? <p className="err">{sp.err}</p> : null}

      <UserForm basePath={`/users/${existing.id}`} chosen={chosen}
        outlets={(outlets ?? []) as Outlet[]} existing={existing} />

      <h2 className="section">Give them a new password</h2>
      <p className="hint">
        Use this when someone has lost or forgotten theirs. It replaces the password
        immediately; the old one stops working. Hand the new one over in person or on a
        call, not by email or WhatsApp.
      </p>
      <form action={resetPassword} className="card userform">
        <input type="hidden" name="id" value={existing.id} />
        <input type="hidden" name="email" value={existing.email} />
        <label className="fld" htmlFor="pw">New temporary password</label>
        <input className="txt" id="pw" name="password" type="text" required minLength={8}
          placeholder="at least 8 characters" autoComplete="off" />
        <div className="formfoot">
          <button className="btn btn-danger" type="submit">Set new password</button>
        </div>
      </form>
    </>
  );
}
