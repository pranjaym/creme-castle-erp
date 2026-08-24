// The navigation registry, same pattern as the OMS (lib/roles.ts NAV_ITEMS):
// grouped sections, filtered by role, so navigation and permissions can never
// disagree. Names per Pranjay (24 Aug): plain words that say what a thing is.
import type { Role, SessionUser } from '@/lib/session';

export interface NavItem {
  href: string;
  label: string;
}
export interface NavSection {
  title: string | null; // null = ungrouped items
  items: NavItem[];
}

export function navSectionsFor(user: SessionUser): NavSection[] {
  const mgmt = user.role === 'admin' || user.role === 'central' || user.role === 'viewer';
  const sections: NavSection[] = [];

  sections.push({ title: null, items: [{ href: '/', label: 'Home' }] });

  if (mgmt) {
    sections.push({
      title: 'Store Performance',
      items: [
        { href: '/daily/central', label: 'All Stores Overview' },
        { href: '/areas', label: 'Area Managers' },
        { href: '/stores', label: 'Store Pages' },
      ],
    });
    sections.push({
      title: 'Sales',
      items: [{ href: '/dashboards', label: 'Daily Sales Dashboard' }],
    });
    sections.push({
      title: 'Data',
      items: [{ href: '/reports', label: 'Reports & Downloads' }],
    });
  } else if (user.role === 'area_manager') {
    sections.push({
      title: 'Store Performance',
      items: [
        { href: '/daily', label: 'My Area' },
        { href: '/stores', label: 'My Store Pages' },
      ],
    });
  } else if (user.role === 'store') {
    sections.push({
      title: 'Store Performance',
      items: [{ href: '/daily', label: 'My Store' }],
    });
  }

  const account: NavItem[] = [];
  if (user.role === 'admin') account.push({ href: '/users', label: 'Users & Access' });
  account.push({ href: '/account', label: 'Change Password' });
  sections.push({ title: 'Account', items: account });

  return sections;
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  central: 'Central',
  area_manager: 'Area Manager',
  store: 'Store',
  viewer: 'Viewer',
};
