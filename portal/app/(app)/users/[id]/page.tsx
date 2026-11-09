import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin, type Role } from '@/lib/session';
import { spine } from '@/lib/supabase/service';
import UserForm, { type Outlet, type ExistingUser } from '../UserForm';
import { ROLE_DEFS } from '../roles';
import { resetPassword, emailResetLink } from '../actions';
import { historyLine } from '@/lib/password-reset';
import { istDay, istTime } from '@/lib/mail';

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
      .select('id, email, full_name, role, active, outlet_codes, modules')
      .eq('id', id).maybeSingle(),
    db.from('outlets')
      .select('internal_code, area_manager').eq('active', true).order('internal_code'),
  ]);
  if (!profile) notFound();

  // Everything that happened to this login's password, newest first, read from
  // the append-only portal_admin_log. The password itself is never in it.
  const { data: logRows } = await db.from('portal_admin_log')
    .select('at, action, actor_email, detail')
    .eq('target', String(profile.email ?? '').toLowerCase())
    .in('action', ['password_link_requested', 'password_link_limited', 'password_link_expired',
      'password_changed_by_link', 'password_changed_forced', 'password_changed_self', 'password_reset', 'user_created'])
    .order('at', { ascending: false }).limit(25);
  const history = (logRows ?? [])
    .map(r => ({ at: new Date(r.at as string), line: historyLine(r.action as string, r.detail as Record<string, unknown> | null, r.actor_email as string | null) }))
    .filter((r): r is { at: Date; line: string } => r.line !== null);

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

      <h2 className="section">Password</h2>
      <div className="pwopts">
        <form action={emailResetLink} className="card">
          <input type="hidden" name="id" value={existing.id} />
          <h3>Email them a reset link</h3>
          <p className="hint">
            The usual way. They get a link that works once, within 1 hour, and choose their own
            password. Their current password keeps working until they use it. Nobody reads a
            password out loud.
          </p>
          <button className="btn btn-primary" type="submit">Email reset link</button>
        </form>
        <form action={resetPassword} className="card">
          <input type="hidden" name="id" value={existing.id} />
          <input type="hidden" name="email" value={existing.email} />
          <h3>Set a temporary password</h3>
          <p className="hint">
            For someone who cannot open their email. It replaces the password at once. Read it
            out on a call, not by email or WhatsApp. They must choose their own the moment they
            sign in.
          </p>
          <label className="fld" htmlFor="pw">Temporary password</label>
          <input className="txt" id="pw" name="password" type="text" required minLength={8}
            placeholder="at least 8 characters" autoComplete="off" />
          <div className="formfoot">
            <button className="btn btn-danger" type="submit">Set temporary password</button>
          </div>
        </form>
      </div>

      <h2 className="section">Password history</h2>
      {history.length === 0
        ? <p className="hint">Nothing recorded for this login yet.</p>
        : (
          <div className="scroll-x">
            <table className="sheet">
              <thead><tr><th>When</th><th>What happened</th></tr></thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={i}><td className="tabular" style={{ whiteSpace: 'nowrap' }}>{istDay(h.at)}, {istTime(h.at)}</td><td>{h.line}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      <p className="hint">Changes made in the kitchen app&rsquo;s own admin screen are recorded there, not here.</p>
    </>
  );
}
