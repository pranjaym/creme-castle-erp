// The navigation registry, same pattern as the OMS (lib/roles.ts NAV_ITEMS):
// one list, filtered by role. The sidebar renders exactly what the role allows,
// so navigation and permissions can never disagree.
import type { Role, SessionUser } from '@/lib/session';

export interface NavItem {
  href: string;
  label: string;
  roles: Role[];
}

const ALL: Role[] = ['admin', 'central', 'area_manager', 'store', 'viewer'];
const MGMT: Role[] = ['admin', 'central', 'viewer'];

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', roles: ALL },
  { href: '/daily', label: 'Daily', roles: ALL },
  { href: '/stores', label: 'Stores', roles: ['admin', 'central', 'viewer', 'area_manager'] },
  { href: '/areas', label: 'Areas', roles: MGMT },
  { href: '/dashboards', label: 'Sales Dashboard', roles: MGMT },
  { href: '/reports', label: 'Reports', roles: MGMT },
  { href: '/users', label: 'Users', roles: ['admin'] },
  { href: '/account', label: 'Change password', roles: ALL },
];

export function navItemsFor(user: SessionUser): NavItem[] {
  return NAV_ITEMS.map(item => {
    // The Daily label reads naturally per role.
    if (item.href === '/daily') {
      const label = user.role === 'store' ? 'My Store'
        : user.role === 'area_manager' ? 'My Area' : 'Daily';
      return { ...item, label };
    }
    if (item.href === '/stores' && user.role === 'area_manager') {
      return { ...item, label: 'My Stores' };
    }
    return item;
  }).filter(item => item.roles.includes(user.role));
}

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  central: 'Central',
  area_manager: 'Area Manager',
  store: 'Store',
  viewer: 'Viewer',
};
