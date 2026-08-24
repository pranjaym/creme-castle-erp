import Link from 'next/link';
import { requireAdmin, type Role } from '@/lib/session';
import { spine } from '@/lib/supabase/service';
import { ROLE_LABEL, roleDef } from './roles';

// Admin only: the list of people. One row each, read only, with an Edit
// button. Nothing is editable in the table itself, which is the change
// Pranjay asked for on 24 Aug: the old screen put a role dropdown, a
// five-line outlet multi-select and a Save button inside every single row.
//
// Adding and editing happen on their own pages, role first (see UserForm).

export const dynamic = 'force-dynamic';

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  active: boolean;
  outlet_codes: string[];
  created_at: string;
}

interface OutletRow { internal_code: string; area_manager: string | null }

// What this account can see, in one short phrase.
function scopeOf(p: ProfileRow, outlets: OutletRow[]): string {
  const need = roleDef(p.role).needs;
  if (need === 'nothing') return 'Whole network';
  const codes = p.outlet_codes ?? [];
  if (!codes.length) return 'Nothing set';
  if (need === 'outlet') return codes[0];
  const area = outlets.find(o => codes.includes(o.internal_code))?.area_manager;
  return area ? `${area}'s area (${codes.length} stores)` : `${codes.length} stores`;
}

export default async function UsersPage({ searchParams }:
  { searchParams: Promise<{ ok?: string; err?: string }> }) {
  await requireAdmin();
  const { ok, err } = await searchParams;

  const db = spine();
  const [{ data: profiles }, { data: outlets }] = await Promise.all([
    db.from('profiles')
      .select('id, email, full_name, role, active, outlet_codes, created_at')
      .order('role').order('email'),
    db.from('outlets')
      .select('internal_code, area_manager').eq('active', true).order('internal_code'),
  ]);

  const rows = (profiles ?? []) as ProfileRow[];
  const outletRows = (outlets ?? []) as OutletRow[];
  const off = rows.filter(r => !r.active).length;

  return (
    <>
      <div className="spread">
        <div>
          <h1 className="page">People and access</h1>
          <p className="hint">
            The role decides what a person sees everywhere in the portal: a store account
            sees its one store, an area manager their area, central and admin the whole
            network. Accounts are switched off, never deleted, and every change here is
            written to a log that cannot be edited.
          </p>
        </div>
        <Link className="btn btn-primary" href="/users/new">Add a person</Link>
      </div>

      {ok ? <p className="ok">{ok}</p> : null}
      {err ? <p className="err">{err}</p> : null}

      <p className="note" style={{ marginBottom: 10 }}>
        {rows.length} accounts{off ? `, ${off} switched off` : ''}.
      </p>

      <div className="scroll-x">
        <table className="sheet">
          <thead>
            <tr>
              <th>Name</th>
              <th>Login</th>
              <th>Role</th>
              <th>Sees</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (
              <tr key={p.id}>
                <td className="name">{p.full_name || <span className="muted">not set</span>}</td>
                <td>{p.email}</td>
                <td>{ROLE_LABEL(p.role)}</td>
                <td>{scopeOf(p, outletRows)}</td>
                <td>
                  {p.active
                    ? <span className="badge-on">on</span>
                    : <span className="badge-off">off</span>}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <Link className="btn btn-secondary btn-row" href={`/users/${p.id}`}>Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
