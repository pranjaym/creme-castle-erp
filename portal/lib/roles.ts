import type { Role } from '@/lib/session';

// The ONE list of portal roles, in plain words: the menu's role pill, the Users
// screens, the list's scope column, the role cards and the save messages all
// read it. Any other hand-kept copy of this list will drift (F60), so there is
// none. The names are Pranjay's (26 Sep 2026, erp-plan/portal-access-matrix.md);
// what each role may open lives in portalAccess() in lib/session.ts.
//
// Production Chef and Department Tablet are not portal roles: they hold
// "No portal access" here and their real role is set in the kitchen app.

export interface RoleDef {
  role: Role;
  label: string;
  /** What this role sees. Written for an admin choosing, not for a developer. */
  blurb: string;
  /** What the form must additionally ask for. */
  needs: 'outlet' | 'area' | 'nothing';
  /** Hidden from the "add a person" cards: kept only for accounts that predate the roles. */
  legacy?: boolean;
}

export const ROLE_DEFS: RoleDef[] = [
  {
    role: 'store',
    label: 'Store',
    blurb: 'Sees one store: its own daily numbers and nothing else. For a store manager.',
    needs: 'outlet',
  },
  {
    role: 'area_manager',
    label: 'Area Manager',
    blurb: 'Sees every store in one area, plus the area total, and answers the questions asked about them. Their store list follows the outlet master automatically.',
    needs: 'area',
  },
  {
    role: 'operations',
    label: 'Operations Head',
    blurb: 'The manager of the area managers: every store page, every area page and the all-stores overview, and asks and closes questions. Nothing else: no sales dashboard, reports, recipes or discounts.',
    needs: 'nothing',
  },
  {
    role: 'central',
    label: 'Central Team',
    blurb: 'Everything except managing people: the whole network, sales, reports, glossaries, discounts (edit) and recipes (checks, rates and prices).',
    needs: 'nothing',
  },
  {
    role: 'admin',
    label: 'Owner',
    blurb: 'Everything, including approving recipes and adding or changing people here.',
    needs: 'nothing',
  },
  {
    role: 'controls',
    label: 'Costing Controller',
    blurb: 'Recipes and costing only: checks recipes, keeps ingredient rates and selling prices, reads the food cost list. Sees no store, sales or discount pages.',
    needs: 'nothing',
  },
  {
    role: 'chef',
    label: 'Head Chef',
    blurb: 'The recipe book: reads, writes and changes recipes and sends them for checking. No costs, no store or sales pages. Production is in the kitchen app.',
    needs: 'nothing',
  },
  {
    role: 'none',
    label: 'No portal access',
    blurb: 'Sees nothing in the portal. For kitchen staff whose work is in the kitchen app (production chefs, department tablets): set their role there. Every new account starts here unless given a role.',
    needs: 'nothing',
  },
  {
    role: 'viewer',
    label: 'Viewer (retired)',
    blurb: 'Retired 26 Sep 2026. It used to see everything central saw; it now sees nothing. Move anyone still on it to a real role.',
    needs: 'nothing',
    legacy: true,
  },
];

export const roleDef = (r: Role): RoleDef =>
  ROLE_DEFS.find(d => d.role === r) ?? ROLE_DEFS.find(d => d.role === 'none')!;

export const ROLE_LABEL = (r: Role): string => roleDef(r).label;
