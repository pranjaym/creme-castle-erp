-- ============================================================
-- Migration 210: SWIGGY DAILY MTD EMAIL REPORT
-- Target: the spine Supabase project. Additive only (CREATE ... IF NOT EXISTS).
-- Design docs: erp-plan/swiggy-database-plan.md (23 Aug 2026, updated 28 Aug)
--              erp-plan/swiggy-dashboard-plan.md (28 Aug 2026)
--
-- Source: the automated Daily-MTD xlsx that Swiggy mails every day
-- (from aashuraj.hassani@swiggy.in, verified arriving in Creme Castle
-- inboxes daily since 24 Aug 2026). One brand per file, about 40 outlets,
-- 11 sheets. Each day's file RESTATES the whole month so far, so a missed
-- mail heals itself the next day and most rows in any load are unchanged.
--
-- Conventions inherited from 060 and 130, deliberately unchanged:
--   * landing schema, every source column stored as TEXT (raw fidelity);
--   * ingest_run_id references landing.ingest_runs (the register; the
--     swiggy_report_files table proposed on 23 Aug is NOT built, the
--     existing register does that job, sha256 included for hash-skip);
--   * re-loads SUPERSEDE, never update: a changed row gets a new row, the
--     old row is stamped superseded_at then superseded_by. Current state =
--     superseded_at is null. Nothing is ever deleted (CLAUDE.md rule 6);
--   * unique partial index on the natural key where superseded_at is null.
--
-- LOADER CONTRACTS this schema assumes (verified against the real
-- Aug-19-2026 file on 28 Aug 2026). Breaking any of these silently
-- corrupts the tables:
--   1. order_id and item_id are 15-digit numbers. Excel holds them as
--      numbers; the loader must stringify without scientific notation and
--      store TEXT. Never let pandas or Excel round-trip them.
--   2. item_name and item_category arrive wrapped in literal double quote
--      characters ("Tiramisu"). The loader strips one balanced pair before
--      storing. The archived raw file keeps the original.
--   3. Natural keys are NOT unique in the source. The Aug-19 file has
--      duplicate (order_id, item_name) rows in Item Feedback and duplicate
--      (dt, restaurant_id) rows in Outlet rating. Every sheet table
--      therefore carries dup_seq: the 1-based occurrence number of that
--      natural key within one file, in sheet order. dup_seq is part of
--      every unique index.
--   4. NTR-RR is the one sheet stored AGGREGATED, not raw: the source rows
--      are per customer per day with no customer id and no order_id, so no
--      stable row key exists. The loader sums to (business_date,
--      restaurant_id, order_type) and records how many source rows fed
--      each stored row in source_rows.
--   5. Column names drift between months. The Funnel sheet says "date"
--      where every other sheet says "dt"; the CPC CPV sheet says "rest_id"
--      not "restaurant_id"; files before Feb 2026 carry an extra
--      "Rest Name" column and lack swiggy_trade_discount; the Jan-31-2026
--      file lacks the Sales, Item sales and Item Feedback sheets entirely.
--      The loader maps by name, tolerates missing sheets and columns, and
--      the register note records which sheets each file actually had.
--   6. Swiggy gmv is NOT Petpooja Net Sales (the spot check definition).
--      No consumer may compare them unlabelled; the reconciliation decides
--      which number each dashboard tile shows (dashboard plan section 4).
-- ============================================================

alter type source_system add value if not exists 'swiggy';

-- ------------------------------------------------------------
-- T1. Sales: one row per outlet per day. Source sheet "Sales".
-- ------------------------------------------------------------
create table if not exists landing.swiggy_sales_daily (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,          -- source dt
  restaurant_id  text not null,
  dup_seq        int  not null default 1,
  brand_name     text,
  area           text,
  city           text,
  orders         text,
  gmv            text,
  row_hash       text not null,
  superseded_by  bigint references landing.swiggy_sales_daily(id),
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_swsd_key
  on landing.swiggy_sales_daily (business_date, restaurant_id, dup_seq)
  where superseded_at is null;
create index if not exists idx_swsd_date on landing.swiggy_sales_daily (business_date)
  where superseded_at is null;

-- ------------------------------------------------------------
-- T2. Funnel: one row per outlet per day. Source sheet "Funnel"
-- (source date column is named "date", normalized to business_date).
-- ------------------------------------------------------------
create table if not exists landing.swiggy_funnel_daily (
  id              bigint generated always as identity primary key,
  ingest_run_id   bigint references landing.ingest_runs(id),
  business_date   date not null,
  restaurant_id   text not null,
  dup_seq         int  not null default 1,
  brand_name      text,
  area            text,
  city            text,
  menu_sessions   text,
  cart_session    text,
  payment_session text,
  order_session   text,
  row_hash        text not null,
  superseded_by   bigint references landing.swiggy_funnel_daily(id),
  superseded_at   timestamptz,
  loaded_at       timestamptz not null default now()
);
create unique index if not exists uq_swfd_key
  on landing.swiggy_funnel_daily (business_date, restaurant_id, dup_seq)
  where superseded_at is null;
create index if not exists idx_swfd_date on landing.swiggy_funnel_daily (business_date)
  where superseded_at is null;

-- ------------------------------------------------------------
-- T3. New vs repeat, AGGREGATED on load (loader contract 4).
-- Source sheet "NTR-RR". order_type is NTR (new to restaurant) or RTR.
-- ------------------------------------------------------------
create table if not exists landing.swiggy_ntr_rr_daily (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,
  restaurant_id  text not null,
  order_type     text not null,          -- NTR | RTR
  dup_seq        int  not null default 1,
  brand_name     text,
  area           text,
  city           text,
  orders         text,                   -- sum of source orders
  gmv            text,                   -- sum of source gmv
  source_rows    int,                    -- how many source rows were summed
  row_hash       text not null,
  superseded_by  bigint references landing.swiggy_ntr_rr_daily(id),
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_swnr_key
  on landing.swiggy_ntr_rr_daily (business_date, restaurant_id, order_type, dup_seq)
  where superseded_at is null;
create index if not exists idx_swnr_date on landing.swiggy_ntr_rr_daily (business_date)
  where superseded_at is null;

-- ------------------------------------------------------------
-- T4. Item feedback and rating: one row per rated order item.
-- Source sheet "Item Feedback and rating". Duplicate keys exist in the
-- source (contract 3), hence dup_seq.
-- ------------------------------------------------------------
create table if not exists landing.swiggy_item_feedback (
  id                bigint generated always as identity primary key,
  ingest_run_id     bigint references landing.ingest_runs(id),
  business_date     date not null,
  restaurant_id     text not null,
  order_id          text not null,
  item_name         text not null,      -- quotes stripped (contract 2)
  dup_seq           int  not null default 1,
  brand_name        text,
  city              text,
  area              text,
  gmv_total         text,
  comments          text,
  restaurant_rating text,
  post_status       text,
  row_hash          text not null,
  superseded_by     bigint references landing.swiggy_item_feedback(id),
  superseded_at     timestamptz,
  loaded_at         timestamptz not null default now()
);
create unique index if not exists uq_swif_key
  on landing.swiggy_item_feedback (order_id, item_name, dup_seq)
  where superseded_at is null;
create index if not exists idx_swif_date on landing.swiggy_item_feedback (business_date, restaurant_id)
  where superseded_at is null;

-- ------------------------------------------------------------
-- T5. Item sales: one row per order item, the workhorse table, the Swiggy
-- analogue of landing.zomato_order_details. Source sheet "Item sales".
-- ------------------------------------------------------------
create table if not exists landing.swiggy_item_sales (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,          -- source dt
  restaurant_id  text not null,
  order_id       text not null,
  item_id        text not null,
  variant_name   text,                   -- often null in source
  price_per_item text,
  dup_seq        int  not null default 1,
  ordered_time   text,                   -- full timestamp as text, IST
  brand_name     text,
  city           text,
  area           text,
  item_name      text,                   -- quotes stripped (contract 2)
  item_category  text,                   -- quotes stripped (contract 2)
  item_quantity  text,
  item_subtotal  text,
  row_hash       text not null,
  superseded_by  bigint references landing.swiggy_item_sales(id),
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_swis_key
  on landing.swiggy_item_sales (order_id, item_id, coalesce(variant_name,''), coalesce(price_per_item,''), dup_seq)
  where superseded_at is null;
create index if not exists idx_swis_date on landing.swiggy_item_sales (business_date, restaurant_id)
  where superseded_at is null;
create index if not exists idx_swis_order on landing.swiggy_item_sales (order_id)
  where superseded_at is null;

-- ------------------------------------------------------------
-- T6. Outlet rating: one row per outlet per day. Source sheet
-- "Outlet rating". Duplicate keys exist in the source (contract 3).
-- ------------------------------------------------------------
create table if not exists landing.swiggy_outlet_rating_daily (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,
  restaurant_id  text not null,
  dup_seq        int  not null default 1,
  brand_name     text,
  city           text,
  area           text,
  avg_rating     text,
  row_hash       text not null,
  superseded_by  bigint references landing.swiggy_outlet_rating_daily(id),
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_sword_key
  on landing.swiggy_outlet_rating_daily (business_date, restaurant_id, dup_seq)
  where superseded_at is null;
create index if not exists idx_sword_date on landing.swiggy_outlet_rating_daily (business_date)
  where superseded_at is null;

-- ------------------------------------------------------------
-- T7. Slot wise sales: one row per outlet per day per meal slot.
-- Source sheet "Slot Wise Sales" (slot column is named order_time:
-- Breakfast, Lunch, Snacks, Dinner, Late night).
-- ------------------------------------------------------------
create table if not exists landing.swiggy_slot_sales (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,
  restaurant_id  text not null,
  slot           text not null,          -- source order_time
  dup_seq        int  not null default 1,
  brand_name     text,
  city           text,
  area           text,
  orders         text,
  gmv            text,
  aov            text,
  row_hash       text not null,
  superseded_by  bigint references landing.swiggy_slot_sales(id),
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_swss_key
  on landing.swiggy_slot_sales (business_date, restaurant_id, slot, dup_seq)
  where superseded_at is null;
create index if not exists idx_swss_date on landing.swiggy_slot_sales (business_date)
  where superseded_at is null;

-- ------------------------------------------------------------
-- T8. Ads by slot: one row per outlet per day per time slot per ad type.
-- Source sheet "CPC CPV" (outlet column is named rest_id, normalized).
-- flag is CPC or CPV.
-- ------------------------------------------------------------
create table if not exists landing.swiggy_ads_slot (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,
  restaurant_id  text not null,          -- source rest_id
  time_slot      text not null,
  flag           text not null,          -- CPC | CPV
  dup_seq        int  not null default 1,
  brand_name     text,
  city           text,
  area           text,
  ads_orders     text,
  ads_gmv        text,
  clicks         text,
  budget_burnt   text,
  impressions    text,
  row_hash       text not null,
  superseded_by  bigint references landing.swiggy_ads_slot(id),
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_swas_key
  on landing.swiggy_ads_slot (business_date, restaurant_id, time_slot, flag, dup_seq)
  where superseded_at is null;
create index if not exists idx_swas_date on landing.swiggy_ads_slot (business_date)
  where superseded_at is null;

-- ------------------------------------------------------------
-- T9. Cancellations: one row per cancelled order item. Source sheet
-- "Cancellation". business_date comes from ordered_date.
-- ------------------------------------------------------------
create table if not exists landing.swiggy_cancellations (
  id                   bigint generated always as identity primary key,
  ingest_run_id        bigint references landing.ingest_runs(id),
  business_date        date not null,    -- source ordered_date
  restaurant_id        text not null,
  order_id             text not null,
  item_name            text not null,    -- quotes stripped (contract 2)
  dup_seq              int  not null default 1,
  restaurant_name      text,
  brand_name           text,
  area                 text,
  city                 text,
  post_status          text,
  ordered_time         text,
  is_food_prepared     text,
  rdc_flag             text,
  cancelled_time       text,
  cancellation_l1      text,
  cancellation_l2      text,
  sub_disposition_name text,
  row_hash             text not null,
  superseded_by        bigint references landing.swiggy_cancellations(id),
  superseded_at        timestamptz,
  loaded_at            timestamptz not null default now()
);
create unique index if not exists uq_swcx_key
  on landing.swiggy_cancellations (order_id, item_name, dup_seq)
  where superseded_at is null;
create index if not exists idx_swcx_date on landing.swiggy_cancellations (business_date, restaurant_id)
  where superseded_at is null;

-- ------------------------------------------------------------
-- T10. Coupon data: one row per order per coupon. Source sheet
-- "Coupon data". The funding split (restaurant vs Swiggy trade discount)
-- exists nowhere else; swiggy_trade_discount is absent in files before
-- Feb 2026 (contract 5), hence nullable.
-- ------------------------------------------------------------
create table if not exists landing.swiggy_coupon_orders (
  id                        bigint generated always as identity primary key,
  ingest_run_id             bigint references landing.ingest_runs(id),
  business_date             date not null,
  restaurant_id             text not null,
  order_id                  text not null,
  coupon_code               text not null,
  dup_seq                   int  not null default 1,
  brand_name                text,
  restaurant_trade_discount text,
  swiggy_trade_discount     text,
  coupon_discount           text,
  gmv_total                 text,
  swiggyit_orders           text,
  jumbo_orders              text,
  row_hash                  text not null,
  superseded_by             bigint references landing.swiggy_coupon_orders(id),
  superseded_at             timestamptz,
  loaded_at                 timestamptz not null default now()
);
create unique index if not exists uq_swco_key
  on landing.swiggy_coupon_orders (order_id, coupon_code, dup_seq)
  where superseded_at is null;
create index if not exists idx_swco_date on landing.swiggy_coupon_orders (business_date, restaurant_id)
  where superseded_at is null;

-- ------------------------------------------------------------
-- T11. Serviceability: one row per outlet per day. Source sheet
-- "Serviceability". Swiggy's version of the shut-shop tracker.
-- ------------------------------------------------------------
create table if not exists landing.swiggy_serviceability_daily (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,
  restaurant_id  text not null,
  dup_seq        int  not null default 1,
  brand_name     text,
  area           text,
  city           text,
  ideal_open_hrs  text,
  actual_open_hrs text,
  row_hash       text not null,
  superseded_by  bigint references landing.swiggy_serviceability_daily(id),
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_swsv_key
  on landing.swiggy_serviceability_daily (business_date, restaurant_id, dup_seq)
  where superseded_at is null;
create index if not exists idx_swsv_date on landing.swiggy_serviceability_daily (business_date)
  where superseded_at is null;

-- ------------------------------------------------------------
-- Settling log, same purpose and shape as landing.zomato_business_change_log:
-- how many rows each load found new / changed / unchanged, per sheet and per
-- business day. Because the MTD file restates the month, this shows which
-- days actually still move (the restatement evidence, Swiggy edition).
-- ------------------------------------------------------------
create table if not exists landing.swiggy_change_log (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  report_sheet   text not null,
  pull_date      date not null,
  business_date  date not null,
  new_rows       int not null default 0,
  changed_rows   int not null default 0,
  unchanged_rows int not null default 0,
  loaded_at      timestamptz not null default now()
);
create index if not exists idx_swcl_dates
  on landing.swiggy_change_log (pull_date, business_date, report_sheet);

-- RLS on, zero policies: same stance as migrations 070 and 160. Nothing
-- reads these tables through the anon or authenticated REST roles; workers
-- connect as table owner over the pooler and the portal uses the service
-- role. Any future app reading via those roles must add a policy first.
alter table landing.swiggy_sales_daily          enable row level security;
alter table landing.swiggy_funnel_daily         enable row level security;
alter table landing.swiggy_ntr_rr_daily         enable row level security;
alter table landing.swiggy_item_feedback        enable row level security;
alter table landing.swiggy_item_sales           enable row level security;
alter table landing.swiggy_outlet_rating_daily  enable row level security;
alter table landing.swiggy_slot_sales           enable row level security;
alter table landing.swiggy_ads_slot             enable row level security;
alter table landing.swiggy_cancellations        enable row level security;
alter table landing.swiggy_coupon_orders        enable row level security;
alter table landing.swiggy_serviceability_daily enable row level security;
alter table landing.swiggy_change_log           enable row level security;
