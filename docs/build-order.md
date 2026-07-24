# Build Order v0.4
**Home:** `erp-plan/build-order.md`. Companion to `kitchen-production-brief.md` and `cc-flow-map-v2.mermaid`.
**Status:** Step 0 decided (mechanism per Pranjay: vendor "OMS" in Petpooja, transfers punched to it, controls team matches vendor-OMS movements against OMS order data daily). Build 3 split into 3a (intermediates logbook, starts immediately in parallel) and 3b (full logging, after spine and recipes), decided 21 July 2026. SupplyNote boundary decided 22 July 2026 (new section below). **Date:** 22 July 2026.

## Operating principles

1. Capture reality before changing behavior. Read-only builds precede write builds.
2. Spine before limbs: everything reconciles against the ingested data layer.
3. Easiest and most necessary coincide at the spine; start there.
4. The canonical data model (masters, movements, production runs, recipes, history) is the asset. Apps are disposable. A future ERP (Microsoft/SAP class) inherits the model and its history as requirements plus migration data.
5. Behavior changes (new logging) are introduced only when a computable check exists for them.
6. Dispatch Console covenant holds throughout: the model is never modified; we change only how its input feed is produced.

## Architecture decision: the SupplyNote boundary (DECIDED 22 July 2026)

**Context.** SupplyNote supports recipe-based consumption but is not used for it: the recipe structure does not fit a two-stage bakery kitchen and the input UX produces errors that are hard to process. SupplyNote invoices do not feed Tally for GST or the Section 148 defence (totals are matched only), so replacing any part of it carries no statutory exposure. No item-level COGS exists today: COGS is derived company-wide as opening plus purchase minus closing. SupplyNote has an API but no public developer documentation, and Petpooja's API was quoted at commercial terms that only make sense for multi-account integrators, not a single brand. Assume no write API on either side.

**Consequence, and the reason this is not a loss.** Everything Pranjay asked for (production logged, live kitchen visibility, day-level cost, per-item COGS, plan versus actual) is computable from three inputs: material issued into a kitchen, production output, and recipe-standard consumption. The first is readable, the second is Build 3a/3b, the third is workstream zero. None of it requires writing into SupplyNote. Write access would matter only if SupplyNote were to remain the system of record for kitchen stock, which it will not.

**The boundary (one-way, no sync).**
- **SupplyNote owns:** vendors, purchase orders, GRNs, central warehouse stock, and the issue of material out to any location (kitchens, spokes, stores). All locations continue to raise POs on the central warehouse in SupplyNote.
- **Our tool owns:** everything from the moment material lands at a location. Kitchen raw material stock, intermediates, production, finished goods, wastage, and recipe-based consumption.
- **The handoff:** the SupplyNote issue/transfer document, read into the spine and treated as our opening receipt. One direction only. Nothing is written back. Nothing needs to be kept in agreement except a boundary already recorded today.

**Known and accepted consequence.** SupplyNote's kitchen and store locations will keep receiving issues and never consuming, so their book stock inflates (the mirror image of the permanently negative sponge and ganache problem). Chosen handling: continue the existing month-end physical count and true-up, unchanged, so Ajay's process is not disturbed. Planned upgrade once the consumption engine is trusted: the closing figure comes from our computed ledger and the physical count validates it rather than absorbing the variance, turning the true-up from a plug into a real measured variance. Alternative considered and not chosen for now: expensing material at point of issue and removing kitchen as a stock location in SupplyNote entirely.

**What this makes us responsible for building** (the same work in every version of this decision, since SupplyNote is not doing it today): two-stage BOM with yields (raw material to intermediate, raw material plus intermediate to finished good), a consumption engine (production times recipe equals raw material consumed), and weighted-average valuation computed from ingested GRN rates. Valuation is the part most likely to go quietly wrong; quantities can look perfect while rupee values drift. Build it last and reconcile it against the existing opening-plus-purchase-minus-closing figure before trusting it.

**What we deliberately do not build:** vendors, purchase orders, GRNs, central warehouse stock. That is the part of SupplyNote that earns its fee. Optional future extension (not committed): once the tool is running well, absorb vendor purchase too, as an extension rather than a migration.

**Open item, no longer an API question:** can SupplyNote schedule automatic report exports, and of which reports? Needed at minimum: purchases and GRNs (for rates, which drive valuation), issues to kitchens and stores, indents, and warehouse stock. This is a support question, not a commercial negotiation. If scheduling is unavailable, fall back to the same browser-export pattern used for Petpooja.

## Infrastructure and Build 1a decisions (write-backs)

- **Supabase topology, DECIDED 22 July 2026 (spine-first, three projects).** OMS and the Dispatch Console stay on their existing live Supabase projects, untouched. The kitchen module gets a new third "spine" Supabase project, the canonical data layer and the shared database Build 2's autofeed reads from. Merging all three is a later phase, not a prerequisite. **The spine project was created and the full schema applied on 23 July 2026 (Phase 1 done).** Code consolidation into a monorepo is proposed in `integration-notes.md` and still awaits go-ahead.
- **Code home:** a new sibling repo `cremecastle-kitchen/` (moves under `apps/kitchen` if the monorepo is approved).
- **Reconciliation day, CONFIRMED 23 July 2026:** OMS orders attribute to the business day by `delivery_date` (the invoice is raised on delivery, not the order date).
- **Petpooja punch source, CONFIRMED and BUILT 23 July 2026:** the Material Purchase Report downloaded at the vendor-"OMS" location (one file, all stores' D2C transfers into vendor OMS; `Invoice Number` holds the OMS order number). These `.xls` files are HTML tables. Reconciliation matches on units and line count, not rupees (the transfer's Net Amount is Petpooja's valuation, not the customer's D2C bill). This supersedes the "NC vs sink, pending admin session" language in Step 0 below and answers Step 0 action (4): OMS invoicing is a manual one-tap action, not automatic; reconcile on orders. Detail in `build-plans-1a-3a.md` and `integration-notes.md`.

## Data findings and schema v2 (DECIDED 23 July 2026)

Real SupplyNote and Petpooja exports (`data-findings-2026-07-23.md`, samples in `erp-plan/data-samples/`) corrected several assumptions. Decisions, detail in `schema-v2-proposal.md`:
- **Kitchen departments are real locations,** true role as the name, SupplyNote legacy name as an alias: Sponge and Ganache Dept (ND-CK-Bread Dept), Dessert Dept (ND-CK-Desserts Dept), Cake Dept (Central Kitchen Noida). Central Dispatch aliased across both spellings; three spokes and the central warehouse (Store Noida) seeded. Source "Outlet Code" is not unique and is never a key; the "active" flag is unmaintained and is never used to filter (liveness from transaction recency).
- **Units:** every item carries a base unit (gram, millilitre, piece) and dated, versioned conversions; recipes are in base units. 694 of 1,011 items are "piece" and need pack conversions (workstream zero); the schema supports it now.
- **Movement model (Build 3a):** three verbs, made, issued (destination from the location master), wasted (reason). Spoke sends route dept to Central Dispatch (cross-dock) to spoke, all three spokes, no exceptions. Department-to-department transfers are recorded nowhere today (3a is first record); spoke sends exist as SupplyNote GRNs (two-sided reconciliation, same pattern as Build 1a).
- **Costs:** existing Petpooja and SupplyNote prices ingested as an unverified baseline, not authoritative.
- **Re-baseline now; from the first real logbook entry, change-only migrations forever.**
- Deferred (later, no schema impact): rename the cake department in SupplyNote; a housekeeping location (interim `is_non_production` category filter in place); the Petpooja category-to-department map; the single spoke convention is decided (dept to dispatch to spoke).
- **Security:** `Suppliers_List.csv` (vendor bank, PAN, GST) kept OUT of the repo; the repo must be private (GRN files carry vendor GSTINs and negotiated prices).

## Step 0: DECIDED (21 July 2026)

**Decision:** At OMS go-live (5 to 14 days), all D2C invoices are punched in OMS only. Petpooja carries no non-Zomato/Swiggy invoice. Petpooja remains the stock ledger at dark stores.

**Mechanics at the four D2C fulfillment dark stores (SPJ, FBD, GN, Meerut):** every D2C fulfillment is punched in Petpooja as a stock movement carrying the OMS order number in the remarks field. Mechanism, pending the admin session: NC (non-chargeable) bill if Petpooja's NC depletes item stock, appears in exports, and carries remarks; otherwise a transfer to a single shared virtual location "D2C Dispatch" (one sink for all stores, current and future; per-store visibility survives on the transfer line itself). Meerut destination created only if the sink route is chosen. Spokes need nothing: they track no inventory, so billing moving to OMS has no stock consequence there.

**Control:** the D2C reconciliation report (Build 1a). Runs manually in Excel from go-live day one (controls team: OMS order export vs Petpooja transfer/NC export, matched by order number, ten minutes daily), automated as the first build. Three exception buckets: punch without order (the leak), order without punch (silent overstatement), quantity/item mismatch. Flag punches whose matched order was later cancelled or refunded. Known limits: unpunched consumption is caught by the physical variance count, not this report; the two controls are complementary layers.

**Console feed:** demand definition at the four stores changes from "sales" to "sales plus D2C punch-outs." Until Build 2, the person compiling the manual feed adds the transfer/NC column by hand from the Petpooja export.

**Remaining Step 0 actions:** (1) the admin session (see `petpooja-admin-checklist.md`), which selects NC vs sink; (2) one-line staff rule briefed to the four stores: no item leaves without a Petpooja punch, and every D2C punch carries the OMS order number; (3) manual reconciliation routine live on go-live day; (4) confirm OMS invoice generation is automatic from the order.

## Build 1a: D2C reconciliation report (deadline: automate within days of go-live)

- OMS side: already in our database. Petpooja side: ingest the daily transfer/NC export (scheduled email preferred, forwarded file acceptable, browser agent fallback).
- Output: morning exception report, three buckets, per store, delivered to Pranjay and controls team.
- This is the first concrete integration between OMS and the new module, and the template for all spine ingestion that follows.

## Build 1: the data spine (read-only ingestion)

Build 1a is the first slice of this and its template; the remainder extends the same pipeline to the full report set.

- Ingest into Supabase, automatically, daily or better:
  - Petpooja: sales by outlet by item by day, closing stock, transfers (CK to Central Dispatch to stores, DS to spoke), wastage entries, vendor "Production" purchase entries.
  - SupplyNote: purchases (GRNs), warehouse-to-kitchen issues, spoke orders for sponges, ganache, packaging, design items.
- Mechanism, in order of preference: scheduled report emails to a dedicated mailbox, parsed on arrival; browser-agent export as fallback. Claude Code enumerates available reports and granularity first (brief section 7).
- Masters mapping layer: outlet master and SKU master mapping Petpooja names, SupplyNote names, and our canonical IDs. This mapping is the first brick of the canonical data model.
- Exit criteria: by 09:00 daily, yesterday's Petpooja sales and closing stock and SupplyNote issues are queryable in Supabase and reconcile to the source reports.

## Build 2: console autofeed (first consumer of the spine)

- Generate the Dispatch Console's daily input from the spine, replacing the manual upload. Include OMS sales per the Step 0 decision.
- Value: implements Pranjay's stated principle, removes a daily manual task, and proves the spine end to end.
- Exit criteria: console runs a full week on generated feed with outputs matching the manual-feed baseline.

## Workstream zero (parallel, human-led): recipes and masters

- Pranjay and Chef Azeem provide existing recipes in current form; structured here into the two-stage BOM (RM to intermediates, RM plus intermediates to FG) with expected yields and standard costs from current purchase rates.
- Canonical SKU and location masters drafted alongside.
- No build depends on this except Build 3 and all costing outputs.

## Build 3a: intermediates logbook (starts NOW, parallel with Build 1)

- Rationale (Pranjay, 21 July): habit formation is the longest-lead-time item in the ERP; start the behavior change early on a narrow, low-burden, high-information flow. Collecting data and acting on data are separated: early data is for visibility and habit, not for questioning anyone.
- Scope: sponges and ganaches only (15 to 25 SKUs, recorded nowhere today, permanently negative in every system). One screen, four actions: batch made (SKU, qty, into freezer), taken out for production, sent to spoke, wasted (reason-coded). Under one minute per entry, phone or cheap tablet, Hindi labels where useful.
- Explicitly excluded at this stage: finished goods logging (already digitally recorded via the vendor-Production jugaad in Petpooja; early duplication would be double entry across 78 SKUs and would burn goodwill). FG logging arrives in 3b and replaces the jugaad, one punch instead of the workaround.
- Conditions: (1) built on the canonical schema from day one (real SKU master, location master, movement records), so later linking is integration, not migration; (2) a declared no-consequences period of about one month, announced to the team; consequences begin only when spine cross-checks exist; (3) a named kitchen-side champion who trains, answers questions, and reviews entries daily in week one. Tools without a floor champion die.
- Standalone value before any linking: first-ever frozen buffer ledger, par vs actual for intermediates, spoke shipment records (later reconciled against SupplyNote orders). The pilot also serves as reconnaissance for designing 3b: where entries get skipped and what confuses people is design input.

## Build 3b: full kitchen logging (after Build 1 and workstream zero)

- FG production vs plan (replacing the vendor-Production jugaad), kitchen and dispatch wastage reason-coded, month-end counts becoming reviewed adjustment events.
- Prerequisites unchanged: spine live (variance computable), recipes normalized (standard cost exists), plus lessons from 3a.

## Build 4: the morning view

- The five numbers from brief section 5, per day, on Pranjay's phone: production vs plan, dispatch COGS at standard, kitchen variance, wastage by stage, frozen buffer vs par.
- Mostly assembly once Builds 1 to 3 and workstream zero exist.

## Phase 2 parking lot (not committed, do not scope yet)

Actual costing, spoke-side consumption for custom cakes, labor productivity from SalaryBox, receiving-side checks on DS-to-spoke transfers, reviewed month-end adjustments replacing silent true-ups, our ledger superseding Petpooja at CK and Central Dispatch, Noida spoke relocation support.

## Division of labor

- This room (Chat): sequencing, freezes, judgment calls, workstream zero structuring, periodic pressure-testing of the map against company reality.
- Claude Code: verification of integration assumptions (brief section 11 prompt), report enumeration, all construction.
- Handoff after freeze: files into `erp-plan/`, then the section 11 prompt verbatim.
