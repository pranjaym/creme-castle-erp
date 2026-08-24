import { requireAdmin, type Role } from '@/lib/session';
import { spine } from '@/lib/supabase/service';
import { createUser, updateUser } from './actions';

// Admin-only: the users switchboard. One row per account; the role plus outlet
// scope here decides what every module shows that person (role equals scope).
// Accounts are deactivated, never deleted.

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  active: boolean;
  outlet_codes: string[];
  created_at: string;
}

interface OutletRow {
  internal_code: string;
  area_manager: string | null;
  active: boolean;
}

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  central: 'Central',
  area_manager: 'Area manager',
  store: 'Store',
  viewer: 'Viewer (old)',
};

function RoleSelect({ name, value, formId }: { name: string; value: Role; formId?: string }) {
  return (
    <select className="mini txt" name={name} defaultValue={value} form={formId} style={{ maxWidth: 160 }}>
      {(Object.keys(ROLE_LABELS) as Role[]).map(r => (
        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
      ))}
    </select>
  );
}

function OutletSelect({ name, selected, outlets, formId }:
  { name: string; selected: string[]; outlets: OutletRow[]; formId?: string }) {
  return (
    <select className="mini" name={name} multiple defaultValue={selected} form={formId} size={5}>
      {outlets.map(o => (
        <option key={o.internal_code} value={o.internal_code}>
          {o.internal_code}{o.area_manager ? ` (${o.area_manager})` : ''}
        </option>
      ))}
    </select>
  );
}

export default async function UsersPage({ searchParams }:
  { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const user = await requireAdmin();
  const { ok, err } = await searchParams;

  const db = spine();
  const [{ data: profiles }, { data: outlets }] = await Promise.all([
    db.from('profiles')
      .select('id, email, full_name, role, active, outlet_codes, created_at')
      .order('created_at', { ascending: true }),
    db.from('outlets')
      .select('internal_code, area_manager, active')
      .eq('active', true)
      .order('internal_code'),
  ]);

  const rows = (profiles ?? []) as ProfileRow[];
  const outletRows = (outlets ?? []) as OutletRow[];

  return (
    <main>
      <h1 className="page">Users</h1>
      <p className="hint">
        The role decides what a person sees everywhere: a store account sees its one store,
        an area manager their outlets, central and admin everything. Accounts are
        deactivated, never deleted, and every change here is logged.
      </p>
      {ok ? <p className="ok">{ok}</p> : null}
      {err ? <p className="err">{err}</p> : null}

      <h2 className="section">All accounts ({rows.length})</h2>
      {/* Row edit forms live outside the table (a form cannot be a table child);
          the controls in each row point at their form via the form attribute. */}
      {rows.map(p => (
        <form key={p.id} id={`f-${p.id}`} action={updateUser}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="email" value={p.email ?? ''} />
        </form>
      ))}
      <table className="sheet">
        <thead>
          <tr>
            <th>Who</th><th>Role</th><th>Outlets</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.id}>
              <td>
                <span className="name">{p.full_name || p.email}</span>
                {p.full_name ? <div className="note" style={{ marginTop: 2 }}>{p.email}</div> : null}
              </td>
              <td><RoleSelect name="role" value={p.role} formId={`f-${p.id}`} /></td>
              <td>
                <OutletSelect name="outlets" selected={p.outlet_codes ?? []} outlets={outletRows} formId={`f-${p.id}`} />
                <div className="note">Store: pick one. Area manager: pick theirs. Others: leave empty for all.</div>
              </td>
              <td>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 14 }}>
                  <input type="checkbox" name="active" defaultChecked={p.active} form={`f-${p.id}`} /> active
                </label>
                {!p.active ? <div style={{ marginTop: 6 }}><span className="badge-off">deactivated</span></div> : null}
              </td>
              <td><button className="smallbtn" type="submit" form={`f-${p.id}`}>Save</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 className="section">Add an account</h2>
      <form action={createUser} className="card" style={{ maxWidth: 640 }}>
        <div className="row">
          <div>
            <label className="fld" htmlFor="nu-email">Email</label>
            <input className="txt" id="nu-email" name="email" type="email" required placeholder="name@cremecastle.in" />
          </div>
          <div>
            <label className="fld" htmlFor="nu-name">Full name</label>
            <input className="txt" id="nu-name" name="full_name" placeholder="optional" />
          </div>
        </div>
        <div className="row">
          <div>
            <label className="fld" htmlFor="nu-role">Role</label>
            <RoleSelect name="role" value={'store'} />
          </div>
          <div>
            <label className="fld" htmlFor="nu-pass">Temporary password</label>
            <input className="txt" id="nu-pass" name="password" type="text" required minLength={8}
              placeholder="at least 8 characters" autoComplete="off" />
          </div>
        </div>
        <label className="fld">Outlets (for store and area manager roles)</label>
        <OutletSelect name="outlets" selected={[]} outlets={outletRows} />
        <div className="note">Hold Cmd (Mac) or Ctrl to pick more than one.</div>
        <div style={{ marginTop: 18 }}>
          <button className="primary" type="submit">Create account</button>
        </div>
        <p className="note">
          Share the temporary password with the person directly (call or in person, not email),
          and ask them to change it after first sign-in.
        </p>
      </form>
    </main>
  );
}
