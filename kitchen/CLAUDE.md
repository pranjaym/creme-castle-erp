# cremecastle-kitchen: working rules

The kitchen spine module. Planning is authoritative in `../erp-plan/` (read
`build-plans-1a-3a.md`, `integration-notes.md`, `build-order.md`, `CLAUDE.md`).

## Rules that bind this repo

1. **The database schema is canonical; this app is disposable.** Masters,
   movements, production runs, and history are the asset. Design tables to outlive
   the app. A future ERP inherits this model plus its data.
2. **Three layers, never crossed:** landing (raw), canonical spine (truth),
   consumers (read layer 2 only). No consumer touches a scraper or Petpooja.
3. **Two day rules, never mixed.** SALES: 04:00 to 03:59 IST via `business_day()`
   (SQL) and `lib/business-day.ts`, front of house only. KITCHEN: the plain IST
   calendar date (`istCalendarDate`), and since 19 Aug 2026 each department also
   has its OWN day window (`department_settings.day_start_time`, `lib/dept-day.mjs`):
   the production day runs start to start and is labelled by the date it started on.
4. **No hard deletes, ever.** Deactivate, supersede, or append a correcting row.
   `production_log` is append-only; a fix is a new reversing entry. `spine_events`
   is the append-only audit.
5. **Every number reproducible; AI is never load-bearing.** The matcher and the
   parsers are deterministic, no clock, no network in the core. Reconciliation
   normalisation lives only in `lib/recon/match-core.mjs`.
6. **The Dispatch Console model is never modified.** Build 2 (later) generates its
   feed from the spine; it does not touch `../cc-dispatch-console/model`.
7. **Secrets in env vars only.** Never commit `petpooja_pipeline.py`, `cc_spotcheck`,
   session files, or keys. Rotate exposed secrets before any push (F10).
8. **No em dashes or en dashes in any output**, code comments included. Use commas,
   colons, parentheses, or "to" for ranges.
9. **Write decisions back to `../erp-plan/` the same day.**

## Layout

- `migrations/` (schema v2): 000 foundation, 005 locations, 006 skus, 007 par,
  008 uom, 009 config, 010 landing, 020 recon, 030 logbook. `scripts/gen_seed_sql.py`
  regenerates 005/006/007/008 from `seed_data/`. Later: 060 zomato, 070 landing RLS,
  071 core orders, 072 core refresh schedule, 073 outlet mappings, 074 identity layer,
  080 department module (Liquids dept split, department_settings, made_by tag,
  transfer_receipts, closing_counts, v_dept_day_ledger). `schema_migrations` is
  bootstrapped on the spine; `scripts/migrate.mjs` is now the apply path.
- Department module (19 Aug 2026, plan in `../erp-plan/department-module-plan.md`):
  `app/dept/[dept]` (Sponges and Liquids screens: made, sent, waste, closing count
  with optional age split, receive inbox with receiver confirmation, request flow).
  Transfers are two-sided: issued rows wait in `v_pending_receipts` until the
  receiver confirms; differences land in `v_transfer_mismatches`. Consumption is
  DERIVED in `v_dept_day_ledger`, never entered. Requests (migration 090) are the
  pull flow: `dept_requests` + `production_log.request_id`; state is DERIVED in
  `v_request_status` (open/partial/fulfilled/cancelled); the only stored
  transition is cancellation with a reason. The push flow (send unasked) stays.
- `app/admin` is a console in the OMS finance-shell pattern (maroon sidebar,
  header band, stat cards): Today (compass), Day ledger, Transfers, Requests,
  Activity, Items, Departments, Users. Visuals use the Creme Castle Design
  System (Magalie/Owners in `public/fonts`, console tokens in globals.css) but
  ONLY inside .adminshell; team screens stay system-font simple (two-audience
  rule, Pranjay 19 Aug 2026).
- AUTH (migration 100): same Supabase Auth + public.profiles as the ERP portal
  (one password works on both). kitchen_role: department (pinned to own screen),
  exec_chef (all screens + admin Daily/Watch), tech (+ masters), super_admin
  (+ /admin/users). Middleware = portal's @supabase/ssr pattern; every page and
  every server action re-checks the role (lib/session.ts). Fail closed: no
  kitchen_role = no access. Never delete users; deactivate.
- **No re-baseline, ever.** Schema changes go through numbered ALTER migrations
  (`scripts/migrate.mjs`). The old destructive paste has been retired to
  `migrations/OBSOLETE_DO_NOT_RUN_rebaseline_2026-07-23.sql.txt`: it opens with
  `drop schema if exists landing cascade` and would destroy every ingested row and
  the core, identity and mart layers with it. Do not run it, do not resurrect it,
  and do not follow any older doc that still recommends it.
- Movement model: three verbs (made, issued with destination, wasted with reason);
  destinations from the location master. Departments and spokes are locations.
- `lib/recon/match-core.mjs` the reproducible reconciliation core (tested).
- `app/` the logbook, buffer, and recon screens (server-side, service-role).
- `workers/oms-ingest` (read-only OMS pull), `workers/petpooja-ingest` (our own
  scrape plus a real parser). Named `workers/` not `services/` because Vercel
  treats a `services/` folder as deployable services; it is `.vercelignore`d.
- Deployed to Vercel (team `creme-castle`, project `cremecastle-kitchen`) at
  https://cremecastle-kitchen.vercel.app; single Next.js app, `vercel.json` pins it.
