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

6. **(29 July 2026, corrects a verified fact about the daily dashboard.)** Two defects were found and fixed after Pranjay noticed that an order export for 27 July stopped at midnight instead of carrying the 28th 00:00 to 02:00 orders.

   **(a) The order report was always one day behind on its post-midnight tail.** The daily pull runs with Petpooja's `server_type=2` ("Get old records"), whose history stops at the previous midnight, so an 8am run never saw the 00:00 to 03:59 orders that belong to the business day it is reporting on. Verified live on 29 July: business day 27 held 3,473 order rows ending `23:59:53` at 07:30, and only reached its true 3,797 rows ending `01:59:46` after that morning's run swept them up, a full day late. The item report never had this defect, it honours a real date range. Fixed by a second, best-effort export under `server_type=1` with **no date range**: tested live, setting a date on that scope makes the DateTimePicker clamp silently back to yesterday and return the wrong day, while leaving it alone returns today (371 rows, `00:00:05` to `08:45:27`, all 316 tail rows present). A failure of that second pull costs freshness only, since the tail still self-heals a day later.

   **(b) The dashboard mixed two day definitions in a single row.** Orders were stamped with the plain calendar date (`loaders.py`) while items used a 07:00 rule (`enrich.py`), so Orders, Net Revenue and AOV covered a different 24 hours from the Cake Qty and Cake Revenue printed beside them, and neither matched the spine's 04:00 business day used by the portal exports. Both now use the canonical 04:00 rule, so the dashboard, the spine and the ERP portal mean the same thing by "27 July". This retires the note in `enrich.py` that the two tools used different conventions on purpose.

   The 07:00 to 04:00 move is **inert on the numbers**: 0 differing rows on a real 4,919-row export, and across 1 April to 27 July the 03:00 to 07:00 window holds 1 order in 333,905 and 0 item lines, because the outlets are shut. The calendar-day to business-day move is **not** inert: it reassigns roughly 330 orders per night in each direction (net -4% on orders for 26 July, near zero for 28 July, depending on how the two nights compare).

   **The two fixes are coupled and must never ship apart.** The day rule without the tail would have understated the focal day by 8.8% (business day 28 read 3,312 delivered orders instead of 3,621). The old calendar rule was masking the missing tail by using a complete but wrong window.

   Verified end to end before shipping: business day 28 goes from 3,312 delivered orders / Rs 14,68,787 ending `23:58:58` to 3,621 / Rs 15,83,470 ending `01:59:48`. Dark-outlet detection now runs on the real 7am to 2am night rather than a calendar day (19 signals to 16, all four criticals surviving). Commit `4f43780`. The 28 July dashboard in the portal archive was rebuilt and replaced the same day.

7. **(29 July 2026, DONE the same day.)** The ERP portal's reports page told the user "Customer names and phone numbers are never included", which contradicted the decision of 24 July 2026 and the actual column list in `portal/lib/reports.ts` (the order report exports `customer_name` and `customer_phone`, the item report adds `customer_address`). People were downloading personal data on the strength of a promise that it was absent. Replaced with an explicit warning, styled `.hint.warn` rather than the same muted grey as ordinary help text. Commit `ae77ecb`. Keep that warning in step with the columns in `lib/reports.ts` if the exports ever change.

   Also on 29 July, the portal's archived dashboards for 24 to 28 July were rebuilt with the corrected 04:00 rule and re-uploaded, so every day in the `dashboard-html` bucket is now on one definition. The versions already sitting in people's inboxes were built the old way and will not tie out to the archive.

8. **(30 July 2026, corrects a stated guarantee about the 8am scheduler. DONE the same day.)** Pranjay reported that the 8am dashboard email did not arrive. It had not been sent: the run failed and reported success.

   **What happened.** The lid was shut at 07:45:54 (pmset: "Clamshell Sleep"), and at 07:58:43 the Mac entered a sleep block scheduled for 3584 seconds. So the Mac was asleep at 08:00 and launchd deferred the job. launchd grants a missed `StartCalendarInterval` exactly **one** catch-up firing, on the next wake of **any** kind, and it spent that firing at 08:58:27 (07:58:43 plus 3584s, a maintenance dark wake, lid still shut, on battery). Wi-Fi was not associated: `git` failed with `ssh: connect to host github.com port 22: Undefined error: 0`, Supabase failed with `Failed to resolve 'naocaekyszvmnfgcaufw.supabase.co' ([Errno 8] nodename nor servname provided)`, and the Playwright scrape failed twice with `net::ERR_INTERNET_DISCONNECTED`. The run died in seconds with exit 1.

   **Why nothing retried.** The plist carried a single 08:00 slot and no `KeepAlive`, so once that one firing was spent the interval was serviced for the day. `run.log` proves it: between the 08:58 failure and a manual run at 13:44 there is not one further entry, despite fully networked wakes at 11:12:52, 11:32:20 and later. Reconnecting the laptop did **not** trigger a retry.

   **Why it was silent.** The old `run_dashboard.sh` ended with `echo "----- exit $? -----"`, so the script's own exit status was the `echo`'s, always 0. `launchctl list` reported status 0 for a failed morning. There was no email and no failure signal either, so the only symptom was an absence.

   **Corrects an earlier statement.** Pranjay had been told that if the Mac were asleep at 8am the job would run "when you next connect to the internet". That was wrong in a way that mattered: launchd retries once, at the next wake, connected or not, and since a closed-lid Mac dark-wakes every few minutes the catch-up firing will nearly always land on a wake with no network. The failure mode was reliable, not rare; 26 to 29 July only worked because the Mac happened to be awake at 08:00:01 to 08:00:05 on each of those mornings.

   **Fixed** in `dashboard/auto/run_dashboard.sh` plus `in.cremecastle.dashboard.plist`, with four defences (success stamp, single-run lock, network gate, honest exit code plus a once-a-day failure alert to the owner) and eight retry slots from 08:00 to 14:00. Full rationale in `dashboard/auto/README.md`, section "8am automation". New file `dashboard/auto/alert_failure.py`. Each defence was tested: the no-network path defers with exit 75 without writing the stamp; a live lock holder, a recent pid-less lock and a stale pid-less lock all behave correctly; a failing run propagates exit 1 and leaves the stamp unwritten so later slots retry.

   **Note on the recovery.** The 2026-07-29 dashboard was rebuilt and emailed at 13:47, about six hours late. Then a faulty test harness (a misplaced `&` that backgrounded a compound command, so the lock's pid file was never written) drove a second full run at 14:00, and all three recipients received a duplicate 2026-07-29 dashboard at about 14:02. No data harm: the spine reported 7 days confirmed unchanged and 0 new sub-order rows. That accident is what prompted defence 2's stricter rule, where a pid-less lock is reclaimed only when over 30 minutes old and the slot otherwise stands down.

   **This whole class of failure disappears on an always-on host**, but that host cannot be a cloud server, and the first version of this entry (and of the README) wrongly said it could. Petpooja blocks datacenter IPs: confirmed by identical scraper failures from Google Cloud Run (Mumbai) and an Oracle Cloud VM while the same saved login worked from a residential connection at the same moment (`HANDOFF.md`, "The single most important operational finding"; corrected here 30 July 2026 after Pranjay caught the contradiction). The real fix is an always-on machine on a trusted office or home IP, or Petpooja API/report access (pending admin questions) that removes the scrape entirely. The defences above make a laptop schedule survivable; they do not make it correct. See F14.

9. **(31 July 2026, a SECOND scheduler failure the 30 July fix did not cover. Mitigated the same day.)** The email was missed again, and the cause was one layer deeper than 30 July.

   **What happened.** The 07:58 pmset wake fired, but on **battery with the lid shut** it was only a *dark wake*: 45 seconds awake (pmset: `DarkWake ... rtc/`), then straight back to sleep for 51 minutes, so the 08:00, 08:20 and 08:45 slots were all deferred (Mac asleep). At 08:49:57 a maintenance dark wake ran the coalesced job. The network gate (30 July defence 3) waited, Wi-Fi associated, and the scrape **succeeded**: orders and items both pulled. Then about 90 seconds in, at 08:50:42, the Mac began returning to sleep (a dark wake is meant to last seconds) and tore the network down mid-run: `spine sync FAILED: could not receive data from server: No route to host`, then `sub_order_wise ... net::ERR_INTERNET_DISCONNECTED`. Exit 1 partway through. The failure alert (defence 4) then also failed, because DNS was already gone by the time it tried to send (a `socket.gaierror` traceback in `run.log`), so no alert went out and `.last_alert` was left unwritten.

   **Why the 30 July fix did not catch it.** Every 30 July defence worked as designed. The network gate correctly waited and passed. The stamp was correctly not written, so later slots were still eligible. The gap is that the gate guards only the **start** of a run; nothing held the machine awake **through** the multi-minute scrape/build. The 09:15 and 10:00 slots did not recover it because the Mac was asleep at both (back-to-sleep after the 08:49 dark wake); recovery finally came at the 11:00 slot, which Pranjay's session kept awake, delivering the 2026-07-30 dashboard at 11:0x, about three hours late.

   **Mitigation (defence 5).** The instant the network gate passes, `run_dashboard.sh` now takes a `caffeinate -imsw $$` power assertion, held until the script exits (`-w` ties it to the run's pid, and the EXIT trap kills it belt-and-braces). Verified that this registers a live `PreventUserIdleSystemSleep` assertion with `powerd` (the assertion honored on **battery**, which is the case that failed) and releases the moment the run ends. Placed after the gate on purpose, so a genuine no-network morning still defers without holding a closed, unplugged laptop awake for nothing across eight slots.

   **Honest limit.** This is a mitigation, not a cure. Holding a dark wake open with an assertion is exactly what macOS resists on battery, and no software setting fully overrides it. The two real levers are outside the script: keep the Mac **plugged in** overnight (on AC, dark wakes stay alive and the network holds; the 31 July failure was entirely on battery), and move the job to an always-on trusted-IP machine (the "attach other PCs later" plan). Until then, AC power is the single highest-value habit. Still F14.

10. **(1 to 4 August 2026, the spine outage week: two separate causes, both closed. RESOLVED 4 August.)** Spine loads failed on four consecutive mornings while the dashboard email kept delivering. Two distinct causes, easily conflated:

    **(a) 1 to 2 August, DNS (F15).** The direct `db.<ref>.supabase.co` host is IPv6-only and does not resolve on this network, so `SPINE_DATABASE_URL` was switched to the ap-south-1 pooler on 2 August (commit `6e0c717`, which also added the spine failure alert and the sub-order lookback). That fix held; the pooler resolves fine.

    **(b) 3 to 4 August, capacity.** New errors through the pooler: Storage `544 DatabaseTimeout` and `429` on 3 August, then `FATAL: (EAUTHQUERY) authentication query failed: connection to database not available` on 4 August. Diagnosed live on the morning of 4 August: the spine project (Micro compute) was effectively unusable in roughly the 07:30 to 09:30 IST window (a connection took 41 seconds, a trivial per-day count hit a 45 second statement timeout twice) and instantly healthy outside it (0.06 second queries minutes earlier). Root cause: the January-2025 backfill grew the database roughly tenfold (1.9 GB, items 1.65M rows and 1 GB, orders 1.1M rows), and the Micro instance could no longer absorb the early-UTC maintenance window plus the 8am run's verify load. **Pranjay upgraded the spine to Small compute on 4 August ~08:50 IST.** Verified immediately after: connect 0.45s, the same count query 0.47s.

    **Recovery, same morning.** The alert mail's own procedure (`run_daily.py --allow-unmapped --no-email`) reloaded everything: items for 3 August went 69 to 4,749 rows (source=spine verified), sub-orders for 2 and 3 August loaded (134 and 126 rows) via the lookback, and the verify also caught 576 Petpooja amendments on 2 August (106 material). The portal archive HTML for 2 and 3 August, the one artefact that does not self-heal, was re-uploaded by hand; the `dashboard-html` bucket is gapless through 3 August.

    **Watch item.** If the morning-window alerts return despite Small compute, the next lever is moving the spine steps off the 8am peak or adding a delayed retry, not more compute. The alert plumbing (spine failure mail to the owner) is working exactly as designed; it is what surfaced all of this.

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
| F15 | Spine reachability from the Mac and spine capacity. DNS half RESOLVED 2 Aug (direct db host is IPv6-only; use the ap-south-1 pooler). Capacity half RESOLVED 4 Aug (Micro compute could not carry the post-backfill 1.9 GB database through the 07:30 to 09:30 IST maintenance window; upgraded to Small, verified 0.45s connects). Watch the next few mornings; if 544/EAUTHQUERY alerts return, shift the spine steps off the 8am peak rather than buying more compute. | Nothing while quiet; spine morning loads if it recurs |
| F14 | The 8am dashboard runs on a **laptop** via launchd, so delivery depends on the Mac being awake, online AND staying awake long enough to finish. Hardened 30 July (stamp, lock, network gate, honest exit code, failure alert, eight slots to 14:00) and 31 July (a `caffeinate` hold so a dark wake cannot sleep mid-run, after the 30 July fix let a run start then die when the Mac slept 90s in). Battery is the throughline of both failures: on battery + closed lid, macOS gives only brief dark wakes and tears down the network, and no software setting fully overrides that. Mitigated, not cured. AC power overnight is the highest-value interim habit. Exit path is NOT a cloud server (Petpooja blocks datacenter IPs, confirmed from Cloud Run Mumbai and an Oracle VM, see HANDOFF.md): an always-on machine on a trusted office/home IP, or Petpooja API/report access (P-A..P-D) that removes the scrape. | Nothing today; the daily email's reliability ceiling until the run moves to an always-on trusted-IP machine |
| F16 | REVISED 4 Aug (Pranjay's diagnosis, verified): Zomato export failures are DATA LAG, not service flakiness. Yesterday's data fails ("Download failed" after minutes of churn; still not ready 13:30 IST) while an older day (30 Jul) exported in under a minute first try. Pull runs evenings for yesterday (18:00/20:00/22:00 retries); readiness boundary to be located from the slot logs. See `zomato-order-details-feed.md` sections 4 and 6. | Zomato daily pull schedule and its trust level |
| F17 | RESOLVED 4 Aug: Customer details export = same 30 columns, filtered to orders with the customer's real phone number (July = 1,158 rows vs 2,368 on 30 Jul alone; all rows phone-filled; filename misleadingly says `order_history_...`). Same table, upgrades hashed identity to real phone; bridge to a future customer master via OMS `customer_mobile`. | Cleared |
| F18 | Join between Zomato Order ID and the spine item report's order number for Zomato orders is expected but not yet verified against the spine. | The order-level overlay joining item-level history |
| F19 | Zomato KPT duration values differ wholesale between export runs for the same orders (2,328 of 2,368 rows in the 30 Jul parity check; earlier run more plausible). Both runs were same-day pulls of a 5-day-old day, so this is not just T-1 settling (Pranjay reports T-1 KPT is often wrong too); the two runs differed in export SHAPE (7-month range vs single-day), so KPT may be shape-dependent. Daily job therefore always uses one shape (the 7-day range export). Parity is otherwise exact: identical order sets, paisa-identical totals, diffs only in late-mutating fields (statuses, ratings, reviews, complaints, phones) and item-string ordering. Store KPT as-received with revision history; trust a value only when identical across two consecutive pulls; verify by re-pulling 30 Jul both shapes after a few days. | Kitchen-ops KPIs from Zomato data |

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

---

## 10. Zomato Order Details export (added 4 August 2026, verified live with Pranjay)

A new order-level dataset from the Zomato partner dashboard, landed as the spine table `landing.zomato_order_details`: customer identity (hashed, plus real phones from the Customer details export), ratings, reviews, complaints, kitchen prep and rider wait times, rejection economics, discount anatomy, subzone and distance. Fact-finding was done live on the dashboard on 4 August; `zomato-order-details-feed.md` is the authoritative doc for this feed. Flags: F16 (data lag, evening schedule), F17 (RESOLVED: customer export = real-phone subset), F18 (join to item report unverified), F19 (KPT unstable across export shapes).

**Built and proven end to end, 4 August 2026 on Pranjay's go**, as an explicit exception to the "only Builds 1a and 3a" rule (his direct instruction): migration `kitchen/migrations/060_zomato_order_details.sql` applied to the spine (supersede lineage, change log, portal view, 'zomato' added to source_system); worker `kitchen/workers/zomato-ingest/` (Playwright scraper with one-time headed bootstrap and Storage-kept session, zip/csv/xlsx parser, supersede loader whose row_hash excludes KPT and canonicalises item order); launchd agent `in.cremecastle.zomato` (18:00/18:20/20:00/22:00, defer-on-data-lag contract, exit 75) plus a D-2 catch-up inside the 8 am run. Backfill: the 7-month manual export (304,991 orders, 1 Jan to 2 Aug). Final live verification (runs 138/139): the production-shape 7-day window 27 Jul to 2 Aug, both exports downloaded and loaded, 19,431 orders, 6,344 late mutations superseded, 0 lineage orphans.

Findings from the live runs, recorded in `zomato-order-details-feed.md` sections 4d and 6, several of which changed earlier assumptions:
1. **The scraper runs FIREFOX HEADLESS: no window appears** (matching the Petpooja worker's behaviour, which is what Pranjay asked for). Zomato refuses Chrome-family headless in under a second, and a visible window could not be hidden on macOS (position is clamped, AppleScript cannot minimise it), so the fix was the engine, not concealment: Firefox headless is served normally, WebKit too. Only the one-time login bootstrap is headed. Both exports now share ONE browser session.
2. **Readiness boundary measured: yesterday is not available at 13:30 IST but is complete by 17:47** (a 17:47 production run pulled 3 Aug in full, 2,219 orders, matching the normal weekday pattern). The 18:00 slot is correctly placed.
3. **The daily window is 3 days (Pranjay's call), with a 10-day sweep every Monday.** Three measurements: run 138 suggested days 3 to 8 still changed ~20% each, but it compared CSV pulls against the xlsx backfill; run 140 (first same-shape comparison) found zero changes on days 2 to 7; run 146 re-read 10 days and found 1,023 changes of which every single one fell on the two days still holding xlsx-backfill rows, with zero on all eight days already pulled in CSV shape. So export-shape noise explains all apparent late mutation observed so far (same family as F19/KPT). The Monday sweep and the change log remain as guards, because no comparison yet spans 24 hours and ratings/complaints/refunds do arrive over days.
4. **HARD PLATFORM LIMIT: 10 days per export** when more than 10 outlets are mapped (we have 45). Zomato refuses longer ranges with "date range exceeding 10 days" and never starts the export, which reads as a timeout. Windows are clamped in code and the message is now detected explicitly. Wider pulls must be walked in chunks; the 7-month manual export is not reproducible through this page at that size.
