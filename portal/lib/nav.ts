// The navigation registry, same pattern as the OMS (lib/roles.ts NAV_ITEMS):
// grouped sections, filtered by the same permission table every page gate reads
// (portalAccess in lib/session.ts), so navigation and permissions can never
// disagree. Names per Pranjay (24 Aug): plain words that say what a thing is.
import { portalAccess, KITCHEN_APP_URL, type SessionUser } from '@/lib/session';

export interface NavItem {
  href: string;
  label: string;
}
export interface NavSection {
  title: string | null; // null = ungrouped items
  items: NavItem[];
}

export function navSectionsFor(user: SessionUser): NavSection[] {
  const acc = portalAccess(user);
  const rp = acc.recipes;
  const sections: NavSection[] = [];

  sections.push({ title: null, items: [{ href: '/', label: 'Home' }] });

  // Questions asked on the daily pages (26 Sep 2026): the follow-up loop, so
  // it sits right under Home for everyone who may read them (Pranjay, same
  // evening: "where is the questions section in the left"). The rail badge
  // next to it is filled by the shell.
  if (acc.questions.view) {
    sections.push({ title: 'Follow-up', items: [{ href: '/questions', label: 'Questions' }] });
  }

  if (acc.network) {
    sections.push({
      title: 'Store Performance',
      items: [
        { href: '/daily/central', label: 'All Stores Overview' },
        { href: '/areas', label: 'Area Managers' },
        { href: '/stores', label: 'Store Pages' },
      ],
    });
  }
  if (acc.sales) {
    sections.push({
      title: 'Sales',
      items: [{ href: '/dashboards', label: 'Daily Sales Dashboard' }],
    });
  }
  const data: NavItem[] = [];
  if (acc.reports) data.push({ href: '/reports', label: 'Reports & Downloads' });
  if (acc.glossary) data.push({ href: '/glossary/items', label: 'Item Glossary' }, { href: '/glossary/outlets', label: 'Outlet Glossary' });
  if (data.length) sections.push({ title: 'Data', items: data });
  if (rp.view) {
    const items: NavItem[] = [
      { href: '/recipes', label: 'Recipes home' },
      { href: '/recipes/finished', label: 'Finished goods' },
      { href: '/recipes/semi', label: 'Semi-finished' },
      { href: '/recipes/ingredients', label: 'Ingredients & prices' },
    ];
    if (rp.money) items.push({ href: '/recipes/food-cost', label: 'Food cost list' }, { href: '/recipes/impact', label: 'Price impact' });
    items.push({ href: '/recipes/approvals', label: 'Changes & approvals' });
    sections.push({ title: 'Recipes & costing', items });
  }
  if (acc.coupons.view) {
    sections.push({
      title: 'Discounts',
      items: [
        { href: '/coupons', label: 'Coupon sharing' },
        { href: '/coupons/glossary', label: 'Coupon glossary' },
        { href: '/coupons/deals', label: 'Deals & uploads' },
      ],
    });
  }
  if (user.role === 'area_manager') {
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

  // The door to the kitchen app (department production), for anyone who has a
  // role there. It is a separate app with the same login.
  if (user.kitchenRole) {
    sections.push({ title: 'Production', items: [{ href: KITCHEN_APP_URL, label: 'Kitchen app' }] });
  }

  const account: NavItem[] = [];
  if (acc.users) account.push({ href: '/users', label: 'Users & Access' });
  account.push({ href: '/account', label: 'Change Password' });
  sections.push({ title: 'Account', items: account });

  return sections;
}

