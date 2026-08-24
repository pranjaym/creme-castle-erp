import type { Role } from '@/lib/session';

// One place that says, in plain words, what each role can see. The users
// screens, the list's scope column and the role cards all read from here, so
// the description an admin picks from is the same sentence everywhere.

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
    label: 'Area manager',
    blurb: 'Sees every store in one area, plus the area total. Their store list follows the outlet master automatically.',
    needs: 'area',
  },
  {
    role: 'central',
    label: 'Central office',
    blurb: 'Sees the whole network: every store, every area, the sales dashboard and all reports.',
    needs: 'nothing',
  },
  {
    role: 'admin',
    label: 'Admin',
    blurb: 'Everything central sees, and can add or change people here.',
    needs: 'nothing',
  },
  {
    role: 'viewer',
    label: 'Viewer (old)',
    blurb: 'The role accounts had before roles existed. Same reach as central. Do not pick it for someone new.',
    needs: 'nothing',
    legacy: true,
  },
];

export const roleDef = (r: Role): RoleDef =>
  ROLE_DEFS.find(d => d.role === r) ?? ROLE_DEFS[ROLE_DEFS.length - 1];

export const ROLE_LABEL = (r: Role): string => roleDef(r).label;
