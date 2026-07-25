# Creme Castle ERP: handoff and current state

This repo is the umbrella for Creme Castle's in-house ERP. If you are picking this up
(Rishabh, or a fresh Claude session), read this file first, then `docs/`. Claude's own
memory does not travel between accounts, so this repo IS the shared brain: every decision
lives in the docs, not in anyone's chat history.

Covenants (do not break): the database schema is canonical and apps are disposable; no
hard deletes (cancel/void/supersede with a reason); verified data only, estimates
labelled; no em dashes or en dashes anywhere, including code comments; every decision is
written back into the docs the same day.

## The one big idea

One canonical database (the "spine", a Supabase project called `cremecastle-spine`) is
the single store. Every report we pull, from Petpooja and SupplyNote and more over time,
LANDS there (raw), gets cleaned into a canonical layer, and is LINKED through shared
masters (SKU master, location master, alias maps). Every app reads from that one place.
Nobody re-fetches from Petpooja to do analysis; they come to the spine.

Data flow: `Petpooja/SupplyNote -> daily scrape/import (from a trusted IP) -> spine DB
(landing -> canonical) -> the apps (OMS, Dispatch Console, kitchen, ERP portal) -> team`.

## What is in this repo

- `docs/` : the planning brain. Start with `build-order.md`, then `integration-notes.md`
  (verified facts + a flag register F1..F13), `schema-v2-proposal.md`, `data-findings-2026-07-23.md`,
  `kitchen-production-brief.md`, and the two `.mermaid` flow maps. `CLAUDE.md` is the working agreement.
- `kitchen/` : the spine module (this was NEVER on GitHub before; it lived only on
  Pranjay's Mac). Next.js app (`/log`, `/recon`, `/buffer`) on Supabase, plus the SQL
  migrations (the three layers: landing, canonical, consumers), the deterministic
  reconciliation matcher (`lib/recon/match-core.mjs`, 16 passing tests), and the ingestion
  workers (`workers/petpooja-ingest`, `workers/oms-ingest`).
- `dashboard/` : the daily Zomato/Swiggy sales dashboard, WORKING and automated. `auto/`
  is the pipeline (scrape -> enrich -> build -> email), `cc_dashboard/` is the report
  generator, `deploy/` is the container packaging.
- (to build) the **Creme Castle ERP portal** app: the team-facing window onto the spine
  (view all dashboards, download the reports, browse the data). Same stack as OMS and the
  kitchen module: Next.js + Supabase + Vercel. Pranjay has moved off Retool.

Not in this repo (own repos, read the same spine): OMS (`cremecastle-oms`, D2C) and the
Dispatch Console (`cc-dispatch-console`, Zomato/Swiggy production planning).

## The single most important operational finding

Petpooja BLOCKS cloud datacenter IPs. We confirmed the scraper fails identically from
Google Cloud Run (Mumbai) AND an Oracle Cloud VM, while it works from a normal
residential/office connection at the same moment with the same saved login. So bot
detection serves datacenter IPs a stripped page (no export controls). Only trusted
residential/ISP IPs work. This is why the daily dashboard runs on Pranjay's Mac today,
and why the plan is a small network of trusted office/home machines (below), NOT a cloud
server, for anything that scrapes Petpooja.

## State of the daily dashboard (working)

- Runs automatically at 8:00 AM on Pranjay's Mac via macOS launchd
  (`~/Library/LaunchAgents/in.cremecastle.dashboard.plist` -> `dashboard/auto/run_dashboard.sh`).
- Each run: pull history from Supabase Storage bucket `dashboard-history` -> scrape
  yesterday's Petpooja order + item reports (reusing a saved login session stored in
  Supabase Storage) -> filter items to Zomato/Swiggy and enrich via the glossary CSVs
  (`dashboard/auto/glossary/`) -> compute the 7am business day -> append to history
  (deduped) -> build `cc_daily_<date>.html` -> email it to the team -> push history back.
- Validated end to end; the team receives it. Focal day is always the last complete day
  (yesterday). Enrichment reproduces the hand-made file 100% on aliases/category/city/date.
- The Petpooja login is done once per machine (`python3 scrape.py bootstrap` in
  `kitchen/workers/petpooja-ingest`), which saves the session to Supabase Storage.

## Where the data lives right now (to be unified)

- The dashboard keeps its order + enriched-item data as parquet in Supabase Storage
  (`dashboard-history`): auto-refreshed daily.
- The spine DB (`cremecastle-spine`) has the raw order + item reports in `landing.*` from
  a one-time 30-day backfill (through ~23 Jul 2026): a snapshot, not yet auto-refreshed.
- CLEANUP owed (per the canonical-spine idea): route the daily scrape INTO the spine and
  have the dashboard + the ERP portal both read the spine. One reference point, not two.

## The team access + resilience plan

- **Creme Castle ERP portal** (Phase 1): app skeleton on Vercel + team login + view the
  daily dashboard (latest + archive) + download the order and item reports. Phase 2: browse
  and filter the report data in-app. Phase 3: more dashboards, all under this roof. Every
  dashboard can also be scheduled to email (the scheduler generalises).
- **4-computer failover network** for the Petpooja scrape (since only trusted IPs work):
  priority Harshit's office machine > Pranjay > Rishabh > Pawan. Each has the tool + a
  scheduler firing at a few times a day (8/12/16/20), staggered by priority. A Supabase
  "run claim" table + a "is today done?" check means the first available machine runs it,
  the rest skip, and it self-heals if everyone was offline. Each person uses their OWN
  Petpooja login (a session is safest from the IP it was created on).

## How to run things

- Daily dashboard, manually: `cd dashboard/auto && python3 run_daily.py` (needs
  `dashboard/auto/.env` filled from `.env.example`). `--no-email` builds without sending;
  `--no-scrape` rebuilds from history.
- Apply spine migrations: paste `kitchen/migrations/*.sql` into the spine Supabase SQL
  editor in order, or `SPINE_DATABASE_URL=... node kitchen/scripts/migrate.mjs`.
- Kitchen app (Build 3a logbook): live at https://cremecastle-kitchen.vercel.app/log

## Secrets (never in this repo)

All credentials live in local `.env` files (gitignored) and each cloud service's own
environment. The spine service_role key was rotated to a new `sb_secret_...` key. The
Gmail App Password for the dashboard mailer should be rotated (it leaked into a template
file during setup) and kept only in the real `.env`. Rishabh's old `petpooja_pipeline.py`
carries hardcoded secrets and is deliberately excluded.

## State as of 25 July 2026

**Live and working**

1. **ERP portal, Phase 1: DEPLOYED** at `creme-castle-erp.vercel.app` (see
   `docs/erp-portal-plan.md`). Email + password login with roles
   (`migrations/040_portal_profiles.sql`), daily dashboard latest + archive, and CSV
   downloads of five reports. Runtime env is set; migration applied.
2. **The 8am job actually runs now.** It had been failing silently since it was
   created: macOS refuses to let a launchd agent execute anything inside iCloud Drive
   ("Operation not permitted", exit 126). The runtime is now a LOCAL clone at
   `~/creme-castle-erp` that `git pull`s each morning. Never point a scheduled job at
   iCloud, and never let a second copy of the code drift (that also happened).
3. **Each 8am run**: pull code, scrape Petpooja once, load and verify the last three
   business days into the spine, pull the Sub-Order Wise summary for yesterday, build
   the dashboard, archive it for the portal, email the team.
4. **Spine holds full-fidelity Petpooja sales**: order report all 27 columns
   (101k rows), item report all 32 columns (152k rows), 30 days backfilled. Plus
   sub-order summary, and one sample day each of daily stock and the SupplyNote
   invoice-wise report.
5. **Self-verification** (`workers/petpooja-ingest/sync.py`): a per-day fingerprint
   makes an unchanged day cost one comparison; only genuine differences are corrected
   in place, with a field-level change log. Nothing is ever deleted, only voided.
   Guards refuse to act on a key collision, a truncated pull, or a partial day.

**Pending**

1. **Team accounts for the portal**: only one profile exists (Pranjay). Create each
   teammate in Supabase Auth, then activate them in `public.profiles`.
2. **Rotate the spine database password** (it was exposed in a chat session). Update
   it in the Vercel `SPINE_DATABASE_URL` and in `~/creme-castle-erp/dashboard/auto/.env`.
3. **Daily stock report automation**: URL and flow are captured in
   `docs/petpooja-report-portal-map.md`, but it is per outlet (~8 of them) and the
   underlying data is unreliable, see the warning below. Decide daily vs weekly.
4. **SupplyNote ingestion** (one way, read only; GRN report is the prize). File upload
   only, no scraper. `Invoice Wise Sales` already turns out to be a SupplyNote export.
5. **Portal Phase 2**: browse and filter the data in the app.
6. **Two year history import** into the spine (Pranjay to supply the files).
7. **4-computer failover network** for the scrape.
8. **Build 1a real reconciliation volume** still gated on OMS billing go-live (F13).
9. Housekeeping: 75 disposable test rows remain in `landing.petpooja_oms_purchases`.

## Warnings, read before trusting the data

- **Petpooja stock is NOT trustworthy yet.** Its own inventory dashboard reports
  "34% update accuracy: closing stock updated on 8 days this month, 16 days missed",
  and the stock report showed a negative opening balance. Land it as raw history if
  you like, but do not build costing or valuation on it. This is exactly why our own
  logbook matters.
- **The Sub-Order Wise summary uses Petpooja's calendar day**, not the spine's 04:00
  business day, because Petpooja aggregates it server side. It will not tie out to the
  line-level reports across the midnight to 4am window. Use it for channel and outlet
  comparison, not as the arbiter of a day's revenue.
- **Customer PII is now stored and downloadable.** Decision of 24 July 2026 reversed
  the earlier rule: the landing tables and the portal's CSV downloads include customer
  name, phone and address. Anyone with portal access can export them.
- **Raw receipts always contained PII.** The immutable files in the `petpooja-raw`
  bucket are the originals.
- **Do not put automation in iCloud Drive.** See point 2 above.
