import Link from 'next/link';
import type { Role } from '@/lib/session';
import { ROLE_DEFS, roleDef } from './roles';
import { createUser, updateUser } from './actions';

// The add/edit form, role first.
//
// Pranjay, 24 Aug: the old screen was "very complicated, not the best form".
// It was: every account was an editable row inside the table, and every row
// carried a five-line multi-select of all 41 outlets whatever the role. This
// replaces it with two steps on their own page.
//
//   Step 1  Pick the role. Nothing else is on screen yet.
//   Step 2  Only the fields that role actually needs:
//             store          one store dropdown
//             area manager   one AREA dropdown (its stores follow the master)
//             central/admin  nothing further
//
// Step 1 is plain links carrying ?role=, so the page is server-rendered and
// there is no client JavaScript in the form at all.

export interface Outlet { internal_code: string; area_manager: string | null }

export interface ExistingUser {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  active: boolean;
  outlet_codes: string[];
}

export default function UserForm({ basePath, chosen, outlets, existing }: {
  /** Where the role cards link back to: /users/new or /users/<id>. */
  basePath: string;
  /** The role picked so far, or null while step 1 is still open. */
  chosen: Role | null;
  outlets: Outlet[];
  existing?: ExistingUser;
}) {
  const areas = Array.from(
    new Set(outlets.map(o => o.area_manager).filter((a): a is string => !!a)),
  ).sort();

  const cards = ROLE_DEFS.filter(d => !d.legacy || existing?.role === d.role);

  return (
    <div className="userform">
      <section className="step">
        <div className="steplabel">
          <span className="stepnum">1</span>
          <span className="steptitle">What is this person?</span>
        </div>
        <div className="rolepick">
          {cards.map(d => (
            <Link key={d.role}
              href={`${basePath}?role=${encodeURIComponent(d.role)}`}
              className={chosen === d.role ? 'on' : undefined}>
              <div className="rt">{d.label}</div>
              <div className="rd">{d.blurb}</div>
            </Link>
          ))}
        </div>
      </section>

      {!chosen ? (
        <p className="hint">Pick one above and the rest of the form appears.</p>
      ) : (
        <form action={existing ? updateUser : createUser}>
          <input type="hidden" name="role" value={chosen} />
          {existing ? <input type="hidden" name="id" value={existing.id} /> : null}
          {existing ? <input type="hidden" name="email" value={existing.email} /> : null}

          <section className="step">
            <div className="steplabel">
              <span className="stepnum">2</span>
              <span className="steptitle">
                {roleDef(chosen).needs === 'nothing' ? 'Who is it?' : 'Who is it, and where?'}
              </span>
            </div>

            <label className="fld" htmlFor="uf-name">Full name</label>
            <input className="txt" id="uf-name" name="full_name"
              defaultValue={existing?.full_name ?? ''} placeholder="Ravi Kumar" />

            {existing ? (
              <>
                <label className="fld">Email</label>
                <div style={{ fontSize: 14 }}>
                  {existing.email}
                  <span className="note" style={{ display: 'block' }}>
                    The email is the login name and cannot be changed here.
                  </span>
                </div>
              </>
            ) : (
              <>
                <label className="fld" htmlFor="uf-email">Email (this is their login)</label>
                <input className="txt" id="uf-email" name="email" type="email" required
                  placeholder="name@cremecastle.in" autoComplete="off" />
              </>
            )}

            {roleDef(chosen).needs === 'outlet' ? (
              <>
                <label className="fld" htmlFor="uf-outlet">Which store</label>
                <select className="txt" id="uf-outlet" name="outlet" required
                  defaultValue={existing?.outlet_codes?.[0] ?? ''}>
                  <option value="" disabled>Choose a store</option>
                  {outlets.map(o => (
                    <option key={o.internal_code} value={o.internal_code}>
                      {o.internal_code}{o.area_manager ? ` (${o.area_manager}'s area)` : ''}
                    </option>
                  ))}
                </select>
                <p className="note">They will see this store and no other.</p>
              </>
            ) : null}

            {roleDef(chosen).needs === 'area' ? (
              <>
                <label className="fld" htmlFor="uf-area">Which area</label>
                <select className="txt" id="uf-area" name="area" required
                  defaultValue={guessArea(outlets, existing?.outlet_codes ?? [])}>
                  <option value="" disabled>Choose an area</option>
                  {areas.map(a => {
                    const n = outlets.filter(o => o.area_manager === a).length;
                    return (
                      <option key={a} value={a}>
                        {a} ({n} {n === 1 ? 'store' : 'stores'})
                      </option>
                    );
                  })}
                </select>
                <p className="note">
                  Their stores come from the outlet master. Move a store between areas there
                  and this account follows, with nothing to change here.
                </p>
              </>
            ) : null}

            {roleDef(chosen).needs === 'nothing' ? (
              <p className="note">Nothing else to set: this role sees the whole network.</p>
            ) : null}
          </section>

          {!existing ? (
            <section className="step">
              <div className="steplabel">
                <span className="stepnum">3</span>
                <span className="steptitle">First password</span>
              </div>
              <label className="fld" htmlFor="uf-pass">Temporary password</label>
              <input className="txt" id="uf-pass" name="password" type="text" required
                minLength={8} placeholder="at least 8 characters" autoComplete="off" />
              <p className="note">
                Give it to them in person or on a call, never by email or WhatsApp, and ask
                them to change it from Change password after their first sign-in.
              </p>
            </section>
          ) : (
            <section className="step">
              <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
                <input type="checkbox" name="active" defaultChecked={existing.active} />
                Account is switched on
              </label>
              <p className="note">
                Switching an account off blocks sign-in and keeps every record. Accounts are
                never deleted.
              </p>
            </section>
          )}

          <div className="formfoot">
            <button className="btn btn-primary" type="submit">
              {existing ? 'Save changes' : 'Create the account'}
            </button>
            <Link className="btn btn-secondary" href="/users">Cancel</Link>
          </div>
        </form>
      )}
    </div>
  );
}

// An existing area manager's area is whatever area their current outlets sit
// in. Read it back rather than storing it twice: the outlet master stays the
// single source of the mapping.
function guessArea(outlets: Outlet[], codes: string[]): string {
  const hit = outlets.find(o => codes.includes(o.internal_code) && o.area_manager);
  return hit?.area_manager ?? '';
}
