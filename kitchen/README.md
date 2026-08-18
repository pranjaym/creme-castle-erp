# Creme Castle Kitchen (spine module)

The third Creme Castle app: the canonical data spine plus the first two consumers.
Sibling of `cremecastle-oms` and `cc-dispatch-console`; on monorepo consolidation
it moves to `apps/kitchen`. Planning lives in `../erp-plan/` (authoritative).

Two green-lit builds live here:
- **Build 1a: D2C reconciliation.** OMS orders vs Petpooja punch-outs at the four
  D2C stores, three exception buckets, per store, per business day.
- **Build 3a: intermediates logbook.** Phone-first four-action logbook for sponges
  and ganaches, giving the frozen buffer its first real ledger.

## The three layers (never cross them)

1. **Landing zone** (`landing.*`, migration 010): raw per-report data plus an
   ingest stamp; the raw file is kept as an immutable receipt. Nothing builds on
   it directly.
2. **Canonical spine** (masters in 000, seeds in 005/006, views in 020/030):
   typed, deduplicated, resolved against the SKU and location masters, stamped by
   the one business-day rule. The single source of truth.
3. **Consumers** (`/recon`, `/log`, `/buffer`): read only layer 2, never a scraper
   or Petpooja directly.

## Locked decisions (see ../erp-plan/build-plans-1a-3a.md)

- Business day: 04:00 to 03:59 IST (`business_day()` in 000, `lib/business-day.ts`).
- Spine is a new third Supabase project; OMS and console untouched.
- The spine reads OMS orders read-only; it never writes back.
- Four D2C stores: SPJ=CC-DL-Shahpurjat, FBD=CC-FBD-Sector 15, GN=CC-ND-Alpha 2,
  Meerut=CC-UP-Meerut.
- Reconcile on orders, not bills. Order-number key handles both `171643` and
  `CC-<id>` shapes (`lib/recon/match-core.mjs`).
- Every number reproducible; AI is never load-bearing anywhere in this repo.

## Apply and seed

Numbered ALTER migrations, applied with `scripts/migrate.mjs`. That is the only
path. **The spine is never re-baselined again.**

The old re-baseline paste (`ALL.sql`) is retired. It was renamed on 18 August 2026
to `migrations/OBSOLETE_DO_NOT_RUN_rebaseline_2026-07-23.sql.txt` and must never be
run: its first statement is `drop schema if exists landing cascade`, which would
delete every ingested row (~1.65M Petpooja item rows, 300,000+ Zomato orders) and,
through the cascade, the core, identity and mart layers built on them. Its original
"safe now, the pilot has no data" note was written when the whole spine was empty
and has been false since the first ingest ran.

Migrations in order: 000 foundation, 005 locations, 006 skus, 007 par, 008 uom,
009 config, 010 landing, 020 recon, 030 logbook. Regenerate the generated seeds:

```
python3 scripts/gen_seed_sql.py     # 005 locations, 006 skus, 007 par, 008 uom
```

`gen_seed_sql.py` reads `seed_data/*.xlsx` and is deterministic: same inputs, same
SQL. The SKU seed is the chef's v2 master (46 intermediates, sorted by daily
volume within type, with par stock, par type, to-spokes, and some shelf life).
Par loads as `007_seed_par.sql` (par_qty null for non-numeric par types
`on_demand` / `ready_made`); shelf life is mostly still null and loads later with
no schema change.

## Run

```
npm install
npm test                 # deterministic matcher + business-day tests (node --test)
npm run dev              # the logbook, buffer, and reconciliation screens
```

Ingest (folder named `workers/`, kept out of the Vercel build):
```
node workers/oms-ingest/pull_oms_orders.mjs 2026-07-22
python3 workers/petpooja-ingest/ingest.py --report oms_purchase --file <MaterialPurchaseReport.xls>
```

## Deployed

Live at **https://cremecastle-kitchen.vercel.app** (Vercel, team `creme-castle`,
project `cremecastle-kitchen`). Single Next.js app (`vercel.json` pins framework;
the Python `workers/` are `.vercelignore`d). Spine env vars set in Vercel
(Production). Redeploy: `npx vercel deploy --prod`.
The Petpooja punch source is the **Material Purchase Report downloaded at the
vendor-OMS location** (one file, every store's D2C transfer into vendor "OMS";
`Invoice Number` holds the OMS order number). It is an HTML table saved as `.xls`.
Reconciliation matches on **units and line count**, not rupees (the transfer's
`Net Amount` is Petpooja's valuation, not the customer's D2C bill).

## Status (23 July 2026)

- Migrations, seeds (46 intermediates from the chef's v2 master, with par stock;
  53 locations), the matcher, and the app are written and the pure-logic parts are
  tested green. Nothing is applied to a live DB yet: that needs the spine
  Supabase credentials.
- The Petpooja punch source (Material Purchase Report at the vendor-OMS location)
  is wired: landing table, canonical punch-out view, and an HTML parser verified
  against the real sample. The vendor-OMS punching itself goes live with OMS
  billing; until then the report simply has no OMS-vendor rows.
- The Petpooja scrape step (auto-download) is a documented skeleton (portal-specific
  export flow); the parser and everything downstream are real and reproducible. A
  manually downloaded report can be loaded today with `--report oms_purchase`.

## Security

Never commit secrets. `petpooja_pipeline.py` and `cc_spotcheck` (reference only,
they carry live secrets) are gitignored and must never enter this repo. All
credentials come from environment variables. Rotate any exposed secret before any
push (erp-plan flag F10).
