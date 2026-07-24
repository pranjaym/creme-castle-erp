-- ============================================================
-- Creme Castle Kitchen spine: RE-BASELINE setup (schema v2)
-- Paste into the Supabase SQL editor and Run. It WIPES the spine's kitchen
-- objects and recreates them from scratch, then re-seeds.
--
-- SAFE NOW: the pilot has no real data. DO NOT run this once the sponge team has
-- logged real entries: from that day, changes go through numbered ALTER
-- migrations only (never re-baseline again).
-- ============================================================

-- ---------- RESET (drop v1/v2 objects) ----------
drop schema if exists landing cascade;
drop view if exists v_production_movements, v_frozen_buffer, v_today_entries,
     v_petpooja_punchouts, v_oms_d2c_orders, v_recon_exceptions cascade;
drop table if exists production_log, waste_reasons, par_stocks, uom_conversions,
     category_map, category_department_map, standard_costs, sku_aliases, skus,
     location_aliases, locations, recon_runs, d2c_reconciliation, spine_events,
     schema_migrations cascade;
drop type if exists production_action, base_unit, sku_type, location_type, source_system cascade;
drop function if exists business_day(timestamptz) cascade;

-- >>>>>>>>>>>>>>>>>>>> 000_foundation.sql <<<<<<<<<<<<<<<<<<<<
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


-- >>>>>>>>>>>>>>>>>>>> 005_seed_locations.sql <<<<<<<<<<<<<<<<<<<<
-- Migration 005: SEED locations + aliases (generated, schema v2)
-- Canonical CK/dispatch/spoke/warehouse set with SupplyNote legacy names as
-- aliases, plus the CC-... dark stores. Regenerate: scripts/gen_seed_sql.py.

insert into locations (code, name, type, city, region) values
  ('CK', 'Central Kitchen (Noida)', 'central_kitchen'::location_type, null, 'Delhi NCR'),
  ('CK-SPONGE', 'Sponge and Ganache Dept', 'kitchen_department'::location_type, null, 'Delhi NCR'),
  ('CK-DESSERT', 'Dessert Dept', 'kitchen_department'::location_type, null, 'Delhi NCR'),
  ('CK-CAKE', 'Cake Dept', 'kitchen_department'::location_type, null, 'Delhi NCR'),
  ('FREEZER-CK', 'Central Kitchen Freezer', 'freezer'::location_type, null, 'Delhi NCR'),
  ('CDIS', 'Central Dispatch', 'central_dispatch'::location_type, null, 'Delhi NCR'),
  ('CWH', 'Central Warehouse', 'central_warehouse'::location_type, null, 'Delhi NCR'),
  ('SK-ND-Sector 67', 'Spoke: Noida Sector 67', 'assembly_spoke'::location_type, null, 'Delhi NCR'),
  ('SK-DL-Janakpuri', 'Spoke: Janakpuri', 'assembly_spoke'::location_type, null, 'Delhi NCR'),
  ('SK-GGN-Sikanderpur', 'Spoke: Sikanderpur', 'assembly_spoke'::location_type, null, 'Delhi NCR'),
  ('CC-CHD-Industrial Area', 'CC-CHD-Industrial Area', 'dark_store'::location_type, 'Chandigarh', 'Chandigarh'),
  ('CC-CHD-Mohali', 'CC-CHD-Mohali', 'dark_store'::location_type, 'Chandigarh', 'Chandigarh'),
  ('CC-CHD-Sector 16', 'CC-CHD-Sector 16', 'dark_store'::location_type, 'Chandigarh', 'Chandigarh'),
  ('CC-CHD-Zirakpur', 'CC-CHD-Zirakpur', 'dark_store'::location_type, 'Chandigarh', 'Chandigarh'),
  ('CC-DL-Dwarka', 'CC-DL-Dwarka', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Dwarka Mor', 'CC-DL-Dwarka Mor', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Janakpuri', 'CC-DL-Janakpuri', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Karol Bagh', 'CC-DL-Karol Bagh', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Krishna Nagar', 'CC-DL-Krishna Nagar', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Mayur Vihar Ph 3', 'CC-DL-Mayur Vihar Ph 3', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-NFC', 'CC-DL-NFC', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Paschim Vihar', 'CC-DL-Paschim Vihar', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Rohini', 'CC-DL-Rohini', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Sarita Vihar', 'CC-DL-Sarita Vihar', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Shahpurjat', 'CC-DL-Shahpurjat', 'd2c_fulfillment'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Shalimar Bagh', 'CC-DL-Shalimar Bagh', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-DL-Vasant Kunj', 'CC-DL-Vasant Kunj', 'dark_store'::location_type, 'Delhi', 'Delhi NCR'),
  ('CC-FBD-Sector 15', 'CC-FBD-Sector 15', 'd2c_fulfillment'::location_type, 'Faridabad', 'Delhi NCR'),
  ('CC-FBD-Sector 37', 'CC-FBD-Sector 37', 'dark_store'::location_type, 'Faridabad', 'Delhi NCR'),
  ('CC-GGN-DLF Ph 4', 'CC-GGN-DLF Ph 4', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GGN-Sector 4', 'CC-GGN-Sector 4', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GGN-Sector 49', 'CC-GGN-Sector 49', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GGN-Sector 52', 'CC-GGN-Sector 52', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GGN-Sector 60', 'CC-GGN-Sector 60', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GGN-Sector 86', 'CC-GGN-Sector 86', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GGN-Udyog Vihar', 'CC-GGN-Udyog Vihar', 'dark_store'::location_type, 'Gurgaon', 'Delhi NCR'),
  ('CC-GZB-Raj Nagar', 'CC-GZB-Raj Nagar', 'dark_store'::location_type, 'Ghaziabad', 'Delhi NCR'),
  ('CC-GZB-Vasundhara', 'CC-GZB-Vasundhara', 'dark_store'::location_type, 'Ghaziabad', 'Delhi NCR'),
  ('CC-JP-Bais Godam', 'CC-JP-Bais Godam', 'dark_store'::location_type, 'Jaipur', 'Jaipur'),
  ('CC-JP-Malviya Nagar', 'CC-JP-Malviya Nagar', 'dark_store'::location_type, 'Jaipur', 'Jaipur'),
  ('CC-JP-Pratap Nagar', 'CC-JP-Pratap Nagar', 'dark_store'::location_type, 'Jaipur', 'Jaipur'),
  ('CC-JP-Vaishali Nagar', 'CC-JP-Vaishali Nagar', 'dark_store'::location_type, 'Jaipur', 'Jaipur'),
  ('CC-LKO-Ashiyana', 'CC-LKO-Ashiyana', 'dark_store'::location_type, 'Lucknow', 'Lucknow'),
  ('CC-LKO-Gomti Nagar', 'CC-LKO-Gomti Nagar', 'dark_store'::location_type, 'Lucknow', 'Lucknow'),
  ('CC-LKO-Hazratganj', 'CC-LKO-Hazratganj', 'dark_store'::location_type, 'Lucknow', 'Lucknow'),
  ('CC-LKO-Jankipuram', 'CC-LKO-Jankipuram', 'dark_store'::location_type, 'Lucknow', 'Lucknow'),
  ('CC-ND-Alpha 2', 'CC-ND-Alpha 2', 'd2c_fulfillment'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-ND-Diamond Plaza', 'CC-ND-Diamond Plaza', 'dark_store'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-ND-Gaur City', 'CC-ND-Gaur City', 'dark_store'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-ND-Sector 116', 'CC-ND-Sector 116', 'dark_store'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-ND-Sector 45', 'CC-ND-Sector 45', 'dark_store'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-ND-Sector 68', 'CC-ND-Sector 68', 'dark_store'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-ND-Sector141', 'CC-ND-Sector141', 'dark_store'::location_type, 'Noida', 'Delhi NCR'),
  ('CC-UP-Meerut', 'CC-UP-Meerut', 'd2c_fulfillment'::location_type, 'Meerut', 'Meerut')
on conflict (code) do nothing;

-- department + freezer sit under the Central Kitchen umbrella
update locations set parent_id = (select id from locations where code = 'CK') where code = 'CK-SPONGE';
update locations set parent_id = (select id from locations where code = 'CK') where code = 'CK-DESSERT';
update locations set parent_id = (select id from locations where code = 'CK') where code = 'CK-CAKE';
update locations set parent_id = (select id from locations where code = 'CK') where code = 'FREEZER-CK';

-- aliases: SupplyNote/Petpooja legacy names -> canonical location
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, 'ND-CK', 'ND-CK-Bread Dept', 'sponge and ganache dept (legacy name)' from locations where code = 'CK-SPONGE'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, 'ND-CK', 'ND-CK-Desserts Dept', 'dessert dept (legacy name)' from locations where code = 'CK-DESSERT'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, null, 'Central Kitchen Noida', 'cake dept; rename to ND-CK-Cake Dept later is just another alias, no migration' from locations where code = 'CK-CAKE'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, 'CDN', 'Central Dispatach-Noida', 'SupplyNote misspelling' from locations where code = 'CDIS'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'petpooja'::source_system, null, 'Central Dispatch Noida', 'Petpooja spelling' from locations where code = 'CDIS'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, '01', 'Store Noida', 'all vendor purchases land here' from locations where code = 'CWH'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, 'DCCK', 'SK-ND-Sector 67', null from locations where code = 'SK-ND-Sector 67'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, 'JK', 'SK-DL-Janakpuri', null from locations where code = 'SK-DL-Janakpuri'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'supplynote'::source_system, null, 'SK-GGN-Sikanderpur', null from locations where code = 'SK-GGN-Sikanderpur'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;

-- dark stores: console + Petpooja both name the store by the canonical CC-... string
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-CHD-Industrial Area' from locations where code = 'CC-CHD-Industrial Area'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-CHD-Industrial Area' from locations where code = 'CC-CHD-Industrial Area'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-CHD-Mohali' from locations where code = 'CC-CHD-Mohali'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-CHD-Mohali' from locations where code = 'CC-CHD-Mohali'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-CHD-Sector 16' from locations where code = 'CC-CHD-Sector 16'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-CHD-Sector 16' from locations where code = 'CC-CHD-Sector 16'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-CHD-Zirakpur' from locations where code = 'CC-CHD-Zirakpur'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-CHD-Zirakpur' from locations where code = 'CC-CHD-Zirakpur'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Dwarka' from locations where code = 'CC-DL-Dwarka'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Dwarka' from locations where code = 'CC-DL-Dwarka'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Dwarka Mor' from locations where code = 'CC-DL-Dwarka Mor'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Dwarka Mor' from locations where code = 'CC-DL-Dwarka Mor'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Janakpuri' from locations where code = 'CC-DL-Janakpuri'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Janakpuri' from locations where code = 'CC-DL-Janakpuri'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Karol Bagh' from locations where code = 'CC-DL-Karol Bagh'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Karol Bagh' from locations where code = 'CC-DL-Karol Bagh'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Krishna Nagar' from locations where code = 'CC-DL-Krishna Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Krishna Nagar' from locations where code = 'CC-DL-Krishna Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Mayur Vihar Ph 3' from locations where code = 'CC-DL-Mayur Vihar Ph 3'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Mayur Vihar Ph 3' from locations where code = 'CC-DL-Mayur Vihar Ph 3'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-NFC' from locations where code = 'CC-DL-NFC'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-NFC' from locations where code = 'CC-DL-NFC'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Paschim Vihar' from locations where code = 'CC-DL-Paschim Vihar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Paschim Vihar' from locations where code = 'CC-DL-Paschim Vihar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Rohini' from locations where code = 'CC-DL-Rohini'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Rohini' from locations where code = 'CC-DL-Rohini'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Sarita Vihar' from locations where code = 'CC-DL-Sarita Vihar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Sarita Vihar' from locations where code = 'CC-DL-Sarita Vihar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Shahpurjat' from locations where code = 'CC-DL-Shahpurjat'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Shahpurjat' from locations where code = 'CC-DL-Shahpurjat'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Shalimar Bagh' from locations where code = 'CC-DL-Shalimar Bagh'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Shalimar Bagh' from locations where code = 'CC-DL-Shalimar Bagh'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-DL-Vasant Kunj' from locations where code = 'CC-DL-Vasant Kunj'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-DL-Vasant Kunj' from locations where code = 'CC-DL-Vasant Kunj'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-FBD-Sector 15' from locations where code = 'CC-FBD-Sector 15'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-FBD-Sector 15' from locations where code = 'CC-FBD-Sector 15'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-FBD-Sector 37' from locations where code = 'CC-FBD-Sector 37'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-FBD-Sector 37' from locations where code = 'CC-FBD-Sector 37'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-DLF Ph 4' from locations where code = 'CC-GGN-DLF Ph 4'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-DLF Ph 4' from locations where code = 'CC-GGN-DLF Ph 4'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-Sector 4' from locations where code = 'CC-GGN-Sector 4'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-Sector 4' from locations where code = 'CC-GGN-Sector 4'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-Sector 49' from locations where code = 'CC-GGN-Sector 49'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-Sector 49' from locations where code = 'CC-GGN-Sector 49'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-Sector 52' from locations where code = 'CC-GGN-Sector 52'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-Sector 52' from locations where code = 'CC-GGN-Sector 52'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-Sector 60' from locations where code = 'CC-GGN-Sector 60'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-Sector 60' from locations where code = 'CC-GGN-Sector 60'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-Sector 86' from locations where code = 'CC-GGN-Sector 86'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-Sector 86' from locations where code = 'CC-GGN-Sector 86'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GGN-Udyog Vihar' from locations where code = 'CC-GGN-Udyog Vihar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GGN-Udyog Vihar' from locations where code = 'CC-GGN-Udyog Vihar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GZB-Raj Nagar' from locations where code = 'CC-GZB-Raj Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GZB-Raj Nagar' from locations where code = 'CC-GZB-Raj Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-GZB-Vasundhara' from locations where code = 'CC-GZB-Vasundhara'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-GZB-Vasundhara' from locations where code = 'CC-GZB-Vasundhara'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-JP-Bais Godam' from locations where code = 'CC-JP-Bais Godam'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-JP-Bais Godam' from locations where code = 'CC-JP-Bais Godam'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-JP-Malviya Nagar' from locations where code = 'CC-JP-Malviya Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-JP-Malviya Nagar' from locations where code = 'CC-JP-Malviya Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-JP-Pratap Nagar' from locations where code = 'CC-JP-Pratap Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-JP-Pratap Nagar' from locations where code = 'CC-JP-Pratap Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-JP-Vaishali Nagar' from locations where code = 'CC-JP-Vaishali Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-JP-Vaishali Nagar' from locations where code = 'CC-JP-Vaishali Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-LKO-Ashiyana' from locations where code = 'CC-LKO-Ashiyana'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-LKO-Ashiyana' from locations where code = 'CC-LKO-Ashiyana'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-LKO-Gomti Nagar' from locations where code = 'CC-LKO-Gomti Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-LKO-Gomti Nagar' from locations where code = 'CC-LKO-Gomti Nagar'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-LKO-Hazratganj' from locations where code = 'CC-LKO-Hazratganj'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-LKO-Hazratganj' from locations where code = 'CC-LKO-Hazratganj'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-LKO-Jankipuram' from locations where code = 'CC-LKO-Jankipuram'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-LKO-Jankipuram' from locations where code = 'CC-LKO-Jankipuram'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Alpha 2' from locations where code = 'CC-ND-Alpha 2'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Alpha 2' from locations where code = 'CC-ND-Alpha 2'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Diamond Plaza' from locations where code = 'CC-ND-Diamond Plaza'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Diamond Plaza' from locations where code = 'CC-ND-Diamond Plaza'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Gaur City' from locations where code = 'CC-ND-Gaur City'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Gaur City' from locations where code = 'CC-ND-Gaur City'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Sector 116' from locations where code = 'CC-ND-Sector 116'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Sector 116' from locations where code = 'CC-ND-Sector 116'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Sector 45' from locations where code = 'CC-ND-Sector 45'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Sector 45' from locations where code = 'CC-ND-Sector 45'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Sector 68' from locations where code = 'CC-ND-Sector 68'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Sector 68' from locations where code = 'CC-ND-Sector 68'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-ND-Sector141' from locations where code = 'CC-ND-Sector141'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-ND-Sector141' from locations where code = 'CC-ND-Sector141'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'dispatch_console'::source_system, 'CC-UP-Meerut' from locations where code = 'CC-UP-Meerut'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_name)
  select id, 'petpooja'::source_system, 'CC-UP-Meerut' from locations where code = 'CC-UP-Meerut'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;

-- OMS outlet-code aliases for the four D2C fulfillment stores
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'oms'::source_system, 'FBD', 'CC-FBD-Sector 15', 'D2C fulfillment store' from locations where code = 'CC-FBD-Sector 15'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'oms'::source_system, 'GN', 'CC-ND-Alpha 2', 'D2C fulfillment store' from locations where code = 'CC-ND-Alpha 2'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'oms'::source_system, 'Meerut', 'CC-UP-Meerut', 'D2C fulfillment store' from locations where code = 'CC-UP-Meerut'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;
insert into location_aliases (location_id, system, external_code, external_name, note)
  select id, 'oms'::source_system, 'SPJ', 'CC-DL-Shahpurjat', 'D2C fulfillment store' from locations where code = 'CC-DL-Shahpurjat'
  on conflict (system, coalesce(external_code,''), coalesce(external_name,'')) do nothing;



-- >>>>>>>>>>>>>>>>>>>> 006_seed_skus.sql <<<<<<<<<<<<<<<<<<<<
-- Migration 006: SEED intermediate SKUs (generated, chef v2 + base_unit)
-- Source: seed_data/intermediate-sku-master-v2.xlsx (46 rows). sku_type='intermediate'.
-- base_unit for recipes; sort_order = chef's by-volume order. Regenerate: gen_seed_sql.py.

insert into skus (code, name, sku_type, category, category_canonical, uom, base_unit, typical_qty_per_day, sort_order, to_spokes, shelf_life_days, notes) values
  ('INT-SPG-001', 'Chocolate Sponge 5in (500g)', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Pieces', 'piece'::base_unit, 800, 1, false, null, 'Base for most chocolate cakes'),
  ('INT-SPG-002', 'Vanilla Sponge 5in (500g)', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Pieces', 'piece'::base_unit, 600, 2, false, null, null),
  ('INT-SPG-003', 'Chocolate Sponge 6in (500g)', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Pieces', 'piece'::base_unit, 120, 3, true, null, 'Mostly used in designer cakes'),
  ('INT-SPG-004', 'Chocolate Sponge 7in (1kg)', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Pieces', 'piece'::base_unit, 120, 4, true, null, null),
  ('INT-SPG-005', 'Vanilla Sponge 6in (500g)', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Pieces', 'piece'::base_unit, 120, 5, true, null, 'Designer cakes / Tiramisu'),
  ('INT-SPG-006', 'Vanilla Sponge 7in (1kg)', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Pieces', 'piece'::base_unit, 50, 6, true, null, null),
  ('INT-SPG-007', 'Chocolate Pastry Sponge 8in', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Pieces', 'piece'::base_unit, 40, 7, true, null, null),
  ('INT-SPG-008', 'Vanilla Pastry Sponge 8in', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Pieces', 'piece'::base_unit, 30, 8, false, null, null),
  ('INT-SPG-009', 'Chocolate Sponge Scratch Tray', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Trays', 'piece'::base_unit, 28, 9, false, null, 'Made daily'),
  ('INT-SPG-010', 'Chocolate Sponge Tray', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Trays', 'piece'::base_unit, 18, 10, true, null, 'Used in both kitchens | FLAG: tray/mould size?'),
  ('INT-SPG-011', 'Vanilla Sponge Tray', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Trays', 'piece'::base_unit, 12, 11, true, null, 'FLAG: tray/mould size?'),
  ('INT-SPG-012', 'Red Velvet Sponge Tray', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Trays', 'piece'::base_unit, 10, 12, true, null, 'FLAG: tray/mould size?'),
  ('INT-SPG-013', 'Red Velvet Pastry Sponge 8in', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Pieces', 'piece'::base_unit, 8, 13, false, null, null),
  ('INT-SPG-014', 'Sugar-Free Chocolate Sponge Scratch Tray', 'intermediate'::sku_type, 'Sponge', 'Sponge', 'Trays', 'piece'::base_unit, null, 14, false, 3, 'One batch lasts three days | shelf life inferred from note'),
  ('INT-GAN-001', 'COD-16 Truffle Ganache (Classic)', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 250, 15, false, null, null),
  ('INT-GAN-002', 'COD-16 Truffle Ganache (Designer)', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 100, 16, true, null, null),
  ('INT-GAN-003', 'VHP-46.5% Chocolate Ganache', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 40, 17, false, null, null),
  ('INT-GAN-004', 'Dairy Milk Chocolate Ganache', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 30, 18, true, null, 'Distinct from Whipped'),
  ('INT-GAN-005', 'VHP-46.5% Whipped Chocolate Ganache', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 30, 19, false, null, 'corrected: chocolate, not cream'),
  ('INT-GAN-006', 'Whipped Pistachio Ganache', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 15, 20, false, null, null),
  ('INT-GAN-007', 'Cremeux Ganache', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 10, 21, false, null, null),
  ('INT-GAN-008', 'Almond Flakes (Roasted)', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 10, 22, false, null, 'roasted in-house'),
  ('INT-GAN-009', 'Milk Chocolate Almond Ganache', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 6, 23, false, null, 'Made on demand'),
  ('INT-GAN-010', 'Whipped Milk Chocolate Ganache', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 4, 24, false, null, 'Distinct from Dairy Milk'),
  ('INT-GAN-011', 'Caramel Whipped Ganache', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 4, 25, false, null, null),
  ('INT-GAN-012', 'Pouring Ganache', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 3, 26, false, null, null),
  ('INT-GAN-013', 'Vanilla Custard Cream', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 3, 27, false, null, null),
  ('INT-GAN-014', 'Malai Cream', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 2.5, 28, false, null, 'name per chef: Malai Cream'),
  ('INT-GAN-015', 'Sugar-Free Chocolate Ganache', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 2, 29, false, null, null),
  ('INT-GAN-016', 'White Chocolate Ganache', 'intermediate'::sku_type, 'Ganache', 'Ganache', 'Kg', 'gram'::base_unit, 2, 30, false, null, null),
  ('INT-SUB-001', 'Sugar Syrup', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 70, 31, false, null, null),
  ('INT-SUB-002', 'Butter Cream', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 60, 32, true, null, null),
  ('INT-SUB-003', 'Cream Cheese Frosting', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 30, 33, true, null, null),
  ('INT-SUB-004', 'Salted Caramel', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 18, 34, true, 7, 'Made rarely, ~1 week shelf life | shelf life inferred from note'),
  ('INT-SUB-005', 'Salted Caramel (Overcooked)', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 10, 35, false, null, 'NEW item, not in first list'),
  ('INT-SUB-006', 'Cocoa Streusel', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 10, 36, false, null, null),
  ('INT-SUB-007', 'Roasted Pistachio', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 10, 37, false, null, null),
  ('INT-SUB-008', 'Mango Compote', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 8, 38, false, null, null),
  ('INT-SUB-009', 'Sticking Butter Cream', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 5, 39, false, null, null),
  ('INT-SUB-010', 'Roasted Vermicelli', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 5, 40, false, null, null),
  ('INT-SUB-011', 'Butterscotch Chunk Glaze', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 4, 41, false, null, null),
  ('INT-SUB-012', 'Cocoa Rocher Glaze (Bomboloni)', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 4, 42, false, null, null),
  ('INT-SUB-013', 'Almond Rocher Glaze', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 3, 43, false, null, null),
  ('INT-SUB-014', 'Butterscotch Whip', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 3, 44, false, null, null),
  ('INT-SUB-015', 'Caramelized Hazelnuts', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, 1, 45, true, null, null),
  ('INT-SUB-016', 'Cooked Condensed Milk', 'intermediate'::sku_type, 'Sub-component', 'Sub-component', 'Kg', 'gram'::base_unit, null, 46, false, null, 'Purchased milkmaid, cooked 5 hours | purchased input, only processed')
on conflict (code) do nothing;



-- >>>>>>>>>>>>>>>>>>>> 007_seed_par.sql <<<<<<<<<<<<<<<<<<<<
-- Migration 007: SEED par stocks (generated, chef v2). par_qty null for non-numeric par.

insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 1200, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-001' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 1000, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-002' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 200, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-003' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 240, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-004' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 200, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-005' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 100, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-006' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 60, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-007' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 50, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-008' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 28, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-009' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 26, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-010' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 18, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-011' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 14, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-012' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 14, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-013' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 8, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SPG-014' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 350, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-001' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 180, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-002' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 60, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-003' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 60, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-004' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 50, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-005' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 25, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-006' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 15, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-007' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 15, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-008' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, null, 'on_demand', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-009' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 8, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-010' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 6, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-011' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 5, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-012' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 5, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-013' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 5, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-014' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 4, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-015' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 4, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-GAN-016' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 70, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-001' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 100, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-002' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 40, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-003' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 30, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-004' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 20, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-005' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 15, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-006' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 15, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-007' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 15, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-008' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 5, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-009' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 5, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-010' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 4, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-011' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 4, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-012' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 6, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-013' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 6, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-014' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, 1, 'fixed', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-015' and l.code = 'FREEZER-CK'
  on conflict do nothing;
insert into par_stocks (sku_id, location_id, par_qty, par_type, effective_from, set_by)
  select s.id, l.id, null, 'ready_made', '2026-07-23', 'chef v2'
  from skus s, locations l where s.code = 'INT-SUB-016' and l.code = 'FREEZER-CK'
  on conflict do nothing;



-- >>>>>>>>>>>>>>>>>>>> 008_seed_uom.sql <<<<<<<<<<<<<<<<<<<<
-- Migration 008: SEED default entry-unit conversions to base (generated).
-- One default conversion per intermediate (kg->gram 1000, piece->piece 1, tray->piece 1).
-- The 694 piece-unit pack conversions for raw materials are a workstream-zero task.

insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-001'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-002'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-003'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-004'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-005'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-006'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-007'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-008'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'tray', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-009'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'tray', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-010'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'tray', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-011'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'tray', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-012'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'piece', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-013'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'tray', 1, true, '2026-07-23', 'seed' from skus where code = 'INT-SPG-014'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-001'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-002'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-003'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-004'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-005'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-006'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-007'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-008'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-009'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-010'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-011'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-012'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-013'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-014'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-015'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-GAN-016'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-001'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-002'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-003'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-004'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-005'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-006'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-007'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-008'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-009'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-010'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-011'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-012'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-013'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-014'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-015'
  on conflict do nothing;
insert into uom_conversions (sku_id, entry_unit, factor_to_base, is_default_entry, effective_from, set_by)
  select id, 'kg', 1000, true, '2026-07-23', 'seed' from skus where code = 'INT-SUB-016'
  on conflict do nothing;



-- >>>>>>>>>>>>>>>>>>>> 009_seed_config.sql <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- Migration 009: SEED config maps (hand-maintained, not generated)
-- Depends on: 000_foundation.sql, 005_seed_locations.sql
-- ============================================================

-- Non-production categories: excluded from cake-department consumption until a
-- separate housekeeping location exists (Pranjay, 23 Jul 2026). This is the
-- temporary filter; removing a row here re-includes that category later.
insert into category_map (system, source_category, canonical_category, is_non_production, note) values
  ('supplynote','maintenance items','maintenance',true,'non-production consumable'),
  ('supplynote','houskeeping','housekeeping',true,'non-production consumable (source typo)'),
  ('supplynote','housekeeping','housekeeping',true,'non-production consumable'),
  ('supplynote','utensils','utensils',true,'non-production consumable'),
  ('supplynote','printing stationery','printing stationery',true,'non-production consumable')
on conflict (system, source_category) do nothing;

-- A few obvious category normalisations (the full 31-category clean-up is a
-- workstream-zero data task; these are seeds and examples of the pattern).
insert into category_map (system, source_category, canonical_category, default_sku_type, note) values
  ('supplynote','fruits and vegitables','vegetables',null,'source typo/dupe'),
  ('supplynote','fruits & vegitables','vegetables',null,'source typo/dupe'),
  ('supplynote','vegetables','vegetables',null,null),
  ('supplynote','chcoos cookies and fruits','chocos cookies and fruits',null,'source typo'),
  ('supplynote','sponges','sponge','intermediate'::sku_type,'sponges are intermediates'),
  ('supplynote','semi-finish','intermediate','intermediate'::sku_type,'some sponges live here too'),
  ('supplynote','semi pastries','intermediate','intermediate'::sku_type,null)
on conflict (system, source_category) do nothing;

-- category_department_map is deliberately left EMPTY. Petpooja production entries
-- carry a product Category (Cakes, Pastry, Cheese Cakes, Brownies, Crossiant, Jar,
-- Tea Cake) but no department. Which category maps to which department is a
-- decision for Pranjay; fill this table when that mapping is agreed. Example shape:
--   insert into category_department_map (source_category, department_location_id)
--     select 'Cakes', id from locations where code = 'CK-CAKE';


-- >>>>>>>>>>>>>>>>>>>> 010_landing.sql <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- Migration 010: BUILD 1a landing zone (layer 1)
-- Depends on: 000_foundation.sql
-- Raw ingested data, one table per source report, stored exactly as pulled
-- plus an ingest stamp. Ugly is fine; nothing builds on this directly.
-- Idempotent: a re-pulled report supersedes by (report, natural key, business_date),
-- it never overwrites in place. The raw file is retained as an immutable receipt.
-- ============================================================

create schema if not exists landing;

-- Every pull, logged. The raw file path points at the immutable receipt in
-- Supabase Storage (bucket 'petpooja-raw' / 'oms-raw').
create table if not exists landing.ingest_runs (
  id             bigint generated always as identity primary key,
  source_system  source_system not null,
  report_key     text not null,          -- 'order_summary_item','online_orders','oms_orders'
  window_from    date,
  window_to      date,
  raw_file_path  text,                   -- Storage path, the receipt
  sha256         text,                   -- hash of the raw file
  row_count      int,
  status         text not null default 'started',  -- started|loaded|failed
  note           text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);

-- Petpooja Item Sales report (order_summary_item). Columns kept as text, exactly
-- as exported (verified against the 22 Jul sample). This is the report that
-- carries D2C punches at the four stores.
create table if not exists landing.petpooja_order_summary_item (
  id               bigint generated always as identity primary key,
  ingest_run_id    bigint references landing.ingest_runs(id),
  business_date    date not null,        -- business_day(date)
  restaurant_name  text,
  invoice_no       text,                 -- Petpooja POS invoice, NOT the OMS order number
  order_ts         text,                 -- 'date' column, raw string
  payment_type     text,                 -- carries the current web-order reference
  order_type       text,
  status           text,
  area             text,
  virtual_brand_name text,
  customer_phone   text,
  customer_name    text,
  my_amount        text,
  total_tax        text,
  discount         text,
  delivery_charge  text,
  container_charge text,
  total            text,
  item_name        text,
  category_name    text,
  sap_code         text,                 -- intended Petpooja item code (F8), empty today
  item_price       text,
  item_quantity    text,
  item_total       text,
  row_hash         text not null,        -- sha256 of the raw line, for idempotency
  loaded_at        timestamptz not null default now()
);
create unique index if not exists uq_pp_item_hash
  on landing.petpooja_order_summary_item (business_date, row_hash);
create index if not exists idx_pp_item_store
  on landing.petpooja_order_summary_item (restaurant_name, business_date);

-- Petpooja Online Orders (aggregator order-count). Zomato/Swiggy only; feeds the
-- console sales component later, not the D2C reconciliation. Kept minimal here.
create table if not exists landing.petpooja_online_orders (
  id               bigint generated always as identity primary key,
  ingest_run_id    bigint references landing.ingest_runs(id),
  business_date    date not null,
  order_ts         text,
  aggregator_order_no text,
  pos_invoice_no   text,
  order_from       text,                 -- Zomato | Swiggy | Toing by Swiggy
  outlet_name      text,
  order_type       text,
  status           text,
  my_amount        text,
  total            text,
  row_hash         text not null,
  loaded_at        timestamptz not null default now()
);
create unique index if not exists uq_pp_online_hash
  on landing.petpooja_online_orders (business_date, row_hash);

-- OMS orders, pulled read-only from the OMS Supabase project into the spine.
-- One row per OMS order at the four D2C stores per business day (by delivery_date,
-- the fulfillment day; see build-plans-1a-3a.md). No writes ever go back to OMS.
create table if not exists landing.oms_orders (
  id               bigint generated always as identity primary key,
  ingest_run_id    bigint references landing.ingest_runs(id),
  business_date    date not null,        -- = delivery_date (fulfillment day)
  oms_order_id     bigint not null,      -- orders.id
  shopify_name     text,                 -- '#171643' or null
  order_display_no text not null,        -- computed: shopify_name minus '#', else CC-<id>
  outlet_code      text,                 -- OMS short code (SPJ/FBD/GN/Meerut/...)
  source           text,                 -- shopify | whatsapp | b2b
  status           text,                 -- new|accepted|...|delivered|cancelled
  order_total      numeric(10,2),
  discount_amount  numeric(10,2),
  line_count       int,                  -- number of order_items rows
  order_qty        numeric(12,2),        -- sum of order_items.quantity (units)
  bill_void        boolean not null default false,
  placed_at        text,
  delivery_date    date,
  loaded_at        timestamptz not null default now()
);
create unique index if not exists uq_oms_orders
  on landing.oms_orders (business_date, oms_order_id);
create index if not exists idx_oms_orders_store
  on landing.oms_orders (outlet_code, business_date);

-- Petpooja Material Purchase Report, downloaded AT the vendor-OMS location: one
-- file, every store's D2C transfer into vendor "OMS". This is Build 1a's punch
-- source (confirmed 23 Jul 2026). The file is HTML saved as .xls, with a title
-- block above a header row (columns: Supplier/Kitchen/Rest name, Invoice Date,
-- Invoice Number, Raw Material, Quantity Purchased, Unit, Price, Subtotal, Taxes,
-- Discount, Net Amount, PO Reference, Category, Sub Category, Description).
-- Supplier = the store, Invoice Number = the OMS order number the team writes.
create table if not exists landing.petpooja_oms_purchases (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,          -- from Invoice Date (the fulfillment day)
  supplier_name  text,                   -- the D2C store that transferred (source)
  invoice_date   text,
  invoice_number text,                   -- the OMS order number the team writes in (the key)
  raw_material   text,                   -- Petpooja item name
  quantity       numeric(12,2),          -- Quantity Purchased (units)
  unit           text,
  price          numeric(12,2),
  subtotal       numeric(12,2),
  taxes          numeric(12,2),
  discount       numeric(12,2),
  net_amount     numeric(12,2),          -- Petpooja valuation, NOT the D2C bill; context only
  po_reference   text,
  category       text,
  sub_category   text,
  description    text,
  row_hash       text not null,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_pp_oms_purchase_hash
  on landing.petpooja_oms_purchases (business_date, row_hash);
create index if not exists idx_pp_oms_purchase_store
  on landing.petpooja_oms_purchases (supplier_name, business_date);


-- >>>>>>>>>>>>>>>>>>>> 020_canonical_recon.sql <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- Migration 020: BUILD 1a canonical + consumer (layers 2 and 3)
-- Depends on: 000_foundation.sql, 010_landing.sql, 005_seed_locations.sql
-- Deterministic transforms of the landing zone into clean, resolved facts, then
-- the reconciliation output table the morning view reads.
-- Order-number NORMALISATION is single-sourced in lib/recon/match-core.mjs (the
-- app consumer), NOT duplicated in SQL, so the two can never disagree.
-- ============================================================

-- ---------- Layer 2: canonical Petpooja punch-outs at the four D2C stores ----------
-- SOURCE (confirmed 23 Jul 2026): landing.petpooja_oms_purchases, the Material
-- Purchase Report downloaded at the vendor-OMS location. Supplier = the store,
-- Invoice Number = the OMS order number. One punch per (store, business day, OMS
-- order number); rows with a blank Invoice Number are surfaced individually (each
-- becomes a "missing order number" leak in the matcher). punch_qty (units) and
-- punch_lines are the structural check; punch_total (Petpooja valuation) is context
-- only, never used to decide a bucket.
create or replace view v_petpooja_punchouts as
with base as (
  select p.*, coalesce(nullif(trim(p.invoice_number), ''), 'ROW-' || p.id::text) as grp
  from landing.petpooja_oms_purchases p
)
select
  b.business_date,
  b.supplier_name                          as store_name,
  la.location_id,
  loc.code                                 as location_code,
  max(nullif(trim(b.invoice_number), ''))  as ref_raw,
  round(sum(coalesce(b.quantity, 0)), 3)   as punch_qty,
  count(*)                                 as punch_lines,
  round(sum(coalesce(b.net_amount, 0)), 2) as punch_total
from base b
left join location_aliases la
  on la.system = 'petpooja'::source_system and la.external_name = b.supplier_name
left join locations loc on loc.id = la.location_id
group by b.business_date, b.supplier_name, la.location_id, loc.code, b.grp;

-- ---------- Layer 2: canonical OMS D2C orders ----------
-- Straight typed projection of landing.oms_orders, location resolved via the OMS
-- alias. One row per OMS order per business day.
create or replace view v_oms_d2c_orders as
select
  o.business_date,
  o.oms_order_id,
  o.shopify_name,
  o.order_display_no,
  o.outlet_code,
  la.location_id,
  loc.code            as location_code,
  o.status,
  o.order_total,
  o.line_count,
  o.order_qty,
  o.bill_void
from landing.oms_orders o
left join location_aliases la
  on la.system = 'oms'::source_system and la.external_code = o.outlet_code
left join locations loc on loc.id = la.location_id;

-- ---------- Layer 3: reconciliation output (written by the app consumer) ----------
create table if not exists recon_runs (
  id            bigint generated always as identity primary key,
  business_date date not null,
  created_at    timestamptz not null default now(),
  created_by    text,
  params        jsonb,
  summary       jsonb          -- bucket tallies from summarize()
);

create table if not exists d2c_reconciliation (
  id             bigint generated always as identity primary key,
  run_id         bigint not null references recon_runs(id),
  business_date  date not null,
  location_code  text,
  bucket         text not null,   -- matched | punch_no_order | order_no_punch | qty_item_mismatch
  reason         text,
  oms_order_ref  text,
  punch_ref_raw  text,
  oms_qty        numeric(12,2),   -- OMS units (structural check)
  punch_qty      numeric(12,2),   -- Petpooja transfer units (structural check)
  oms_lines      int,
  punch_lines    int,
  oms_total      numeric(10,2),   -- context only (different valuations)
  punch_total    numeric(10,2),
  oms_status     text,
  cancelled_or_void boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists idx_recon_run   on d2c_reconciliation (run_id);
create index if not exists idx_recon_bucket on d2c_reconciliation (business_date, location_code, bucket);

-- The morning view: exceptions only (matched rows are the happy path), per store.
create or replace view v_recon_exceptions as
select business_date, location_code, bucket, reason, oms_order_ref, punch_ref_raw,
       oms_qty, punch_qty, oms_lines, punch_lines, oms_total, punch_total,
       oms_status, cancelled_or_void
from d2c_reconciliation
where bucket <> 'matched' or cancelled_or_void
order by business_date desc, location_code, bucket;


-- >>>>>>>>>>>>>>>>>>>> 030_production_log.sql <<<<<<<<<<<<<<<<<<<<
-- ============================================================
-- Migration 030: BUILD 3a, the intermediates logbook (schema v2)
-- Depends on: 000_foundation.sql
-- Three movement verbs, destinations come from the location master, so adding a
-- department or a spoke later needs NO code change:
--   made    -> into the frozen buffer (qty +)
--   issued  -> to a destination: Cake Dept, Dessert Dept, or a spoke (qty -)
--   wasted  -> reason-coded (qty -)
-- Append-only: a correction is a NEW reversing row, never an edit or delete.
-- ============================================================

do $$ begin
  create type production_action as enum ('made','issued','wasted');
exception when duplicate_object then null; end $$;

create table if not exists waste_reasons (
  code     text primary key,
  label_en text not null,
  label_hi text,
  active   boolean not null default true
);

-- KITCHEN (back-of-house) ledger, 24 hours: the day is the plain IST calendar date,
-- NOT the 04:00 sales business_day(). business_date is the chef-chosen production day;
-- entered_at is the honest wall clock, so a catch-up entry shows as entered_at <> business_date.
create table if not exists production_log (
  id                bigint generated always as identity primary key,
  business_date     date not null,                  -- IST calendar production day (chef-chosen)
  sku_id            bigint not null references skus(id),
  action            production_action not null,
  qty               numeric(12,2) not null check (qty > 0),  -- positive; sign is by action
  uom               text not null,                  -- entry unit snapshot at entry time
  from_location_id  bigint references locations(id), -- the making department (default the sponge dept)
  to_location_id    bigint references locations(id), -- destination for made (freezer) and issued
  via_location_id   bigint references locations(id), -- e.g. Central Dispatch cross-dock on a spoke send
  reason_code       text references waste_reasons(code),
  note              text,
  entered_by        text not null,
  entered_at        timestamptz not null default now(),
  corrects_id       bigint references production_log(id),
  constraint wasted_needs_reason
    check (action <> 'wasted' or reason_code is not null),
  constraint made_issued_need_destination
    check (action = 'wasted' or to_location_id is not null)
);
create index if not exists idx_prodlog_day on production_log (business_date);
create index if not exists idx_prodlog_sku on production_log (sku_id, business_date);
create index if not exists idx_prodlog_to  on production_log (to_location_id, business_date);

-- Signed movements: made adds to the buffer, issued and wasted subtract.
create or replace view v_production_movements as
select id, business_date, sku_id, action,
       case when action = 'made' then qty else -qty end as signed_qty,
       uom, from_location_id, to_location_id, via_location_id, reason_code,
       entered_by, entered_at, corrects_id
from production_log;

-- Current frozen-buffer level per intermediate, par + derived buffer behaviour,
-- in the chef's sort order, every intermediate shown (0 until logged).
create or replace view v_frozen_buffer as
with level as (
  select sku_id, sum(signed_qty) as on_hand
  from v_production_movements group by sku_id
),
current_par as (
  select distinct on (sku_id, location_id) sku_id, par_qty, par_type
  from par_stocks
  where effective_from <= (now() at time zone 'Asia/Kolkata')::date   -- IST calendar day (24h kitchen)
  order by sku_id, location_id, effective_from desc
)
select
  s.code as sku_code, s.name as sku_name, s.category_canonical as category, s.uom,
  s.base_unit, s.sort_order, s.to_spokes, s.typical_qty_per_day,
  coalesce(lv.on_hand, 0) as on_hand,
  cp.par_qty, coalesce(cp.par_type, 'fixed') as par_type,
  case when cp.par_qty is not null then coalesce(lv.on_hand,0) - cp.par_qty end as vs_par,
  case
    when cp.par_type is not null and cp.par_type <> 'fixed'
      then initcap(replace(cp.par_type, '_', ' '))
    when cp.par_qty is null or s.typical_qty_per_day is null then null
    when cp.par_qty > s.typical_qty_per_day then 'Buffer'
    else 'Daily fresh'
  end as buffer_behaviour
from skus s
left join level lv       on lv.sku_id = s.id
left join current_par cp on cp.sku_id = s.id
where s.sku_type = 'intermediate' and s.active
order by s.sort_order;

-- Today's entries for the read-back screen. "Today" is the IST calendar date, since
-- the kitchen is 24h and does not use the 04:00 sales business_day().
create or replace view v_today_entries as
select pl.id, pl.entered_at, s.code as sku_code, s.name as sku_name,
       pl.action, pl.qty, pl.uom, pl.reason_code,
       tl.code as to_code, tl.name as to_name, vl.code as via_code, pl.entered_by, pl.note
from production_log pl
join skus s on s.id = pl.sku_id
left join locations tl on tl.id = pl.to_location_id
left join locations vl on vl.id = pl.via_location_id
where pl.business_date = (now() at time zone 'Asia/Kolkata')::date
order by pl.entered_at desc;

-- ---------- SEED: waste reasons ----------
insert into waste_reasons (code, label_en, label_hi) values
  ('failed_batch','Failed batch','Kharab batch'),
  ('trim_loss','Trim loss','Katai nuksan'),
  ('expired','Expired in freezer','Freezer mein expire'),
  ('spillage','Spillage or handling','Gira / handling'),
  ('other','Other (see note)','Anya (note dekhein)')
on conflict (code) do nothing;

