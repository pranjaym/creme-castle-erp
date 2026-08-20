'use client';
// Admin · Users: create accounts, set role and department, deactivate, reset a
// forgotten password. Passwords are typed by the admin and shared off-app; the
// app never emails anything (no SMTP dependency on the floor).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createUser, setUserAccess, setUserActive, resetPassword } from './actions';

type User = {
  id: string; email: string; fullName: string; portalRole: string;
  active: boolean; kitchenRole: string; deptCode: string;
};
type Dept = { code: string; name: string };

const ROLE_LABEL: Record<string, string> = {
  department: 'Department', exec_chef: 'Executive chef', tech: 'Tech', super_admin: 'Super admin', '': 'No kitchen access',
};

export default function UsersClient({ users, depts }: { users: User[]; depts: Dept[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busyKey, setBusyKey] = useState('');

  async function run(key: string, fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusyKey(key); setMsg(null);
    const res = await fn();
    setBusyKey('');
    setMsg({ ok: res.ok, text: res.message });
    if (res.ok) router.refresh();
  }

  return (
    <>
      {msg && <p className={msg.ok ? 'saved-pill' : 'err'} style={{ display: 'inline-block', marginBottom: 12 }}>{msg.text}</p>}

      <div className="adminsect">
        <div className="eyebrow">Create an account</div>
        <CreateForm depts={depts} busy={busyKey === 'create'} onCreate={(input) => run('create', () => createUser(input))} />
      </div>

      <div className="eyebrow">All accounts ({users.length})</div>
      <div className="tablewrap admincard">
        <table className="sheet slim" style={{ border: 'none' }}>
          <thead><tr>
            <th>Active</th><th>Email</th><th>Name</th><th>Kitchen role</th><th>Department</th><th>Password</th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <UserRow key={u.id} u={u} depts={depts} busy={busyKey.startsWith(`u-${u.id}`)}
                run={(field, fn) => run(`u-${u.id}-${field}`, fn)} />
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>
        A department account is shared by that team on the floor tablet; the &ldquo;Your name&rdquo; box on their
        screen says who exactly typed an entry. Deactivating an account blocks sign-in everywhere (kitchen and portal) but keeps all history.
      </p>
    </>
  );
}

function UserRow({ u, depts, busy, run }: {
  u: User; depts: Dept[]; busy: boolean;
  run: (field: string, fn: () => Promise<{ ok: boolean; message: string }>) => void;
}) {
  const [role, setRole] = useState(u.kitchenRole);
  const [dept, setDept] = useState(u.deptCode);
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const accessDirty = role !== u.kitchenRole || (role === 'department' && dept !== u.deptCode);

  return (
    <tr style={u.active ? undefined : { opacity: 0.45 }}>
      <td>
        <button className={`livebtn ${u.active ? 'on' : ''}`} disabled={busy}
          onClick={() => run('active', () => setUserActive(u.id, !u.active))}>
          {u.active ? 'ON' : 'OFF'}
        </button>
      </td>
      <td className="name">{u.email}</td>
      <td>{u.fullName}</td>
      <td>
        <span className="cellwrap">
          <select value={role} disabled={busy} style={{ minWidth: 150 }} onChange={(e) => setRole(e.target.value)}>
            <option value="">No kitchen access</option>
            {Object.entries(ROLE_LABEL).filter(([k]) => k).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </span>
      </td>
      <td>
        <span className="cellwrap">
          {role === 'department' ? (
            <select value={dept} disabled={busy} style={{ minWidth: 140 }} onChange={(e) => setDept(e.target.value)}>
              <option value="">choose…</option>
              {depts.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
            </select>
          ) : <span className="unit">n/a</span>}
          {accessDirty && role && (role !== 'department' || dept) && (
            <button className="usebtn" disabled={busy}
              onClick={() => run('access', () => setUserAccess(u.id, role, role === 'department' ? dept : null))}>save</button>
          )}
        </span>
      </td>
      <td>
        <span className="cellwrap">
          {!showPw ? (
            <button className="usebtn" disabled={busy} onClick={() => setShowPw(true)}>reset</button>
          ) : (
            <>
              <input className="qtyin" style={{ width: 140, textAlign: 'left' }} placeholder="new password"
                value={pw} onChange={(e) => setPw(e.target.value)} />
              <button className="usebtn" disabled={busy || pw.length < 8}
                onClick={() => run('pw', async () => { const r = await resetPassword(u.id, pw); if (r.ok) { setPw(''); setShowPw(false); } return r; })}>set</button>
              <button className="usebtn" disabled={busy} onClick={() => { setShowPw(false); setPw(''); }}>cancel</button>
            </>
          )}
        </span>
      </td>
    </tr>
  );
}

function CreateForm({ depts, busy, onCreate }: {
  depts: Dept[]; busy: boolean;
  onCreate: (input: { email: string; password: string; fullName: string; role: string; deptCode: string | null }) => void;
}) {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('department');
  const [deptCode, setDeptCode] = useState(depts[0]?.code ?? '');
  const [password, setPassword] = useState('');

  const ready = email.includes('@') && password.length >= 8 && (role !== 'department' || deptCode);
  return (
    <div className="addform">
      <input className="qtyin" style={{ width: 230, textAlign: 'left' }} placeholder="email@cremecastle.in"
        value={email} onChange={(e) => setEmail(e.target.value)} />
      <input className="qtyin" style={{ width: 170, textAlign: 'left' }} placeholder="Full name"
        value={fullName} onChange={(e) => setFullName(e.target.value)} />
      <select value={role} onChange={(e) => setRole(e.target.value)} style={{ minWidth: 150 }}>
        <option value="department">Department</option>
        <option value="exec_chef">Executive chef</option>
        <option value="tech">Tech</option>
        <option value="super_admin">Super admin</option>
      </select>
      {role === 'department' && (
        <select value={deptCode} onChange={(e) => setDeptCode(e.target.value)} style={{ minWidth: 140 }}>
          {depts.map((d) => <option key={d.code} value={d.code}>{d.name}</option>)}
        </select>
      )}
      <input className="qtyin" style={{ width: 170, textAlign: 'left' }} placeholder="temp password (8+)"
        value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="primary" disabled={busy || !ready}
        onClick={() => onCreate({ email, password, fullName, role, deptCode: role === 'department' ? deptCode : null })}>
        {busy ? 'Creating…' : 'Create account'}
      </button>
    </div>
  );
}
