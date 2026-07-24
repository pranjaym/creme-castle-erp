# Creme Castle ERP portal: plan and Phase 1 (24 July 2026)

The team-facing window onto the spine. Decisions and scope for the portal app,
written back the same day per the working agreement.

## Decisions (24 July 2026)

- **Auth**: email + password, admin-provisioned, NO public signup. Accounts and
  passwords live in Supabase Auth in the spine project (not in Vercel; Vercel only
  runs the app). Every account carries a `role` (`admin` / `viewer` to start) in
  `public.profiles`; every page checks the role server-side. Access widens by adding
  roles as modules are added. Pranjay's intent: one login per person, graduated
  access decided as features grow.
- **Repo / deploy**: the portal code is a new `portal/` folder inside the existing
  `creme-castle-erp` repo, beside `kitchen/` and `dashboard/` (keeps the single-repo
  consolidation HANDOFF describes). It is its own Vercel project (root directory
  `portal/`), a separate app from the kitchen app, both reading the same spine.
- **Database vs app vs code (clarified for the record)**: one database (the spine).
  Many apps, each its own Vercel project and URL (kitchen app; now the portal). The
  code for those apps sits in the one GitHub repo. "Creme Castle ERP" was, before
  this build, only the GitHub repo and a GCP project used for the failed scrape
  experiment; the team-facing portal app did not exist until now.
- **Dashboard archive**: the automatic archive starts fresh from the next daily run
  forward. Loading roughly 2 years of history into the spine (so the tool is the
  single source of truth) is a SEPARATE task, an importer, gated on Pranjay
  supplying the historical files (Petpooja ~2 years, SupplyNote 3 to 6 months; mixed
  xlsx / csv / xlsb; from his Mac or a Drive link). Not part of the Phase 1 skeleton.

## Phase 1 scope (BUILT 24 July 2026)

Read-only onto the spine. Same stack and conventions as `kitchen/` (server-side
Supabase, service-role key never reaches the browser).

1. App skeleton: Next.js 15 on Vercel, brand-styled to match the kitchen app.
2. Team login: email + password, `public.profiles` role gate, middleware on every
   route, sign-out.
3. Daily dashboards: `/dashboards` (archive, newest first), `/dashboards/latest`,
   `/dashboards/<date>` (viewer). Reads the `dashboard-html` Storage bucket.
4. Report downloads: `/reports` picks the order report or item report and a date
   range; `/reports/download` streams a clean CSV (no customer PII) from the private
   `landing` schema over a direct pg connection. Single download capped at 92 days.

Supporting change: `dashboard/auto/run_daily.py` now uploads each built
`cc_daily_<date>.html` to the `dashboard-html` bucket after building (best effort,
runs on the Mac too, so the archive accumulates from day one). The email path is
unchanged.

Spine migration `kitchen/migrations/040_portal_profiles.sql` adds `public.profiles`
(role, active), an updated_at trigger, an on-auth-user-insert trigger that
auto-creates an inactive viewer profile, RLS so a user reads only their own row, and
a backfill for existing auth users. Additive and safe on the live DB.

## Excluded from Phase 1 (later phases)

- Phase 2: in-app browse and filter of the report data.
- Phase 3: more dashboards under the same roof; a general scheduler to email any one.
- The 2-year bulk history importer (its own task; needs the source files first).
- Any write path (the portal never writes to the spine).

## What is Pranjay's to run (outward actions, live secrets)

Apply the migration, create the Vercel project + env vars, create the
`dashboard-html` Storage bucket, and create the user accounts. See the repo
`HANDOFF.md` and the deploy checklist. Claude builds up to that line.
