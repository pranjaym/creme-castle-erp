# Spine schema v2 proposal (for approval)

> **RETIRED PATH, 18 August 2026.** This document is the historical record of the 23 July 2026 schema v2 decision and is kept for that reason. Its recommendation to re-baseline by re-running `ALL.sql` is **no longer valid and must not be acted on.** That file has been renamed to `kitchen/migrations/OBSOLETE_DO_NOT_RUN_rebaseline_2026-07-23.sql.txt`; it opens with `drop schema if exists landing cascade` and would delete every ingested row and the core, identity and mart layers with it. Schema changes now go through numbered ALTER migrations only.


**Home:** `erp-plan/schema-v2-proposal.md`. Reflects `data-findings-2026-07-23.md` points 1 to 4.
**Status:** APPROVED and BUILT 23 July 2026. Applied via re-baseline (`cremecastle-kitchen/migrations/ALL.sql`). **Date:** 23 July 2026.

**Decisions locked (Pranjay, 23 July 2026):**
1. **Re-baseline now** (wipe and recreate, no data exists). **From the sponge team's first real entry, switch permanently to change-only ALTER migrations and never re-baseline again.**
2. **Movement model: three verbs, `made`, `issued` (with destination), `wasted` (with reason).** Destinations come from the location master, so adding a department or spoke later needs no code change. Spoke sends are `issued` to a spoke, routed dept to Central Dispatch (cross-dock) to spoke, applied to all three spokes with no exceptions.
3. **Cake-department rename deferred**, made cheap by aliases: renaming "Central Kitchen Noida" to "ND-CK-Cake Dept" later is just another alias on the same canonical location, no data migration. Meanwhile a `category_map.is_non_production` filter excludes maintenance, housekeeping, utensils, and printing stationery from cake-department consumption, removed once a housekeeping location exists.
4. **Central Dispatch holds product** (fresh cake 7 to 8 hours, longer for stable items) and cross-docks intermediates onto the spoke vehicle, so it needs no frozen storage for this. Freezer capacity at dispatch is a separate operational question, not a schema question.


**Context.** Phase 1 applied schema v1 to the spine. This v2 folds in the SupplyNote and Petpooja findings. Because the pilot has no real data yet (46 intermediates seeded, zero `production_log` rows), the cleanest path is a **clean re-baseline**: re-run an updated `ALL.sql` that drops and recreates, re-seeding from the corrected data. No data is lost. Alternative (ALTER migrations) is available if you prefer, but re-baseline is simpler while nothing is live. Decision needed (see end).

Design rules carried from the findings: **Outlet Code is not a key** (it repeats: `ND-CK` twice), so our canonical `code` stays ours and every source code lives in an alias. **The `active` flag is unmaintained** in both systems, so we never filter on it; liveness is derived from transaction recency. **Never write back to source**; all hygiene lives in our mapping layer.

---

## 1. Locations (revised)

Add a department type; model the three kitchen departments as real locations under the central kitchen; alias every source spelling to one canonical row.

```sql
-- add to the location_type enum
--   'kitchen_department'  the three CK departments (sponge, dessert, cake)
--   'housekeeping'        non-production consumables sink (keeps maintenance out of cake dept cost)
alter type location_type add value if not exists 'kitchen_department';
alter type location_type add value if not exists 'housekeeping';

-- locations: derive liveness, do not trust the source active flag
alter table locations add column if not exists last_txn_on date;  -- set by ingestion; liveness = recency
comment on column locations.active is
  'Source active flag is unmaintained (all rows true, incl. closed Lucknow). DO NOT filter on it. Use last_txn_on.';
```

Canonical seed (display name is the true role; the SupplyNote string is an alias, so nobody has to remember that "Bread" means sponge):

| canonical code | display name | type | SupplyNote alias (external_name) | source Outlet Code (alias only) |
|---|---|---|---|---|
| CK-SPONGE | Sponge and Ganache Dept | kitchen_department | ND-CK-Bread Dept | ND-CK |
| CK-DESSERT | Dessert Dept | kitchen_department | ND-CK-Desserts Dept | ND-CK |
| CK-CAKE | Cake Dept | kitchen_department | Central Kitchen Noida | (none) |
| CDIS | Central Dispatch | central_dispatch | Central Dispatach-Noida (SupplyNote, misspelled) + Central Dispatch Noida (Petpooja) | CDN |
| SK-ND-Sector 67 | Spoke: Noida Sector 67 | assembly_spoke | SK-ND-Sector 67 | DCCK |
| SK-DL-Janakpuri | Spoke: Janakpuri | assembly_spoke | SK-DL-Janakpuri | JK |
| SK-GGN-Sikanderpur | Spoke: Sikanderpur | assembly_spoke | SK-GGN-Sikanderpur | (none) |
| CWH | Central Warehouse | central_warehouse | Store Noida | 01 |

All three CK departments carry `parent_id = ` a CK umbrella row (kept for grouping). Meerut's city is stored correctly as Meerut (source says New Delhi; the alias keeps the source value, our master is right). The FREEZER-CK node from v1 stays for the frozen-buffer ledger.

**Open (process, not schema):** rename the cake department in SupplyNote to `ND-CK-Cake Dept` and route housekeeping and maintenance to the `housekeeping` location, so cake-department consumption is not contaminated (findings 1.1). The schema supports it either way.

---

## 2. SKUs, units, categories, costs (revised)

### 2.1 Base unit and dated conversions (findings point 4)

```sql
create type base_unit as enum ('gram','millilitre','piece');

alter table skus add column if not exists base_unit base_unit;      -- recipes are ALWAYS in base units
-- keep v1 chef fields (typical_qty_per_day, sort_order, to_spokes, shelf_life_days)
-- the old free-text uom becomes the DEFAULT entry unit, resolved via uom_conversions

-- Dated, versioned pack/entry-unit conversions. A silently edited factor would
-- corrupt historical consumption, so every factor is effective-dated (never overwritten).
create table uom_conversions (
  id            bigint generated always as identity primary key,
  sku_id        bigint not null references skus(id),
  entry_unit    text not null,             -- 'kg','tin','piece','litre','tray' (what staff handle)
  factor_to_base numeric(16,6) not null,   -- entry_unit -> base_unit (8 kg tin -> 8000 gram)
  is_default_entry boolean not null default false,
  effective_from date not null,
  set_by        text,
  note          text,
  created_at    timestamptz not null default now()
);
create index idx_uom_conv on uom_conversions (sku_id, effective_from desc);
```

SupplyNote's export already carries `baseUnitValue / stockUnitValue / stockUnit` columns; we seed initial conversions from those where present, and the 694 piece-unit items that are really weight or volume packs are the workstream-zero task (the schema is ready now).

### 2.2 Category normalization (findings points 3, 5), never written back to source

```sql
-- canonical category on the SKU, plus a map from messy source categories to canonical.
alter table skus add column if not exists category_canonical text;

create table category_map (
  id               bigint generated always as identity primary key,
  system           source_system not null,
  source_category  text not null,           -- 'houskeeping','fruits and vegitables','semi-finish',...
  canonical_category text not null,          -- 'housekeeping','vegetables','intermediate',...
  default_sku_type sku_type,                 -- so a source category can imply raw_material/intermediate/FG
  note             text,
  unique (system, source_category)
);
```

This resolves the typos (`houskeeping`, `chcoos cookies and fruits`, `fruits and vegitables` / `& vegitables` / `vegetables`), the sponge split (`sponges` + the 6 sponge items under `semi-finish` map to one canonical), and the trailing-space / literal-`null` sub-categories. The one row whose SKU field holds the product name is handled in `sku_aliases`, not by editing source.

### 2.3 Standard costs as an unverified baseline (findings point 6)

```sql
create table standard_costs (
  id          bigint generated always as identity primary key,
  sku_id      bigint not null references skus(id),
  source      source_system not null,        -- petpooja (production/transfer price) | supplynote (rate)
  rate        numeric(14,4),                 -- null allowed: 9 intermediates have no cost
  per_unit    text,                          -- the unit the rate is quoted in
  as_of       date,
  verified    boolean not null default false,-- these are a baseline, NOT authoritative
  note        text
);
create index idx_std_cost_sku on standard_costs (sku_id, source, as_of desc);
```

Petpooja production and transfer lines already carry a unit price, and 47 SupplyNote intermediates carry a rate: ingest both here as `verified = false`, to cross-check against computed cost later. Nine intermediates keep a null rate until filled.

### 2.4 SKU aliases (unchanged shape, wider use)

`sku_aliases` (from v1) maps SupplyNote `_id` / `SKU` / `NAME` and Petpooja `Raw Material` names to one canonical SKU. The chef's 46 versus SupplyNote's 47 intermediates reconcile here (many source names to one canonical), a workstream-zero task; the name conflicts (for example SupplyNote "Dark Pouring Ganache" vs chef "Pouring Ganache") are resolved by pointing both aliases at the same SKU.

---

## 3. Category to department map (findings point 3)

Petpooja production entries (vendor "In House Production Noida Bakery") carry a product `Category`, never a department. Map it explicitly, editable, never inferred in code.

```sql
create table category_department_map (
  id             bigint generated always as identity primary key,
  system         source_system not null default 'petpooja',
  source_category text not null,            -- 'Cakes','Pastry','Cheese Cakes','Brownies','Crossiant','Jar','Tea Cake'
  department_location_id bigint not null references locations(id),  -- CK-CAKE / CK-DESSERT / CK-SPONGE
  note           text,
  unique (system, source_category)
);
```

---

## 4. Movements (Build 3a, revised, findings point 2)

The final movement set, logged at the making department (sponge and ganache), append-only, a correction is a new reversing row:

**made, issued to cake department, issued to dessert department, sent to spoke (spoke named), wasted.**

Modelled cleanly so the two department issues and the spoke send share one destination column (and so the schema extends if a fourth destination ever appears):

```sql
-- replaces v1 production_action {batch_made, taken_out, sent_to_spoke, wasted}
create type production_action as enum ('made','issued','sent_to_spoke','wasted');

-- production_log (revised): from the maker to a destination
--   made           -> to_location_id = FREEZER-CK (into the buffer)
--   issued         -> to_location_id = CK-CAKE or CK-DESSERT   (shows as "Issued to Cake/Dessert Dept")
--   sent_to_spoke  -> to_location_id = a named spoke
--   wasted         -> reason-coded, no destination
alter table production_log add column if not exists from_location_id bigint references locations(id); -- default CK-SPONGE
alter table production_log add column if not exists to_location_id   bigint references locations(id); -- destination
-- (dest_location_id from v1 is renamed to to_location_id; action enum updated)
```

Two current-state facts drive the reconciliation design:
- **Department to department (sponge to cake, sponge to dessert): zero records today.** 3a is the first and only record. No source to reconcile against; these are new truth.
- **Sponge to spoke: recorded in SupplyNote as GRNs** (but mis-attributed to the cake department on two routes). So 3a's `sent_to_spoke` is the **send side**, the SupplyNote GRN is the **receive side**, and we build a two-sided daily check on the same pattern as Build 1a (send vs receive, three buckets). We do not assume spoke sends are unrecorded.

**Open (process, decides routing, not schema):** one spoke-shipping convention for all three spokes, ideally shipping intermediates from the department that makes them, and whether spoke sends route through Central Dispatch (only if Dispatch physically holds the goods and has frozen storage) or go direct (SOP section 7). The `to_location_id` model supports either; the SOP just decides which locations appear.

---

## 5. What is unchanged from v1

The business-day rule, `location_aliases` / `sku_aliases` shape, `par_stocks` (with `par_type`), `spine_events` audit, the landing zone and Build 1a reconciliation (Petpooja purchase report vs OMS orders), and the frozen-buffer views. The chef v2 intermediate seed stays, now enriched with `base_unit` and conversions.

---

## 6. Decisions I need before writing the migration

1. **Re-baseline vs ALTER.** Recommend a clean re-baseline (drop and re-apply the updated `ALL.sql`, re-seed) since no real data exists yet. Confirm, or ask for ALTER migrations instead.
2. **Movement modelling.** Approve `action {made, issued, sent_to_spoke, wasted}` with a destination column (the two department issues distinguished by destination), or do you want four literal action values? Both produce the same five buttons.
3. **Cake department contamination.** Rename to `ND-CK-Cake Dept` and add a `housekeeping` location for non-production consumables? (Affects seeding, not the schema shape.)
4. Process items that shape seeding but can follow: the one spoke-shipping convention, and whether Central Dispatch handles intermediates (frozen storage question).

I will not write any migration until you approve points 1 to 3.
