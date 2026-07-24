-- ============================================================
-- Creme Castle Kitchen Spine, Migration 000: FOUNDATION (schema v2)
-- Target: the new third "spine" Supabase project (Postgres 15+).
-- v2 folds in the SupplyNote + Petpooja data findings (23 Jul 2026):
--   kitchen departments as locations, base units + dated conversions,
--   category normalisation, standard-cost baseline, movement model made/issued/wasted.
--
-- Covenants: canonical schema is the asset; no hard deletes; every number
-- reproducible; AI never load-bearing; one business-day rule (04:00 IST).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- THE ONE BUSINESS-DAY RULE (04:00 to 03:59 IST) ----------
create or replace function business_day(ts timestamptz)
returns date language sql immutable as $$
  select ((ts at time zone 'Asia/Kolkata') - interval '4 hours')::date
$$;
comment on function business_day(timestamptz) is
  'Canonical business day for the whole spine: 04:00 IST to 03:59 IST next day.';

-- ---------- ENUMS ----------
do $$ begin
  create type source_system as enum ('oms','petpooja','supplynote','dispatch_console');
exception when duplicate_object then null; end $$;

do $$ begin
  create type location_type as enum (
    'central_warehouse',   -- SupplyNote raw-material stock (Store Noida)
    'central_kitchen',     -- the CK umbrella node
    'kitchen_department',  -- the three CK departments (sponge, dessert, cake)
    'central_dispatch',    -- the send/receive accountability node
    'dark_store',          -- Z/S menu FG (Petpooja)
    'assembly_spoke',      -- custom cake assembly (spokes)
    'd2c_fulfillment',     -- website fulfillment dark store (SPJ, FBD, GN, Meerut)
    'freezer',             -- frozen-buffer store location for intermediates
    'housekeeping',        -- non-production consumables sink (keeps maintenance out of cost)
    'virtual'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type sku_type as enum (
    'raw_material','intermediate','finished_good','packaging','design_item');
exception when duplicate_object then null; end $$;

-- Recipes are ALWAYS written in base units. Entry/pack units convert to base.
do $$ begin
  create type base_unit as enum ('gram','millilitre','piece');
exception when duplicate_object then null; end $$;

-- ---------- LOCATION MASTER ----------
-- Canonical code is OURS and unique. The source "Outlet Code" is NOT unique
-- (e.g. ND-CK appears twice) and lives only in location_aliases, never as a key.
create table if not exists locations (
  id          bigint generated always as identity primary key,
  code        text unique not null,
  name        text not null,                   -- the true role (display), not the legacy name
  type        location_type not null,
  city        text,
  region      text,
  parent_id   bigint references locations(id), -- departments point at the CK umbrella
  active      boolean not null default true,
  last_txn_on date,                            -- set by ingestion; liveness = recency
  lifecycle   text not null default 'active',
  notes       text,
  created_at  timestamptz not null default now()
);
comment on column locations.active is
  'Source active flag is UNMAINTAINED (all rows true, incl. closed Lucknow). Do NOT filter on it; use last_txn_on.';

-- Every external name/code for a location, one row per (system, key). Aliases are
-- how the same physical place is known across systems, and how a later rename
-- (e.g. "Central Kitchen Noida" -> "ND-CK-Cake Dept") is absorbed with no migration.
create table if not exists location_aliases (
  id            bigint generated always as identity primary key,
  location_id   bigint not null references locations(id),
  system        source_system not null,
  external_code text,
  external_name text,
  note          text,
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_location_aliases
  on location_aliases (system, coalesce(external_code,''), coalesce(external_name,''));
create index if not exists idx_location_aliases_lookup
  on location_aliases (system, external_name);

-- ---------- SKU MASTER ----------
create table if not exists skus (
  id                  bigint generated always as identity primary key,
  code                text unique not null,
  name                text not null,
  sku_type            sku_type not null,
  category            text,                     -- source category as seen (may be messy)
  category_canonical  text,                     -- normalised (via category_map), never written to source
  uom                 text not null default 'unit',  -- default ENTRY/handling unit ('Pieces','Trays','Kg')
  base_unit           base_unit,                -- recipes computed in this unit
  typical_qty_per_day numeric(12,2),
  sort_order          int,
  to_spokes           boolean,
  shelf_life_days     int,                      -- nullable, loads later with no schema change
  lifecycle           text not null default 'active',
  active              boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now()
);

create table if not exists sku_aliases (
  id            bigint generated always as identity primary key,
  sku_id        bigint not null references skus(id),
  system        source_system not null,
  external_code text,                  -- SupplyNote _id/SKU, Petpooja sap_code
  external_name text,                  -- SupplyNote/Petpooja item name
  note          text,
  created_at    timestamptz not null default now()
);
create unique index if not exists uq_sku_aliases
  on sku_aliases (system, coalesce(external_code,''), coalesce(external_name,''));
create index if not exists idx_sku_aliases_lookup on sku_aliases (system, external_name);

-- ---------- UNIT CONVERSIONS (dated, versioned) ----------
-- entry_unit -> base_unit. Effective-dated so a silently changed pack size never
-- retrospectively corrupts historical consumption (an 8 kg tin -> 5 kg is a NEW row).
create table if not exists uom_conversions (
  id               bigint generated always as identity primary key,
  sku_id           bigint not null references skus(id),
  entry_unit       text not null,               -- 'kg','tin','piece','litre','tray'
  factor_to_base   numeric(16,6) not null,      -- 1 entry_unit = factor_to_base base units
  is_default_entry boolean not null default false,
  effective_from   date not null,
  set_by           text,
  note             text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_uom_conv on uom_conversions (sku_id, effective_from desc);

-- ---------- CATEGORY NORMALISATION (never written back to source) ----------
-- Maps messy source categories to a canonical one, and flags non-production
-- categories (maintenance, housekeeping, utensils, printing stationery) so cake
-- department consumption can exclude them until a housekeeping location exists.
create table if not exists category_map (
  id                 bigint generated always as identity primary key,
  system             source_system not null,
  source_category    text not null,
  canonical_category text not null,
  default_sku_type   sku_type,
  is_non_production  boolean not null default false,
  note               text,
  unique (system, source_category)
);

-- Petpooja production entries carry a product Category, not a department. Map it
-- explicitly and editably; never infer department in code.
create table if not exists category_department_map (
  id                     bigint generated always as identity primary key,
  system                 source_system not null default 'petpooja',
  source_category        text not null,
  department_location_id bigint not null references locations(id),
  note                   text,
  unique (system, source_category)
);

-- ---------- STANDARD COSTS (unverified baseline) ----------
create table if not exists standard_costs (
  id        bigint generated always as identity primary key,
  sku_id    bigint not null references skus(id),
  source    source_system not null,        -- petpooja price | supplynote rate
  rate      numeric(14,4),                 -- null allowed (some intermediates have no cost)
  per_unit  text,
  as_of     date,
  verified  boolean not null default false,-- baseline only, NOT authoritative
  note      text
);
create index if not exists idx_std_cost_sku on standard_costs (sku_id, source, as_of desc);

-- ---------- PAR STOCKS ----------
create table if not exists par_stocks (
  id             bigint generated always as identity primary key,
  sku_id         bigint not null references skus(id),
  location_id    bigint not null references locations(id),
  par_qty        numeric(12,2),
  par_type       text not null default 'fixed',   -- fixed | on_demand | ready_made
  effective_from date not null default ((now() at time zone 'Asia/Kolkata')::date),  -- IST calendar day (24h kitchen)
  set_by         text,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_par_stocks_lookup on par_stocks (sku_id, location_id, effective_from desc);

-- ---------- APPEND-ONLY AUDIT ----------
create table if not exists spine_events (
  id          bigint generated always as identity primary key,
  entity      text not null,
  entity_ref  text,
  action      text not null,
  actor       text,
  data        jsonb,
  at          timestamptz not null default now()
);
create index if not exists idx_spine_events_entity on spine_events (entity, at);
