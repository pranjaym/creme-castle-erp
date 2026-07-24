# Integration Notes v0.1

**Status:** For Pranjay's review. Verification pass complete. No build has started.
**Date:** 22 July 2026.
**Purpose:** Answers the brief section 11 handoff. Checks every integration assumption in the kitchen brief (sections 4, 7, 8) and `build-order.md` v0.3 against the actual code and schemas of the two live repos, drafts the canonical masters, and specifies the ingestion architecture. Every claim is tagged with a source. Everything I could not verify is flagged in bold.

**Precedence:** where anything here reads against `build-order.md` v0.3, the build order wins and this note is wrong until corrected.

## 0. What was verified against, and provenance

Both apps are real, live, and were read directly (read-only) at these commits:

| Repo | Path (local sibling of `erp-plan/`) | GitHub | Verified at commit |
|---|---|---|---|
| OMS | `../cremecastle-oms` | github.com/pranjaym/cremecastle-oms | `4cdd99f` 2026-07-22 (working tree had uncommitted changes at read time, see flag F9) |
| Dispatch Console | `../cc-dispatch-console` | github.com/pranjaym/cc-dispatch-console | `a56436c` 2026-07-22 (clean) |

Secondary sources: `OMS_SYSTEM_OVERVIEW.md`, `SYSTEM_OVERVIEW_for_chat.md` (both in `erp-plan/`), `kitchen-production-brief.md` v0.2, `build-order.md` v0.3, `petpooja-admin-checklist.md`, `cc-flow-map-v2.mermaid`, `simple-flow.mermaid`.

Where code and the overview prose disagree, code wins and the disagreement is flagged.

## 1. Repo topology and the consolidation question (build-order Step 2)

**Finding: the OMS and the Dispatch Console are two separate git repositories, with separate GitHub remotes, separate Supabase projects, and (for the console) a separate Railway runner. `erp-plan/` is not a git repository at all today; it is a plain folder sitting beside the two app repos.** None of the three share a repo or a Supabase project.

Evidence:
- OMS Supabase config: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (`cremecastle-oms/.env.example`, consumed in `lib/supabase/server.ts`, `client.ts`, `admin.ts`).
- Console Supabase + runner config: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RUNNER_URL`, `RUNNER_SECRET` (`cc-dispatch-console/app/.env.example`; runner reads its own `SUPABASE_URL` in `runner/db.py:12-13`).
- The console repo itself records the relationship as undecided: "The console and the OMS are separate apps on identical patterns by design. The standing open question (logged, undecided): where do they eventually touch, shared identity, shared outlet master, or never?" (`cc-dispatch-console/docs/SYSTEM_OVERVIEW_for_chat.md:513-515`). A grep of the console for any OMS, Petpooja, Zomato, or Swiggy API client returns nothing: there is no direct link between the two apps today.

**Recommendation (proposed, not executed, per operating principle 4 and Step 2):** consolidate the code into one monorepo, but do not merge the two live Supabase projects on day one. Concretely:

```
cremecastle-erp/                 (new git root; CLAUDE.md here on consolidation)
  erp-plan/                      (canonical planning docs; this folder, moved up)
  apps/
    oms/                         (import of cremecastle-oms, history preserved)
    dispatch-console/            (import of cc-dispatch-console, history preserved)
    kitchen/                     (new: the module build-order describes)
  packages/
    shared/                      (canonical masters, types, the spine schema)
```

Two things to decide, both yours, both flagged rather than assumed:

- **F1 (Supabase topology). RESOLVED 22 July 2026: spine-first, three projects.** OMS and the Dispatch Console stay on their existing live Supabase projects, untouched. The kitchen module gets a **new third "spine" Supabase project**, which becomes the canonical data layer and the shared database through which OMS data reaches the console (the "shared database" that Build 2's autofeed reads from; see section 3). Physically folding OMS and console into one project is a later phase, not a prerequisite. Rationale: lowest risk to ~200,000 live orders, live GST billing, and the console's byte-parity covenant. Build 1 schema work targets the new spine project.
- **F2 (history preservation).** Importing the two repos into the monorepo should preserve git history (subtree or `git filter-repo`), not a flat copy. Mechanism to confirm.

Until you approve the consolidation, this note, `CLAUDE.md`, and all planning docs live in the standalone `erp-plan/` folder.

## 2. Where OMS orders live, and the identifiers (Step 3.1)

### 2.1 Tables and fields (verified against `cremecastle-oms/schema.sql`)

Orders are one row per order in `orders`, one row per cake in `order_items`, with an append-only `order_events` trail. The fields that matter for reconciliation and for the future spine:

- `orders`: `id bigserial pk`, `source` enum (`shopify | whatsapp | b2b`), `shopify_order_id bigint unique`, `shopify_name text` (for example `#171643`), `outlet_id int -> outlets(id)` (null until a human maps a website order), `status` enum (`new|accepted|ready|out_for_delivery|delivered|cancelled`), `delivery_date`, `total_amount`, `discount_amount` (added 21 Jul 2026), `advance_amount`, `customer_mobile`, `area`, `city`, `pincode` (`schema.sql:91-132`, `:839`).
- `order_items`: `order_id`, `sku text` (nullable), `product_title`, `variant_title`, `flavour`, `weight_text`, `quantity`, `unit_price`, `line_total`, `catalog_price` (`schema.sql:134-152`, `:717`).
- `bills`: one row per generated GST invoice, `bill_no text unique` in the form `ND/25-26/000342`, `order_id`, `status` (`active|void`), `total` (`schema.sql:193-234`).

### 2.2 The reconciliation key: what "the OMS order number" actually is

Build 1a and `simple-flow.mermaid` assume staff write "the OMS order number" into a Petpooja remarks field and match it against OMS orders. The human-facing order number is **not** a single field. It is computed:

> "Stable order number for sheets: Shopify name without '#', else `CC-<id>`." (`cremecastle-oms/lib/reports/util.ts:33-35`, and the identical rule in the KOT, bill, and trip-slip print routes, for example `app/day-board/kot/[id]/route.ts:143`.)

So:
- **Website (Shopify) order** shows its Shopify order name with the leading `#` stripped, for example `#171643` becomes **`171643`**.
- **Punched (WhatsApp or B2B) order** has no `shopify_name`, so it shows **`CC-<orders.id>`**, for example `CC-4821`.
- There is also an internal punch code like `W-0722-ND-3` (`app/central/punch-actions.ts:222`), but it is written only into the `order_events` audit data and is never shown on any screen or print. It is not a usable reconciliation key.

**Consequence for Build 1a matching.** The D2C fulfillment stores handle website orders (per `simple-flow.mermaid`: "every website order at SPJ, FBD, GN, Meerut"), so the dominant remark value will be the bare Shopify number. But WhatsApp orders can also be fulfilled at these stores, and those carry `CC-<id>`. **The reconciliation must accept both formats and normalise them the same way the app does: strip a leading `#`, and treat a bare integer and `CC-<integer>` as the two shapes of one key.** The matcher should resolve a remark to an order by: (a) `shopify_name` with or without `#`, then (b) `CC-<id>` to `orders.id`. **F3: confirm with the four stores which number they will physically copy off the OMS screen, since the screen shows the computed number, not `orders.id` directly.**

### 2.3 Outlets, and the Meerut problem (Step 3.1, open question)

The `outlets` seed inserts only four: `('ND','Noida'), ('GGN','Gurgaon'), ('DL','Delhi'), ('GN','Greater Noida')` (`schema.sql:301-302`). The live set is six: code constants carry `ND, GGN, DL, GN, FBD, SPJ` (`components/board/constants.ts:81-88`; punch helpers add FBD "own outlet since 13 Jul" and SPJ, `components/console/punch-helpers.ts:93,96`).

**F4 (governance): FBD and SPJ exist only because someone ran SQL directly against Supabase. There is no migration or seed script that adds them.** The canonical location master (section 4) must fix this so outlets stop being untracked manual inserts.

**F5 (Meerut, top open question): Meerut is not an OMS outlet at all.** It appears only as a day-board city chip colour and a free-typeable city string (`components/board/constants.ts:47-58,90-98`). The punch-form outlet suggester has explicit branches for Gurgaon, Greater Noida, Faridabad, Ghaziabad, Noida, Shahpurjat, and Delhi, and **no branch for Meerut** (`components/console/punch-helpers.ts:88-97`); a Meerut address returns no suggestion. The website-order suggester is purely statistical by pincode and area history (`lib/console-data.ts:89-186`), and team practice documented in prose is that "Faridabad, Meerut, far Delhi are served from Noida" (`cremecastle-oms/docs/OMS_Rebuild_Requirements_v1.md:33`).

This directly contradicts `build-order.md` Step 0, which names Meerut as one of the four D2C fulfillment dark stores (SPJ, FBD, GN, Meerut) with its own delivery boy. **As the code stands, a Meerut website order has no Meerut outlet to be billed against in the OMS, and would be mapped by a human, historically to Noida.** Before Build 1a can reconcile Meerut, one of these must be decided (Pranjay's call):
1. Create a real `Meerut` outlet in the OMS (and route Meerut website orders to it), or
2. Accept that Meerut D2C fulfillment is booked under the Noida (ND) outlet in OMS while the physical punch happens at the Meerut Petpooja store, and make the reconciliation key on the store, not the OMS outlet.

This is the same Meerut mapping the brief flagged (brief section 2 note and section 10.2). It is now confirmed as unresolved in code, and it blocks clean per-store reconciliation for Meerut specifically.

### 2.4 Is OMS invoicing automatic? (build-order Step 0 remaining action 4)

**No. Bill generation is a manual, one-tap action by outlet staff, gated on the order being accepted or KOT-printed, and it is not triggered when an order is marked delivered.** `createBillAction` is an explicit outlet action (`app/day-board/bill-actions.ts:58-80`), fired from a "Generate bill" button (`components/board/BillFlow.tsx:301-307`); the delivered action never touches `bills` (`app/day-board/actions.ts:395-412`).

This is fine for Build 1a, because Build 1a reconciles **orders**, not bills (an order exists the moment it is placed or punched, well before any bill). But the Step 0 assumption "confirm OMS invoice generation is automatic from the order" is **false as written**, and any downstream design that waits for an OMS bill to exist will miss orders that were delivered but not yet billed. Reconcile on `orders`, filtered by `delivery_date` and outlet, and read `status` to catch cancellations and refunds (`orders.status = 'cancelled'`, `bills.status = 'void'`).

### 2.5 The OMS side of Build 1a is already queryable

Build 1a says the OMS side is "already in our database." Confirmed. Two existing exports are close to ready:
- **Orders Export** (admin and finance), one row per cake, columns include `Order number, Order date, Delivery date, Outlet, Status, Cake name, Cake SKU, Qty, Amount, Order total, Order discount, Bill no` (`app/(app)/admin/orders-export/download/route.ts:115-121`). Its "Order number" uses the `CC-<id>` fallback correctly.
- **D2C analysis export** (admin only). **F6: this export's "Order number" column silently blanks for non-Shopify orders (it omits the `CC-<id>` fallback that every other surface uses, `app/(app)/admin/d2c-export/download/route.ts:140`).** Do not reuse it as the reconciliation source without fixing this, or punched orders will look unmatched.

For Build 1a, prefer a purpose-built order-grain query (per outlet, per delivery date, with the normalised order number and status) over reusing the per-cake exports.

## 3. The Dispatch Console feed: exact format and the autofeed target (Step 3.2)

### 3.1 The link is the database, never a direct call

Confirmed: today the feed is uploaded manually by a Planner or Admin. The browser mints a one-time signed URL and uploads the file straight to Supabase Storage (the roughly 7 MB file never transits Vercel) (`cc-dispatch-console/app/src/app/api/runs/upload-url/route.ts:6-9`, `app/src/lib/db.ts:113-118`, `app/src/screens/DailyRun.tsx:190-199`). There is no OMS link in the console codebase. **So Build 2 does not connect the console to the OMS; it generates the same file from the spine database and hands it to the console the same way a human does. The console does not change.** This honours operating principle 6 (the model is never modified; only how the feed is produced changes).

### 3.2 Exact input columns (the target the autofeed must reproduce, byte-plausibly)

Verified against `model/cc_dispatch_v20.py:479-491` (rename logic), the sample export `model/Daily_Inventory_Plan V15.xlsx` (real headers, 52,751 data rows, 6.6 MB), and the duplicate parity logic in `scripts/payloads.py:73-123`.

One row per Date x Outlet x Item, covering at least the 14-day window ending on Day N.

| Source header (exact) | Internal name | Model needs it? |
|---|---|---|
| `Outletname` | `Outlet` | Required |
| `Date` | `Date` | Required (parsed, 2024 to 2030 sanity guard) |
| `Item` | `Item_Name` | Required |
| `Category` | `Category` | Required in practice (`day_n_cols` needs it, `:854`) |
| `Shelf Life (in days)` | `Shelf_Life` | Required (drives the model's own FIFO wastage) |
| `Opening_N` | `Opening_Stock` | Required (stock identity) |
| `Receiving_N` | `Qty_Received` | Required (stock identity; also the M4b actual-shipped source) |
| `Sales_N` | `Sales` | Required (stock identity; drives EMA and P85) |
| `Wastage_N` | `Wastage` | Required (stock identity) |
| `Closing_N` | `Closing_Stock` | Required (stock identity) |
| `Supply_N_Plus_1` | `Supply_NP1` | Optional (absent: warns, uses 0, `:870-871`) |
| `Location Code`, `Unicode` | passthrough, unused | Optional |
| `Cost`, `MRP`, `Cost of Goods Sold`, `Wastage Cost`, `Sales amount` | passthrough | Optional for dispatch, used by the dashboard kit |

Stock identity, exactly as coded (`cc_dispatch_v20.py:494-509`): `Opening_Stock + Qty_Received - Sales - Wastage - Closing_Stock`, a row is bad when the absolute residual exceeds `0.01`, and the run aborts when more than `5%` of rows are bad. The autofeed must satisfy this identity per row or the console will refuse it (by design). Accepted formats: `.xlsx`, `.xlsm`, `.xls`, `.csv` (`:457-472`); the upload UI restricts to `.xlsx` and `.csv`.

**Autofeed acceptance test (Build 2 exit criteria, already stated in build-order):** a generated feed must produce console outputs that match the manual-feed baseline for a full week. The parity harness in the console (`scripts/parity_check.py`) makes this checkable byte-for-byte on `output_dispatch.csv`.

### 3.3 The split-ledger column

The feed already carries `Sales_N` and `Receiving_N` per outlet per item per date. The Step 0 change ("demand becomes sales plus D2C punch-outs") is therefore an adjustment to the `Sales_N` value (or an added component the spine sums into it) for the four D2C stores, not a new column. Note that M4b already reads `Receiving_N` from a later feed to derive actual-shipped (`runner/main.py:160-206`), so the `Receiving_N` semantics must not be disturbed by the split-ledger work.

## 4. Canonical masters, drafted as schema (Step 3.3)

These are the first bricks of the canonical data model (build-order operating principle 4). Build 3a (intermediates logbook) sits on the SKU master and location master from day one. Drafted to hold all naming namespaces at once, because the three systems name things three different ways.

### 4.1 The naming reality these masters must absorb

- **OMS** names outlets by short code: `ND, GGN, DL, GN, FBD, SPJ` (6 D2C dispatch or kitchen points). Items carry a Shopify `sku` (often null) and a `product_title`.
- **Dispatch Console** names outlets `CC-<CityPrefix>-<Locality>` across a 40-store universe (for example `CC-DL-Shahpurjat`, `CC-FBD-Sector 15`, `CC-UP-Meerut`), with city prefixes `CHD, DL, ND, GGN, FBD, GZB, JP, UP=Meerut, MRT=Meerut, LKO` (`model/cc_postprocess_v20.py:154-166`), plus an `outlet_aliases` table (`alias -> outlet`, `migrations/004_outlet_aliases.sql:22-34`) for sheet-vs-feed name drift. Items are 67 canonical names in `item_buckets.csv` (for example `Tiramisu`, `Butter Croissant`, `Red Velvet Cake (500 Gms)`) in categories `Cakes, Cheesecakes, Cookies, Desserts, Hamper`.
- **Petpooja and SupplyNote** names are not yet in hand (pending the admin session). The masters are built to receive them.

**Granularity mismatch (important):** an OMS "outlet" and a console "outlet" are not the same object. OMS `GN` (one Greater Noida dispatch point) has no distinct console prefix (Greater Noida localities like Alpha 2 and Gaur City appear under `CC-ND-*`). OMS `FBD` maps to two console stores (`CC-FBD-Sector 15` and `CC-FBD-Sector 37`). OMS `GGN` (the assembly spoke) is one of six Gurgaon console stores. The location master must let one OMS outlet map to one or more physical dark stores, and vice versa, rather than assuming a 1:1 code match. **F7: for the four D2C stores specifically, confirm the exact Petpooja store name and its console outlet name for SPJ, FBD (which of the two), GN (which console store), and Meerut. Build 1a reconciles per store, so these four rows must be exact.**

### 4.2 Location master (draft DDL, for the spine Supabase project)

```sql
-- Canonical location master. One row per real place in the network.
create type location_type as enum (
  'central_warehouse',   -- SupplyNote RM stock
  'central_kitchen',     -- the conversion node, the module's target
  'central_dispatch',    -- the send/receive accountability node
  'dark_store',          -- Z/S menu FG (Petpooja)
  'assembly_spoke',      -- custom cake assembly (GGN, Janakpuri, Noida)
  'd2c_fulfillment',     -- website fulfillment dark store (SPJ, FBD, GN, Meerut)
  'virtual'              -- e.g. a Petpooja sink like "D2C Dispatch", if chosen
);

create table locations (
  id           bigint generated always as identity primary key,
  code         text unique not null,          -- our canonical code, e.g. 'CK', 'CDIS', 'DS-SPJ'
  name         text not null,
  type         location_type not null,
  city         text,
  region       text,                            -- 'Delhi NCR','Jaipur','Meerut','Chandigarh'
  parent_id    bigint references locations(id), -- co-location (spoke inside a DS/CK)
  active       boolean not null default true,
  lifecycle    text not null default 'active',  -- active | planned | closed | excluded
  notes        text,
  created_at   timestamptz not null default now()
);

-- Every external name for a location, one row per (system, external key).
create type source_system as enum ('oms','petpooja','supplynote','dispatch_console');

create table location_aliases (
  id            bigint generated always as identity primary key,
  location_id   bigint not null references locations(id),
  system        source_system not null,
  external_code text,                  -- e.g. OMS 'SPJ'
  external_name text,                  -- e.g. console 'CC-DL-Shahpurjat', Petpooja store name
  note          text,
  created_at    timestamptz not null default now(),
  unique (system, external_code, external_name)
);
create index idx_location_aliases_lookup on location_aliases(system, external_name);
```

This subsumes the console's `outlet_aliases` (which stays where it is; the model is never touched) and gives every other tool one place to resolve a store name. The console keeps using its own `outlet_aliases` for parity; the spine mirrors those mappings here.

### 4.3 SKU master (draft DDL, carries RM, intermediates, and FG from day one)

```sql
create type sku_type as enum (
  'raw_material',   -- SupplyNote domain
  'intermediate',   -- sponges, ganaches: Build 3a lives here
  'finished_good',  -- the 78 Z/S SKUs and the D2C cakes
  'packaging',
  'design_item'
);

create table skus (
  id             bigint generated always as identity primary key,
  code           text unique not null,          -- canonical, our own
  name           text not null,
  sku_type       sku_type not null,
  category       text,                            -- 'Cakes','Cheesecakes','Sponge','Ganache',...
  uom            text not null default 'unit',    -- 'unit','kg','g','litre'
  shelf_life_days int,                            -- for FG/intermediates
  lifecycle      text not null default 'active',  -- drop | graduated | retired | active
  active         boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now()
);

create table sku_aliases (
  id            bigint generated always as identity primary key,
  sku_id        bigint not null references skus(id),
  system        source_system not null,
  external_code text,                  -- OMS order_items.sku, Petpooja item code, SupplyNote code
  external_name text,                  -- OMS product_title, Petpooja/Console Item name
  note          text,
  created_at    timestamptz not null default now(),
  unique (system, external_code, external_name)
);
create index idx_sku_aliases_lookup on sku_aliases(system, external_name);
```

Notes tying this to the builds:
- Build 3a needs only `sku_type = 'intermediate'` rows (the 15 to 25 sponges and ganaches) plus the location master. It can start the moment these two tables exist and are seeded with intermediates and the kitchen and freezer and spoke locations. No recipe or costing is required for 3a (habit and visibility only).
- The `lifecycle` fields (drop, graduated, retired) come straight from brief section 6.1.
- **F8: item identity between OMS `order_items` and Petpooja punch lines will not join on `sku` (OMS SKUs are Shopify-sourced and often null; Petpooja uses its own item names).** For Build 1a's "quantity or item mismatch" bucket, item matching must go through `sku_aliases` (OMS name to canonical to Petpooja name), or, more cheaply for the first cut, reconcile at order-total and per-order line-count level and defer strict per-item matching until the SKU alias map for the four D2C stores is seeded.

## 5. Ingestion architecture (Step 3.4), with placeholders for the pending admin session

Preference order is fixed by brief section 7 and build-order Build 1: scheduled report email to a dedicated mailbox, parsed on arrival; browser agent as fallback. Neither Petpooja nor SupplyNote is assumed to have an API (brief section 4 states Petpooja has none, confirmed by Pranjay; SupplyNote unknown).

Proposed shape (spine Supabase project):

```
mailbox (dedicated) --> email-parser (Vercel Cron or a small worker)
                          |  attach raw file to Supabase Storage (raw, immutable)
                          |  parse into staging tables, one per report type
                          v
   staging.petpooja_sales / _closing_stock / _transfers / _wastage / _production_purchases
   staging.supplynote_grn / _issues / _spoke_orders / _wh_stock
                          |  resolve names via location_aliases + sku_aliases
                          v
   canonical movement + fact tables (the spine)   -->  Build 1a report, Build 2 feed
```

Design rules carried from both apps (they are shared covenants, not new):
- Raw file snapshot to Storage before parsing, immutable (OMS `webhook_events`, console config snapshot pattern).
- Idempotent ingestion keyed on a natural report key plus report date, so re-parsing the same email is harmless (OMS golden rule 12).
- No hard deletes; a re-sent report supersedes, it does not overwrite (console `plan_additions` supersede pattern).
- AI never load-bearing: parsing is deterministic (column-mapped), a parse that cannot be trusted fails loud and a human is told, exactly as the console aborts on a bad feed.

**Placeholders, resolved by `petpooja-admin-checklist.md` (all currently pending):**
- **P-A (punch mechanism).** NC bill vs transfer-to-sink is undecided (checklist Part A, decision rule: NC only if stock reduces, appears in export, and carries remarks; else a virtual "D2C Dispatch" sink). This changes which Petpooja export Build 1a ingests (item-wise sales or order export with an NC marker, vs the transfer report) and whether a Meerut Petpooja destination must be created. **Build 1a's Petpooja-side parser must stay switchable between these two shapes until Part A is answered.**
- **P-B (report automation, Petpooja).** Whether Petpooja can schedule report emails, for which reports, at what granularity and format, is unknown (checklist Part B). If it cannot, the exact manual export click-path is needed for the browser-agent fallback. Reports needed daily, item-wise and outlet-wise: sales by outlet by item by day, closing stock, transfers, wastage, and the vendor "Production" purchase entries.
- **P-C (report automation, SupplyNote).** Same unknowns for GRNs, warehouse-to-kitchen issues, spoke orders (sponge, ganache, packaging, design), and warehouse stock (checklist Part C).
- **P-D (today's feed source).** Who compiles the console feed today and from exactly which reports is unconfirmed (checklist Part D). This is the direct blueprint for Build 2 and should be captured with one day's real example files before Build 2 starts.

Until P-A through P-D land, the ingestion parsers are specified against the column names above but not wired to specific Petpooja or SupplyNote export layouts.

## 6. Corrections to the planning docs (write-backs owed)

Per the same-day write-back rule, these should be reflected in the source docs once Pranjay confirms:
1. `build-order.md` Step 0 remaining action 4: OMS invoicing is **manual (one-tap), not automatic**. Reconcile on orders, not bills (section 2.4 above).
2. `kitchen-production-brief.md` section 2 and section 10.2, and `build-order.md` Step 0: **Meerut is not an OMS outlet**; decide create-outlet vs book-under-Noida before Build 1a covers Meerut (section 2.3, F5).
3. The reconciliation key is a **computed** order number with two shapes (`171643` and `CC-<id>`), not a single field; the matcher must handle both (section 2.2, F3).
4. OMS outlets FBD and SPJ are **untracked manual DB inserts**; the canonical location master should become the tracked source (F4).
5. **(23 July 2026, correction to the memory line and to build-plans-1a-3a.md)** The Material Purchase Report parser was described as "confirmed and wired, verified on a real 75-row sample." That overstates it. The 75-row sample (`data-samples/Material_Purchase_Report_...07_39_47.xls`) is **Central Dispatch Noida's own purchase report**: `Supplier/Kitchen/Rest name` = Central Kitchen-Noida (an internal source), and its `Invoice Number` column carries **Petpooja's auto-generated transfer-document numbers** (`CT24251140..145`), not OMS order numbers (which are bare `171643` or `CC-<id>`). The second sample (Central Kitchen-Noida) has `Invoice Number` entirely blank. So: the parser is **structurally correct and robust** (parses the HTML-as-xls title block, day-stamps every row, extracts the key), but it has **not** been proven against real vendor-OMS D2C punch data, because that data does not exist yet. Real Build 1a reconciliation volume is **gated on OMS billing go-live** (the vendor-OMS transfer flow, where the team hand-types the OMS order number into the invoice-number field). Until then the matcher runs on synthetic fixtures only. This is a business milestone, not a code gap. See F13.

## 7. Flag register (everything not fully verified)

| Flag | What is unresolved | Blocks |
|---|---|---|
| F1 | RESOLVED 22 Jul 2026: spine-first, 3 projects. Build 1 targets a new spine Supabase project; live OMS and console projects untouched | Cleared |
| F2 | Monorepo import must preserve git history | Consolidation execution |
| F3 | Which exact number the four stores copy into Petpooja remarks | Build 1a matcher |
| F4 | OMS FBD, SPJ added by untracked manual SQL | Location master seeding |
| F5 | Meerut has no OMS outlet; contradicts Step 0 roster | Build 1a for Meerut |
| F6 | D2C export blanks order number for punched orders | Only if that export is reused |
| F7 | RESOLVED 23 Jul 2026 (read from the live Petpooja outlet picker): SPJ = `CC-DL-Shahpurjat`, FBD = `CC-FBD-Sector 15`, GN = `CC-ND-Alpha 2`, Meerut = `CC-UP-Meerut`. Central Kitchen = `Central Kitchen-Noida`. These are the `location_aliases` external_name values (system='petpooja') to seed at go-live. Console name still to confirm separately. | Cleared for Petpooja side |
| F8 | OMS and Petpooja items will not join on SKU; need alias map | Build 1a item-level bucket |
| F9 | OMS read at a commit with uncommitted working-tree changes; live DB not queried (no creds, correctly) | Minor: re-verify on a clean commit before Build 1a code |
| P-A..P-D | Petpooja and SupplyNote admin answers pending | Ingestion wiring, punch mechanism |
| F13 | Vendor-OMS D2C punch data does not exist until OMS billing go-live; the Material Purchase Report parser is verified structurally but not against real punches. Real 1a recon volume starts at go-live. | Build 1a real reconciliation (not the code, the data) |

## 8. What is ready, and what to decide next

Ready to design against (verified): the OMS order and item schema, the reconciliation key rule, the console feed format down to column names and the abort thresholds, the canonical master shapes, and the ingestion skeleton.

Decisions owed by Pranjay before any build starts (in priority order): F5 (Meerut), F7 (the four store name mappings), then the admin session answers P-A through P-D. F1 (Supabase topology) is resolved: spine-first, three projects, Build 1 targets a new spine project.

Per the handoff rule, no build plan is proposed until this note is reviewed. Once reviewed, the next step is the two parallel first builds only: Build 1a (D2C reconciliation) and Build 3a (intermediates logbook).

---

## 9. Existing Petpooja pipeline and spotcheck package (added 22 July 2026, from Pranjay)

Rishabh's live pipeline (`petpooja_pipeline.py`, 748 lines) and the `cc_spotcheck` package were shared. They are real, running assets and change Build 1a's effort estimate downward. Read against the plan:

### 9.1 SECURITY, act before anything else (F10, blocking for repo push)
`petpooja_pipeline.py` contains hardcoded live secrets: Petpooja portal password, a Gmail 16-char app password, a Google service-account reference, and staff emails. **These must be rotated (Petpooja password, Gmail app password, Google service-account key) and moved to environment variables / a secrets manager BEFORE this code enters any git repo.** Never commit the current file as-is; git history would retain the secrets permanently. First hygiene task on consolidation.

### 9.2 What the pipeline already provides (reuse, do not rebuild)
- **Proven Petpooja extraction with no API:** Playwright login with a saved session (`petpooja_session.json`), interactive OTP on first run, session reused and optionally fetched from Drive. Retry-wrapped (3 attempts), Cloud Run capable (headless, `/tmp`, SMTP 587).
- **Two reports already scraped:** Online Orders (`online_orders_report_all`, deduped by Aggregator Order No., status updated in place) and Item-Wise Order Summary (`order_summary_item`, date-ranged server export). These substantially cover Build 1a's Petpooja side and the console feed's sales component.
- **A hand-maintained `glossary` tab** (item aliases, categories, outlet type/city/code): this is a working prototype of the spine's `sku_aliases` + `location_aliases`. MIGRATE it into the canonical alias tables; do not maintain both. The glossary is the seed data for those tables.
- **`cc_spotcheck` metrics layer** with vetted definitions to preserve: Net Sales = My amount + Container - (Outlet Disc + Agg Disc); AOV; outlet/total discount %; platform normalisation ("Toing by Swiggy" -> Swiggy); city mapping from outlet code; cancelled-order exclusion; festival OUTLIER_DATES excluded from same-DOW baselines; Lucknow hidden from display but kept in baselines. These encode institutional knowledge and should be lifted into the spine's metrics, not reinvented.

### 9.3 The one change to the pipeline (per Pranjay's direction)
Redirect the final step from Google Sheets to the Supabase spine (direct DB write, no email scheduling, no sheet as system of record). Keep the raw downloaded file as an immutable receipt before parsing (section 5 rule). Everything upstream (login, scrape, retry, dedup, enrichment) stays as built. Google Sheets is dropped as the destination; it was only ever an example that a scheduled download works.

### 9.4 New flags
- **F10 (security):** hardcoded live secrets in `petpooja_pipeline.py`. Rotate + externalise before repo push. BLOCKING.
- **F11 (business-day convention conflict):** pipeline uses a 04:00 IST day boundary (`Final Date` minus 4h); `cc_spotcheck/config.py` uses `BUSINESS_DAY_START_HOUR = 7`. Confirm the two are serving different purposes (day attribution vs intraday dashboard window) and declare one canonical day-boundary rule for the spine, so downstream reports cannot silently disagree. Pranjay to confirm the canonical rule.
- **F12 (glossary vs alias tables):** two name-mapping systems (the Sheets `glossary` tab and the spine alias tables) must converge on the spine as canonical, with the glossary migrated in, or mappings will drift.

### 9.5 Revised Build 1a effort
Build 1a's Petpooja side is largely running already (item-wise + online-orders scrape). Genuinely new work: (1) repoint scrape output to the spine, (2) reconcile OMS orders against the Petpooja vendor-OMS punch-outs by the order number in the invoice-number field, (3) the three-bucket exception report. The extraction, the hard part, is done.
