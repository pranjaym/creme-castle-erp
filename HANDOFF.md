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

## Open items / next up

1. Creme Castle ERP portal, Phase 1: BUILT 24 Jul 2026 in `portal/` (see
   `docs/erp-portal-plan.md`). Next.js app, builds clean. Email + password login
   (`kitchen/migrations/040_portal_profiles.sql` adds `public.profiles` + role), the
   daily dashboard latest + archive (reads a new `dashboard-html` Storage bucket that
   `dashboard/auto/run_daily.py` now uploads to), and order/item report CSV downloads
   (PII-free, from `landing`). PENDING Pranjay (outward, live secrets): apply the
   migration, create the Vercel project (root `portal/`) + env, create the
   `dashboard-html` bucket, create the accounts. Then Phase 2 (in-app browse/filter).
2. Route the daily Petpooja data into the spine DB (unify the split above).
3. Stand up the 4-computer failover network for the scrape.
4. Build 1a (D2C reconciliation) real volume is gated on OMS billing go-live (F13).
5. SupplyNote ingestion into the spine (the boundary is one-way, read only; see build-order).
