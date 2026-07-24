# Creme Castle ERP portal

The team-facing window onto the spine. Next.js on Vercel, reading the
`cremecastle-spine` Supabase project. Read-only: it never writes to the spine.

Same stack and conventions as `../kitchen` (server-side Supabase, service-role key
never reaches the browser). See the repo `HANDOFF.md` and `docs/` for the wider
picture.

## Phase 1 (this build)

- **Team login**: email + password (Supabase Auth in the spine project). No public
  signup; an admin provisions accounts. Every account has a `role` (`admin` /
  `viewer`) in `public.profiles`; every page checks it server-side.
- **Daily dashboards**: view the latest and browse the archive. Reads the
  `dashboard-html` Storage bucket, which the daily run (`../dashboard/auto/run_daily.py`)
  uploads to as `cc_daily_<date>.html`.
- **Report downloads**: order report and item report as clean CSV (no customer PII),
  for any date or range, streamed from the private `landing` schema.

## Routes

- `/login` : the only public page.
- `/` : home, links to the two features.
- `/dashboards`, `/dashboards/latest`, `/dashboards/<date>` : archive + viewer.
- `/reports` + `/reports/download` : pick a report and range, get a CSV.

## Local run

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill it (spine URL, anon + service-role
   keys, `SPINE_DATABASE_URL`, `DASH_HTML_BUCKET`).
3. Apply spine migration `../kitchen/migrations/040_portal_profiles.sql` (once).
4. `npm run dev`, open http://localhost:3000

## Deploy

New Vercel project, root directory `portal/`, framework Next.js. Set the same env
vars in Vercel (Production). Region Mumbai (colocated with the spine). Deploys and
account creation are run by Pranjay; see the repo checklist.

## What Phase 1 excludes

In-app browse/filter of the data (Phase 2), more dashboards (Phase 3), the 2-year
bulk history import (a separate importer), and any write path.
