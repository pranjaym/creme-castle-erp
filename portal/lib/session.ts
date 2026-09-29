// Who is logged in, and what may they do. Every gated page calls requireUser();
// admin-only pages call requireAdmin(). The role lives in public.profiles on the
// spine (migration 040), keyed to the Supabase Auth user id.
import 'server-only';
import { redirect } from 'next/navigation';
import { authClient } from '@/lib/supabase/authClient';
import { spine } from '@/lib/supabase/service';

// Portal roles (migration 140, chef and controls 229, operations and none 236).
// Their names and blurbs live in lib/roles.ts; what each may open is
// portalAccess() below. 'viewer' is RETIRED (26 Sep 2026) and opens nothing:
// it was the column default, so every account made for the kitchen app had
// silently inherited full management read. The default is now 'none'.
export type Role = 'admin' | 'central' | 'operations' | 'area_manager' | 'store' | 'chef' | 'controls' | 'none' | 'viewer';

// The kitchen app (department production), same login, its own role column.
export const KITCHEN_APP_URL = 'https://cremecastle-kitchen.vercel.app';

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
  // Central Team and the Costing Controller check (Pranjay, 26 Sep 2026).
  const checker = admin || role === 'central' || role === 'controls' || g.has('recipes:checker');
  const chef = checker || role === 'chef' || g.has('recipes:chef');
  return {
    view: chef,
    draft: chef,
    check: checker,          // Narendra's step: rates, prices, checking
    approve: admin,          // Pranjay's step
    money: checker,          // the food cost list, price impact, prices: not for a plain chef
  };
}

// Coupon sharing module (migration 232). Owner and Central Team edit (Pranjay,
// 19 Sep 2026: "you, Pawan and Rishabh edit"); nobody else sees it unless given
// a grant. Controls lost its read on 26 Sep 2026 ("Narender, just recipes").
export type CouponGrant = 'coupons:viewer' | 'coupons:editor';
export const COUPON_GRANTS: CouponGrant[] = ['coupons:viewer', 'coupons:editor'];
export function couponPerms(u: { role: Role; modules?: string[] }) {
  const g = new Set(u.modules ?? []);
  const edit = u.role === 'admin' || u.role === 'central' || g.has('coupons:editor');
  const view = edit || g.has('coupons:viewer');
  return { view, edit };
}

// Questions on the daily pages (migration 234, 26 Sep 2026). Phase 1 as
// Pranjay decided: admin and central ASK, area managers (and a store, for its
// own outlet) ANSWER, admin and central CLOSE or push back. The Operations Head
// (26 Sep 2026) asks and closes too: managing the area managers is the job. Everyone who can
// see a store page can read the questions on it; the list page scopes itself
// by the same outlet rule as the daily pages. No mail anywhere: the push is
// the rail badge, the home line and "Where you are needed".
export function questionPerms(u: { role: Role; modules?: string[] }) {
  const mgmt = u.role === 'admin' || u.role === 'central' || u.role === 'operations';
  const field = u.role === 'area_manager' || u.role === 'store';
  return {
    view: mgmt || field,
    ask: mgmt,
    answer: field,   // the answer is the area manager's (or the store's), never central's
    explain: field,  // 29 Sep 2026: the field may also start the record, unasked (migration 241)
    close: mgmt,
  };
}

// The whole portal's permission table, in one place (26 Sep 2026). The menu
// (lib/nav.ts) and every page gate read these same answers, so a page can no
// longer be missing from someone's menu yet open to them when they type its
// address, which is what Discounts, the sales dashboard and the glossaries were
// for area managers and stores until today. Every entry is an allow-list: a role
// not named here gets nothing, so a new role starts with no access.
// scripts/check-gates.mjs fails the build if any page skips this.
// The role and module map this implements: erp-plan/portal-access-matrix.md.
export function portalAccess(u: { role: Role; modules?: string[] }) {
  const mgmt = u.role === 'admin' || u.role === 'central';
  const network = mgmt || u.role === 'operations';
  return {
    network,                                                            // all-stores overview, area pages, any store
    storeList: network || u.role === 'area_manager',                    // the stores list (an AM sees only theirs)
    ownStores: network || u.role === 'area_manager' || u.role === 'store', // /daily, scoped to their outlets
    sales: mgmt,                                                        // daily sales dashboard
    reports: mgmt,                                                      // reports and downloads (customer details)
    glossary: mgmt,                                                     // item and outlet glossary
    glossaryEdit: mgmt,
    recipes: recipePerms(u),
    coupons: couponPerms(u),
    questions: questionPerms(u),
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
  // everyone else = empty meaning all (their role decides whether they see any).
  outletCodes: string[];
  // Their role in the kitchen app, if any (department, exec_chef, tech,
  // super_admin); the portal only uses it to show the door to that app.
  kitchenRole: string | null;
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
    .select('role, full_name, active, outlet_codes, modules, kitchen_role')
    .eq('id', user.id)
    .single();

  if (error || !profile || profile.active === false) return null;

  return {
    id: user.id,
    email: user.email ?? '',
    fullName: profile.full_name ?? null,
    role: (profile.role as Role) ?? 'none',
    outletCodes: ((profile as { outlet_codes?: string[] }).outlet_codes) ?? [],
    modules: ((profile as { modules?: string[] }).modules) ?? [],
    kitchenRole: ((profile as { kitchen_role?: string | null }).kitchen_role) ?? null,
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
