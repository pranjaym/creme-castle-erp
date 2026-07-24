# cremecastle-kitchen: working rules

The kitchen spine module. Planning is authoritative in `../erp-plan/` (read
`build-plans-1a-3a.md`, `integration-notes.md`, `build-order.md`, `CLAUDE.md`).

## Rules that bind this repo

1. **The database schema is canonical; this app is disposable.** Masters,
   movements, production runs, and history are the asset. Design tables to outlive
   the app. A future ERP inherits this model plus its data.
2. **Three layers, never crossed:** landing (raw), canonical spine (truth),
   consumers (read layer 2 only). No consumer touches a scraper or Petpooja.
3. **One business-day rule everywhere:** 04:00 to 03:59 IST, via `business_day()`
   (SQL) and `lib/business-day.ts` (display). Keep the two in lockstep.
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
  regenerates 005/006/007/008 from `seed_data/`. `ALL.sql` is the re-baseline paste
  (destructive; pre-first-entry only).
- **Re-baseline rule:** while no real logbook data exists, changes go via re-baseline
  (`ALL.sql`). From the sponge team's first real entry, switch permanently to numbered
  ALTER migrations (`scripts/migrate.mjs`) and never re-baseline again.
- Movement model: three verbs (made, issued with destination, wasted with reason);
  destinations from the location master. Departments and spokes are locations.
- `lib/recon/match-core.mjs` the reproducible reconciliation core (tested).
- `app/` the logbook, buffer, and recon screens (server-side, service-role).
- `workers/oms-ingest` (read-only OMS pull), `workers/petpooja-ingest` (our own
  scrape plus a real parser). Named `workers/` not `services/` because Vercel
  treats a `services/` folder as deployable services; it is `.vercelignore`d.
- Deployed to Vercel (team `creme-castle`, project `cremecastle-kitchen`) at
  https://cremecastle-kitchen.vercel.app; single Next.js app, `vercel.json` pins it.
