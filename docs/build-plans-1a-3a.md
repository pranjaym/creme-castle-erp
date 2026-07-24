# Build Plans: 1a and 3a
**Home:** `erp-plan/build-plans-1a-3a.md`. Reads with `build-order.md` v0.3 and `integration-notes.md` (v0.1 + section 9).
**Status:** Green-lit by Pranjay 22 July 2026. For Claude Code to execute after reading integration-notes.
**Date:** 22 July 2026.

## The design both builds sit inside (read first)

Three layers, strictly separated so the data source can change without breaking anything downstream:

1. **Landing zone:** raw ingested data, one table per source report, stored exactly as pulled plus an ingest timestamp, with the raw file retained as an immutable receipt. Ugly is fine; nothing builds on it directly.
2. **Canonical spine:** deterministic transforms of the landing zone into clean, typed, deduplicated tables resolved against the SKU master and location master, business-day-stamped by the canonical rule. Single source of truth. Everything downstream reads only here.
3. **Consumers:** reconciliation report, console feed, logbook cost views. Read only from layer 2. Never touch a scraper or Petpooja directly.

Rishabh's pipeline is NOT to be copied. It is proof that (a) the two Petpooja reports (`online_orders_report_all`, `order_summary_item`) are pullable without an API, and (b) the glossary/metrics knowledge exists. Take the knowledge (which reports, the metric definitions, the business-day rule), build our own ingestion into the layered design.

## Canonical decisions locked (do not re-litigate)

- **Business day:** 4:00 IST to 3:59 IST next day. Outlets trade 7am to 2am; the 4am cutoff sits in dead hours. This is the single day-attribution rule for the whole spine. (Resolves F11.)
- **Supabase topology:** new third "spine" project; OMS and console projects untouched. (F1.)
- **D2C punch mechanism:** confirmed working: transfer to a Petpooja vendor named "OMS"; stock reduces; OMS order number goes in the invoice-number field. Reconciliation matches on that field.
- **Four D2C stores (F7 resolved):** SPJ = CC-DL-Shahpurjat; FBD = CC-FBD-Sector 15; GN = CC-ND-Alpha 2; Meerut = CC-UP-Meerut.
- **Meerut (F5):** create a real Meerut outlet in OMS (Pranjay actioning).
- **Reconcile on orders, not bills** (OMS billing is manual, F in section 2.4).
- **Secrets (F10):** rotate and externalise before any repo push. Rotation in progress.

## Build 1a: D2C reconciliation report

**Goal:** every morning, for the four D2C stores, show three exception buckets from yesterday's business day: (1) Petpooja punch with no matching OMS order (the leak), (2) OMS order with no matching punch (silent overstatement), (3) matched but quantity/item mismatch. Flag any matched pair whose OMS order was later cancelled or refunded.

**Layered work:**
1. Landing: ingest the two Petpooja reports into the spine's landing zone, our own ingestion (Playwright session pattern is fine as a technique; do not import Rishabh's file with its secrets). Keep raw receipts. Idempotent on (report key, business date).
2. Canonical: transform into a clean `petpooja_punchouts` view (vendor-OMS transfers at the four stores, with the invoice-number reference parsed out) and confirm OMS orders are queryable per store per business day. Resolve store names via `location_aliases`; note the OMS-outlet-to-console-store granularity (GN = CC-ND-Alpha 2 lives under the ND prefix).
3. Consumer: the matcher. Normalise the reconciliation key both shapes (`171643` bare Shopify number and `CC-<id>`), per integration-notes 2.2. First cut may match at order-total and line-count level; strict per-item matching waits on the SKU alias seed for these four stores (F8). Output the three-bucket report to a table the morning view reads, and as a daily email/message to Pranjay and controls.

**Manual interim (from OMS go-live, before automation):** controls team does the same match in Excel (OMS order export vs Petpooja transfer export, by order number). The control exists before the code does.

**Exit criteria:** for one week, the automated report's buckets match a manual spot-check, and every OMS order at the four stores resolves to exactly one punch or lands in a bucket.

## Build 3a: intermediates logbook

**Goal:** a phone-first screen where the sponge and ganache team logs, per item, four actions: batch made (into freezer), taken out for production, sent to spoke, wasted (reason-coded). Gives the frozen buffer its first real ledger. Habit and visibility only; no costing, no recipes yet.

**Seed data (ready now):** `intermediate-sku-master.xlsx`, 45 items with canonical codes, display names, type, unit. Locations from `Outlet_Master.xlsx`. Shelf life and par stock arrive end of 22 July and load later without code change.

**Layered work:**
1. Canonical: seed the `skus` table with the 45 `sku_type='intermediate'` rows and the kitchen/freezer/spoke locations. This is layer-2 master data.
2. Consumer: the logbook UI writing production/movement entries into a canonical `production_log` (or movement) table on the spine. Under one minute per entry, big buttons, minimal typing, Hindi labels where useful. Works on a cheap tablet or phone.
3. A simple daily read-back: today's entries and current frozen-buffer level per item (par comparison once par data lands).

**Rollout (Option A, locked):** sponge and ganache department only. No double entry (intermediates are recorded nowhere today). Cakes and desserts join in a later build (3b) that replaces the vendor-Production jugaad. Sponsor: Chef Azeem. Users: the three department chefs (sponge/ganache first). Operators: Pawan and Rishabh. No-consequences pilot for ~1 month, announced to the team.

**Exit criteria:** the sponge/ganache team logs daily for two weeks with entries that Pawan/Rishabh confirm reflect reality, and the frozen-buffer ledger stops going negative.

## Build session outcome (23 July 2026)

Both builds were constructed in a new sibling repo `../cremecastle-kitchen` (per the code-home decision). Not yet a git repo, not yet applied to a live database (needs spine credentials). Contents:

- **Migrations (the three layers):** `000_foundation` (the `business_day()` 04:00 IST function, location and SKU masters plus their alias tables, `par_stocks`, append-only `spine_events`), `005_seed_locations`, `006_seed_skus`, and `007_seed_par` (generated deterministically by `scripts/gen_seed_sql.py` from `seed_data/`: 46 intermediates and their par stock, 53 locations including the special nodes and the four OMS to console D2C aliases), `010_landing` (raw Petpooja and OMS tables in a private `landing` schema plus `ingest_runs`), `020_canonical_recon` (the switchable punch-out view, the OMS orders view, and the `d2c_reconciliation` output), `030_production_log` (the append-only logbook, waste reasons, frozen-buffer and today views).

- **Chef v2 refinement (23 July 2026):** the chef returned `intermediate-sku-master-v2.xlsx` (via `sponge-ganache-item-template.xlsx`). It supersedes v1: 46 items (was 45), re-sorted by daily volume within type (the order the logbook shows), and it now carries typical daily qty, par stock, par type (`fixed` / `on_demand` / `ready_made`), to-spokes, and two shelf-life values. Folded in cleanly (nothing was applied to a live DB, so no migration cruft): `skus` gained `typical_qty_per_day`, `sort_order`, `to_spokes`; `par_stocks.par_qty` became nullable with a `par_type`; par seeds as `007`. Buffer behaviour (real buffer vs made-fresh-daily) is DERIVED in `v_frozen_buffer`, never stored. The logbook and buffer screens now order by the chef's volume order and show the derived behaviour. v1 codes were reassigned in v2; safe because no logbook data exists yet.
- **Reconciliation core:** `lib/recon/match-core.mjs`, deterministic, both order-number shapes normalised, three buckets plus a cancelled-or-void flag. Covered by 16 passing `node --test` tests.
- **App:** Next.js `/log` (phone-first, four big buttons, Hindi labels), `/buffer` (frozen-buffer read-back), `/recon` (three buckets per store). Server-side, service-role, reads only public canonical views.
- **Ingest:** `services/oms-ingest/pull_oms_orders.mjs` (reads OMS read-only, writes landing by SQL), `services/petpooja-ingest/ingest.py` (our own; real parser plus a documented Playwright scrape skeleton; every secret from env). Rishabh's file is never imported and is gitignored.

Verified now (no live DB needed): the matcher and business-day tests pass, and the seed generator is byte-deterministic. To apply: paste the migrations into the spine Supabase SQL editor in filename order, or run `scripts/migrate.mjs` with `SPINE_DATABASE_URL`. Still outstanding: spine Supabase credentials, the OMS read-only key, and confirmation of the `delivery_date` reconciliation-day assumption.

## Build 3a UX, revised 23 July 2026 (category team feedback)

Shown to the category team. Corrections that reshaped the logbook:
- **The real user is a senior chef entering from a computer in the evening, not a junior worker on a phone.** Build desktop-first; a mobile version comes later. (My earlier phone-first, visual-first design was built on the wrong persona.)
- **No photos:** intermediates look alike, so photos add nothing.
- **Tabular entry:** see many items at once and type the quantity inline (a register), then Save all. Not a one-item wizard.
- **Issued reordered:** pick the destination first, then fill quantities for many items at once.
- **Wasted:** dropdown rows (item, reason, quantity), few clicks.
- **"Request" model proposed:** the receiver raises a free-issue request and material transfers against it (matches SupplyNote indents). Recommendation, still open for decision: build the sponge-department send-side table now (pilot scope, one team), then layer a Requests module next where a request is a pre-filled issue, so the receiving teams become users only when ready. A disabled "Requests (soon)" tab marks the place.

Built: a desktop tabbed table (Made / Issued / Wasted) with a bulk `logBatch` save, verified live. Open decisions: who-enters identity (senior chef login or name), whether Hindi is needed on a desktop tool (removed for now), and Requests now vs later.

## Petpooja ingestion (Build 1), direction decided 23 July 2026

- **Path B (browser agent) chosen** over the email-parser path. It runs on an always-on cloud server (the Dispatch Console's Railway-runner pattern, roughly $5/month), not on anyone's laptop. The laptop is needed only once, for the first Petpooja OTP login; the agent then saves the session (cookies/storage state) and reuses it, so Petpooja does not re-prompt.
- **Proven, not a gamble:** Rishabh's existing pipeline already scrapes Petpooja from Google Cloud Run ("Oracle Run" was Cloud Run) despite Petpooja's heightened security. So the smartest build is to **adapt his working pipeline** (rotate and externalise its hardcoded secrets first, F10) and repoint its output from Google Sheets to Supabase, rather than write a new scraper. One username, password, plus OTP covers all reports.
- **Needed to start:** Petpooja credentials (into the cloud server's env, never in chat) and a confirmation of which reports first (start with the purchase/transfer report for Build 1a, then sales and closing stock). Interim option: a one-click load of a manually downloaded report into the DB (needs the spine database connection string).
- Already built: the landing tables and the purchase/transfer parser (`workers/petpooja-ingest/ingest.py`).

## Session handoff (23 July 2026)

Build 3a logbook is live (desktop, no pre-selection) at https://cremecastle-kitchen.vercel.app/log. Spine schema v2 is applied; nothing is saved to `production_log` yet, so the sponge team still makes the first real entry (after which the project switches from re-baseline to numbered ALTER migrations forever). Build 1a code and matcher are done. Open decisions: Requests now vs later, who-enters identity, and whether Petpooja Path B adapts Rishabh's pipeline or is built fresh. Pending action: rotate the exposed spine service_role key. Everything is captured in the memory index, these `erp-plan/` docs, and the `cremecastle-kitchen/` code, so a fresh session continues without loss.

## Build 3a: date-first entry, so night production lands on the right day (24 July 2026)

Team feedback (via Pranjay): production runs across the night and a chef who forgot a day, or who is entering a batch made in the small hours, had no way to attribute it to the correct day. The logbook hardwired the date at the moment of saving, so everything landed on today. Decided and built the same day (green-lit: "build it now").

**Domain correction the same day (important):** the 04:00 to 04:00 IST business-day rule is a FRONT-OF-HOUSE / SALES concept (outlets, POS, reconciliation, console feed), because outlets are shut in the 04:00 to 07:00 dead hours. It does NOT apply to the kitchen. The kitchen (back of house) is online 24 hours, so it has no dead-hour cutoff: the production day is the plain IST calendar date, midnight to midnight. The first build wrongly imported `business_day()` (the 04:00 rule) into the logbook; that was corrected to `istCalendarDate()`. The 04:00 rule stays locked where it belongs (sales), and `business_day()` in SQL is unchanged and still used by the sales spine.

- **Date is now the first step.** Before choosing Made / Issued / Wasted, the chef picks the day. Nothing is pre-selected, so the chef always states the day for a night batch explicitly. The screen shows real dates with weekday plus a Today / Yesterday hint (real dates, not a bare relative word, so there is no ambiguity).
- **The day is the IST calendar date (24h kitchen), NOT the 04:00 sales day.** The two date buttons and the server window are computed from `istCalendarDate()`. No 04:00 shift, no "before 4am counts as the previous day" note.
- **Window: yesterday only (Pranjay's choice).** Selectable days are today and the calendar day before it. Never the future. The server re-validates this window in `logBatch` (the client is not trusted); an out-of-window date is refused.
- **Honest trail, no loud judgment.** `business_date` holds the chef-chosen production day; `entered_at` (the honest wall clock) records when it was actually typed, so a catch-up entry is always distinguishable in the audit (`entered_at <> business_date`). There is deliberately NO red "Late entry" badge in the UI: under 24h operation a batch logged just after midnight for the shift that just ended is not really late, and a badge would misfire there. `spine_events` still records `business_date` and a `backdated` boolean per batch for audit; the save confirmation names the day it saved to (for example "Saved 6 made entries for 2026-07-23 (Thursday)") so a catch-up entry is never double-punched onto today.
- **Files touched (no schema-shape change):** `lib/business-day.mjs` (added `istCalendarDate`, plus pure `ymdAddDays` and `weekdayForYmd`), `app/log/page.tsx` (builds the two allowed calendar-date choices), `app/log/LogClient.tsx` (the choose-day step, change-day control), `app/log/actions.ts` (accepts and re-validates the chosen date against the calendar window, honest `entered_at`, backdated flag in the audit event), `app/globals.css`. SQL comments and the two logbook views (`v_today_entries`, `v_frozen_buffer` par-effective) and the `par_stocks.effective_from` default were moved off `business_day()` onto the IST calendar date in `030_production_log.sql`, `000_foundation.sql`, and `ALL.sql` (the kitchen never uses the 04:00 rule). Tests: 8/8 green (added kitchen calendar-date cases). The append-only, no-edit, no-delete model is untouched (a correction remains a new reversing row).

**Open, to confirm with the team:** (1) confirm the kitchen production day is the plain IST calendar date (midnight rollover) as built; the team's "after 2am it is today's production" habit is handled by the mandatory manual choice, not by any hardcoded cutoff. (2) The live spine DB needs the two logbook views replaced to match (they currently filter on `business_day()` if applied before this change); trivial `create or replace view` on `v_today_entries` and `v_frozen_buffer`, but it needs spine credentials, and whether it goes via re-baseline or a numbered ALTER depends on whether the sponge team has made their first real entry yet. (3) whether managers want an "entered late" read-back (the data supports it via `entered_at` vs `business_date`); left out of the UI for now. (4) once costing arrives, revisit whether "yesterday only" is still the right guardrail or whether backdated production needs a sign-off.

## Sequencing note

1a and 3a run in parallel. 3a has zero dependency on ingestion (it writes our own data in), so it can move as fast as the UI is built and the champion is ready. 1a depends on the landing + canonical layers for Petpooja. Both write into / read from the same canonical spine, which is the point: they are the first two consumers proving the three-layer design.

## Build execution decisions (22 July 2026)

Decided with Pranjay after the two build plans were shown. Written back per the covenant.

- **Code home:** a new sibling repo `cremecastle-kitchen/`, beside `cremecastle-oms` and `cc-dispatch-console`. Rationale: folder layout does not affect integration (that happens through the shared spine database and clean contracts), it touches no live repo while the module is young, and it moves under `apps/kitchen` with history preserved if and when the monorepo is green-lit (F2). Starting in a monorepo skeleton now was rejected as committing to a shape not yet approved.
- **Spine reads OMS read-only:** the spine ingest connects to the OMS Supabase with a read-only service key (from env) and pulls the four stores' orders per business day into `landing.oms_orders_raw`. No change to the live OMS repo. The console-to-OMS link stays only via the shared spine, never direct.
- **Reconciliation day key (CONFIRMED by Pranjay 23 July 2026):** OMS orders join the business day by `delivery_date`. The invoice is raised on the delivery date, not the order date, so the punch and the order line up on that day. Petpooja punch-outs use their own `business_date` (04:00 IST rule).
- **Stack:** kitchen module is Next.js + TypeScript on the spine Supabase project (phone-first, big-button UI, server-side service role, role gates), matching the sibling apps; the Petpooja ingest is our own Python + Playwright worker (Rishabh's file is reference only, never imported); every secret is an environment variable; the matcher is deterministic with unit tests. No AI anywhere in either build.

### Verified against real report samples (23 July 2026)

Four Petpooja exports for 22 July were provided and inspected (read-only). Findings that shape Build 1a:

- **The report that carries D2C punches is `order_summary_item`** (the item sales report). All four D2C stores appear in it (Shahpurjat, FBD Sector 15, Alpha 2, Meerut). Its columns: `restaurant_name, invoice_no, date, payment_type, order_type, status, area, virtual_brand_name, ..., my_amount, total_tax, discount, delivery_charge, container_charge, ..., total, item_name, category_name, sap_code, item_price, item_quantity, item_total`.
- **The two order-count reports (`online_order_report`, the historical `order_report`) are Zomato and Swiggy only** (Order From in {Zomato, Swiggy, Toing by Swiggy}); they do not contain website or D2C orders. So they feed the console sales component, not the D2C reconciliation.
- **The vendor "OMS" punch mechanism is not live yet:** zero rows mention "OMS" in any sample (expected, since OMS billing go-live is still pending). Today's website or D2C punches appear in `order_summary_item` as `payment_type` strings such as `Other [Web](web order 174736 paid 549)`, `Other [WEB ORDER]()`, `Other [website]()`, `Other [web order]()`, `Other [Payu]()`. When present, the OMS or Shopify order number is embedded in the `web order <N>` text, but many rows have empty parentheses, so current-state remarks are sparse and unreliable.
- **`invoice_no` in this report is Petpooja's own POS invoice number (for example 8649), not the OMS order number.** Do not match on it.
- **Consequence (switchable parser, resolves P-A for the D2C side):** the Petpooja-side parser supports two punch shapes and normalises both to the OMS order number. Shape 1 (current): extract the web-order reference from `payment_type`. Shape 2 (target, at go-live): read the OMS order number from the vendor-OMS transfer's invoice-number field. Reconciliation matches on the normalised OMS order number in either shape. Real reconciliation volume begins at vendor-OMS go-live; until then the matcher is validated on synthetic fixtures plus the sparse current-state web punches.
- `sap_code` in `order_summary_item` is present but empty in the sample: it is the intended Petpooja item-code column for the future `sku_aliases` seed (F8), currently unpopulated.
- **Petpooja source for Build 1a is the TRANSFER report, confirmed by Pranjay 23 July 2026.** Two consequences: (1) D2C invoicing in Petpooja STOPS at the four stores, so the current-state `Other [Web]` sales rows disappear and none of the three sales reports (`order_summary_item`, `item_customer_summary`, `online_order`) are used for the punch side of the reconciliation. (2) The punch is a stock transfer to a Petpooja vendor named "OMS"; that transfer report carries an invoice-number column, and the team writes the OMS order number into it. So the reconciliation key is read directly from one column, not parsed out of payment-type text. This resolves P-A and supersedes the earlier "switchable web-payment parser" note above. Format received and wired 23 July 2026 (samples: Material Transfer Report and Material Purchase Report). Facts:
- **The single source is the Material Purchase Report downloaded at the vendor-OMS location** (one file, every store's D2C transfer into OMS): columns `Supplier/Kitchen/Rest name` (the store), `Invoice Date`, `Invoice Number` (the OMS order number the team writes), `Raw Material`, `Quantity Purchased`, `Unit`, ..., `Net Amount`. The Material Transfer Report is the mirror (per store, `Transferred to` = OMS, source in the title block).
- **These `.xls` files are HTML tables, not real Excel**, with a title block above the header row. The ingest parser handles that (`workers/petpooja-ingest/ingest.py`, `--report oms_purchase`), verified against the real sample (75 rows, one business day, grouped into orders).
- **CORRECTION (23 July 2026):** the "verified 75-row sample" is **Central Dispatch Noida's own purchase report**, i.e. internal CK-to-Central-Dispatch transfer traffic. Its `Invoice Number` values are Petpooja's auto-generated transfer-doc numbers (`CT24251140..145`), **not** OMS order numbers; the Central Kitchen sample's `Invoice Number` is blank. So the parser is proven **structurally** (title block, day-stamp, key extraction, idempotency) but **not** against real vendor-OMS D2C punches, because that flow is not live yet. Real Build 1a reconciliation volume begins at **OMS billing go-live** (when the team hand-types OMS order numbers into vendor-OMS transfers). Until then the matcher runs on synthetic fixtures. Tracked as F13 in `integration-notes.md`. The ingestion machinery (scraper, loader, cloud runner) is built and ready so that go-live is the only remaining gate.
- **The structural match is on UNITS and LINE COUNT, not rupees.** The transfer's `Net Amount` is Petpooja's item valuation, not the customer's D2C bill, so the two rupee totals differ by design; the matcher compares total units (`order_qty` vs `punch_qty`) and line count, and shows rupees for context only. `match-core.mjs` and its tests were updated accordingly (16 tests green).
- Landing table `landing.petpooja_oms_purchases`; `v_petpooja_punchouts` rebuilt on it; `Invoice Date` maps to the business day with no 4:00 shift (it is already a booked-transfer date). The sales reports remain relevant only to Build 2 (the console feed's sales component), not to Build 1a.
- A third export, `item_customer_summary_all` (downloaded zipped, one CSV per day, title rows above a header at row 4), was evaluated (22 Jul sample). It is the fullest item-level report: all channels (not only Zomato/Swiggy), one row per item, with `Category, HSN, Sap Code, Group Name` and customer `Phone/Name/Address`. All four D2C stores appear. BUT it does NOT carry the reconciliation key: zero rows embed an OMS or Shopify order number (its `Payment Type` is the bare label `Other [Web]`, without the `(web order N)` parenthetical), and `Sap Code` is populated on only 6 of 200 D2C rows. So it does not replace the vendor-OMS mechanism for Build 1a's key. Its real value is the SKU alias map (F8) and the deferred per-item bucket: 125 distinct Petpooja item names with categories, to be mapped to OMS `product_title` (join on item name plus category, not sap_code). Candidate landing table `landing.petpooja_item_customer_summary`, added when per-item matching is scheduled (not on the first-cut path).

### Pending inputs (needed to seed and to make numbers reproducible, not to write schema)

- `Outlet_Master.xlsx`: the full location seed. Until it lands, a minimal known location set (kitchen, freezer, Central Dispatch, the GGN / Janakpuri / Noida spokes, and the four D2C stores) is seeded, and the full master backfills without a schema change.
- One real day's export of each Petpooja report (`online_orders_report_all`, `order_summary_item`): to map real column headers in the landing parser and to confirm exactly which report and column carry the vendor-OMS punch-out and its invoice-number field.
