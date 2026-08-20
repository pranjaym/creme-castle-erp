'use client';
// Admin sidebar: maroon panel, coral active pill, grouped by the management
// team's DAY. What a role cannot open is not drawn (the real doors are the
// requireRoles gates on every page; hiding is a courtesy, not the security).
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/login/actions';

const ITEMS: { href: string; label: string; group: string; exact?: boolean; roles?: string[] }[] = [
  { href: '/admin', label: 'Today', group: 'Daily', exact: true },
  { href: '/admin/ledger', label: 'Day ledger', group: 'Watch' },
  { href: '/admin/transfers', label: 'Transfers', group: 'Watch' },
  { href: '/admin/requests', label: 'Requests', group: 'Watch' },
  { href: '/admin/activity', label: 'Activity', group: 'Watch' },
  { href: '/admin/items', label: 'Items', group: 'Masters', roles: ['tech', 'super_admin'] },
  { href: '/admin/departments', label: 'Departments', group: 'Masters', roles: ['tech', 'super_admin'] },
  { href: '/admin/users', label: 'Users', group: 'Masters', roles: ['super_admin'] },
];
const GROUPS = ['Daily', 'Watch', 'Masters'] as const;
const ROLE_LABEL: Record<string, string> = {
  exec_chef: 'Executive chef', tech: 'Tech', super_admin: 'Super admin', department: 'Department',
};

export default function AdminNav({ role, email }: { role: string; email: string }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => !i.roles || i.roles.includes(role));
  const isOn = (i: (typeof ITEMS)[number]) => (i.exact ? pathname === i.href : pathname.startsWith(i.href));
  return (
    <div className="adminside">
      <Link href="/" title="Back to the kitchen home">
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
              <Link key={i.href} href={i.href} className={`navitem ${isOn(i) ? 'on' : ''}`}>{i.label}</Link>
            ))}
          </div>
        );
      })}
      <div className="sidefoot">
        <div style={{ opacity: 0.55, marginBottom: 4 }}>{email}</div>
        <Link href="/">← back to the kitchen</Link>
        {' · '}
        <button className="signout" style={{ color: 'rgba(255,255,255,.65)' }} onClick={() => logout()}>sign out</button>
      </div>
    </div>
  );
}
