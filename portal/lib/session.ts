// Who is logged in, and what may they do. Every gated page calls requireUser();
// admin-only pages call requireAdmin(). The role lives in public.profiles on the
// spine (migration 040), keyed to the Supabase Auth user id.
import 'server-only';
import { redirect } from 'next/navigation';
import { authClient } from '@/lib/supabase/authClient';
import { spine } from '@/lib/supabase/service';

// Phase 2 roles (migration 140). 'viewer' predates the role-equals-scope model and
// is treated as read-only central until reassigned in /users.
export type Role = 'admin' | 'central' | 'area_manager' | 'store' | 'viewer' | 'chef' | 'controls';

// Recipe module permissions (migration 229). A person's reach in this module is
// their portal role's default PLUS any module grant in profiles.modules, so a
// central-office account keeps every other module and can still be a checker
// here (Pranjay, 16 Sep 2026: "they enjoy all the other rights for other modules,
// but for this module they have the role of checker").
//   recipes:chef     may draft
//   recipes:checker  may draft, check, keep rates and prices, see the money pages
//   recipes:admin    everything, including approve
export type RecipeGrant = 'recipes:chef' | 'recipes:checker' | 'recipes:admin';
export const RECIPE_GRANTS: RecipeGrant[] = ['recipes:chef', 'recipes:checker', 'recipes:admin'];
export function recipePerms(u: { role: Role; modules?: string[] }) {
  const g = new Set(u.modules ?? []);
  const role = u.role;
  const admin = role === 'admin' || g.has('recipes:admin');
  const checker = admin || role === 'controls' || g.has('recipes:checker');
  const chef = checker || role === 'chef' || g.has('recipes:chef');
  const reader = role === 'central' || role === 'viewer';
  return {
    view: chef || reader,
    draft: chef,
    check: checker,          // Narendra's step: rates, prices, checking
    approve: admin,          // Pranjay's step
    money: checker || reader, // the food cost list, price impact, prices: not for a plain chef
  };
}

// Coupon sharing module (migration 232). Management roles read it; editing the
// deals, the glossary and the tolerance is admin plus the coupons:editor grant
// (Pranjay, 19 Sep 2026: "you, Pawan and Rishabh edit, everyone else reads").
export type CouponGrant = 'coupons:viewer' | 'coupons:editor';
export const COUPON_GRANTS: CouponGrant[] = ['coupons:viewer', 'coupons:editor'];
export function couponPerms(u: { role: Role; modules?: string[] }) {
  const g = new Set(u.modules ?? []);
  const edit = u.role === 'admin' || g.has('coupons:editor');
  const view = edit || u.role === 'central' || u.role === 'viewer' || u.role === 'controls' || g.has('coupons:viewer');
  return { view, edit };
}

// The whole portal's permission table, in one place (26 Sep 2026). The menu
// (lib/nav.ts) and every page gate read these same answers, so a page can no
// longer be missing from someone's menu yet open to them when they type its
// address, which is what Discounts, the sales dashboard and the glossaries were
// for area managers and stores until today. Every entry is an allow-list: a role
// not named here gets nothing, so a new role starts with no access.
// scripts/check-gates.mjs fails the build if any page skips this.
export function portalAccess(u: { role: Role; modules?: string[] }) {
  const mgmt = u.role === 'admin' || u.role === 'central' || u.role === 'viewer';
  return {
    network: mgmt,                                                      // all-stores overview, area pages, any store
    storeList: mgmt || u.role === 'area_manager',                       // the stores list (an AM sees only theirs)
    ownStores: mgmt || u.role === 'area_manager' || u.role === 'store', // /daily, scoped to their outlets
    sales: mgmt,                                                        // daily sales dashboard
    reports: mgmt,                                                      // reports and downloads
    glossary: mgmt,                                                     // item and outlet glossary, read
    glossaryEdit: u.role === 'admin' || u.role === 'central',
    recipes: recipePerms(u),
    coupons: couponPerms(u),
    users: u.role === 'admin',
  };
}
export type PortalAccess = ReturnType<typeof portalAccess>;

export interface SessionUser {
  id: string;
  email: string;
  fullName: string | null;
  role: Role;
  // Module grants beyond the role default (profiles.modules), e.g. recipes:checker.
  modules: string[];
  // Scope: store = one internal_code, area_manager = their outlets,
  // admin/central/viewer = empty meaning all.
  outletCodes: string[];
}

// Returns the logged-in user with their profile, or null if not signed in / not
// provisioned / deactivated. A user with an auth account but no active profile row
// is treated as not allowed (accounts are provisioned deliberately, not by signup).
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await authClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile, error } = await spine()
    .from('profiles')
    .select('role, full_name, active, outlet_codes, modules')
    .eq('id', user.id)
    .single();

  if (error || !profile || profile.active === false) return null;

  return {
    id: user.id,
    email: user.email ?? '',
    fullName: profile.full_name ?? null,
    role: (profile.role as Role) ?? 'viewer',
    outletCodes: ((profile as { outlet_codes?: string[] }).outlet_codes) ?? [],
    modules: ((profile as { modules?: string[] }).modules) ?? [],
  };
}

// For pages: bounce to /login if not a valid, active user.
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect('/login');
  return u;
}

// For every gated page: turn away anyone the table above does not allow. Home
// ('/') is open to every signed-in person, so it is the default place to send
// them and can never loop.
export async function requireAccess(allowed: (a: PortalAccess) => boolean, elsewhere = '/'): Promise<SessionUser> {
  const u = await requireUser();
  if (!allowed(portalAccess(u))) redirect(elsewhere);
  return u;
}

// For admin-only pages: bounce viewers to the home page.
export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (u.role !== 'admin') redirect('/');
  return u;
}
