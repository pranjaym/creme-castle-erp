'use client';
// The one navigation for every management screen (the OMS app-shell pattern:
// a permanent sidebar, role-filtered, with the active destination marked).
// Grouped by the management team's day: Daily, Watch, Masters, plus the team
// screens themselves so a manager can see exactly what the floor sees.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/login/actions';

type Dept = { code: string; name: string };

const ITEMS: { href: string; label: string; group: string; exact?: boolean; roles?: string[] }[] = [
  { href: '/admin', label: 'Today', group: 'Daily', exact: true },
  { href: '/admin/ledger', label: 'Day ledger', group: 'Watch' },
  { href: '/admin/transfers', label: 'Transfers', group: 'Watch' },
  { href: '/admin/requests', label: 'Requests', group: 'Watch' },
  { href: '/admin/buffer', label: 'Frozen buffer', group: 'Watch' },
  { href: '/admin/activity', label: 'Activity', group: 'Watch' },
  { href: '/admin/items', label: 'Items', group: 'Masters', roles: ['tech', 'super_admin'] },
  { href: '/admin/departments', label: 'Departments', group: 'Masters', roles: ['tech', 'super_admin'] },
  { href: '/admin/users', label: 'Users', group: 'Masters', roles: ['super_admin'] },
];
const GROUPS = ['Daily', 'Watch', 'Masters'] as const;
const ROLE_LABEL: Record<string, string> = {
  exec_chef: 'Executive chef', tech: 'Tech', super_admin: 'Super admin', department: 'Department',
};

export default function AdminNav({ role, email, depts }: { role: string; email: string; depts: Dept[] }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => !i.roles || i.roles.includes(role));
  const isOn = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));
  return (
    <div className="adminside">
      <Link href="/admin" title="Kitchen console home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/cremecastle-wordmark-brown.png" alt="Creme Castle" className="wordmark" />
      </Link>
      <div className="shellname">Kitchen · {ROLE_LABEL[role] ?? role}</div>

      {GROUPS.map((g) => {
        const grp = items.filter((i) => i.group === g);
        if (!grp.length) return null;
        return (
          <div key={g}>
            <div className="navgroup">{g}</div>
            {grp.map((i) => (
              <Link key={i.href} href={i.href} className={`navitem ${isOn(i.href, i.exact) ? 'on' : ''}`}>
                {i.label}
              </Link>
            ))}
          </div>
        );
      })}

      {depts.length > 0 && (
        <div>
          <div className="navgroup">Team screens</div>
          {depts.map((d) => (
            <Link key={d.code} href={`/dept/${d.code}`} className="navitem">{d.name}</Link>
          ))}
        </div>
      )}

      <div className="sidefoot">
        <div style={{ opacity: 0.55, marginBottom: 4 }}>{email}</div>
        <button className="signout" style={{ color: 'rgba(255,255,255,.65)' }} onClick={() => logout()}>sign out</button>
      </div>
    </div>
  );
}
