-- ============================================================
-- Migration 052: DAILY SYNC + SELF-VERIFICATION (order and item reports)
-- Target: the spine Supabase project. Additive; no drops, no data loss.
--
-- Purpose (decided 25 Jul 2026 with Pranjay): the 8am run re-pulls the last three
-- business days and PROVES the spine matches Petpooja. Petpooja does amend data
-- after the fact (measured: 5% of one day's orders changed between a 23 Jul pull
-- and a 25 Jul pull), and an 8am scrape can catch a bad backend moment. Re-checking
-- T-1, T-2 and T-3 every morning means each day is independently confirmed three
-- times before we trust it.
--
-- DESIGN (Pranjay's challenge: do not bloat the data):
--   * ONE row per real source row, forever, CORRECTED IN PLACE. The landing tables
--     never grow a second copy of the same order.
--   * Every correction is written to a NARROW change log (which field, old value,
--     new value), not by duplicating the row. Honours covenant 6: nothing is
--     deleted, append-only audit on every mutation.
--   * Rows that vanish from the source are VOIDED (voided_at + reason), never
--     deleted, and drop out of the report views.
--   * A per-day FINGERPRINT (row count + checksum) makes the daily check cheap:
--     if the fingerprint matches, the day is confirmed and no row work happens.
-- ============================================================

-- ---------- 1. ROW LIFECYCLE COLUMNS ----------
alter table landing.petpooja_online_orders
  add column if not exists first_seen_at    timestamptz not null default now(),
  add column if not exists last_verified_at timestamptz,
  add column if not exists verify_count     int not null default 0,
  add column if not exists voided_at        timestamptz,
  add column if not exists void_reason      text;

alter table landing.petpooja_order_summary_item
  add column if not exists first_seen_at    timestamptz not null default now(),
  add column if not exists last_verified_at timestamptz,
  add column if not exists verify_count     int not null default 0,
  add column if not exists voided_at        timestamptz,
  add column if not exists void_reason      text;

-- ---------- 2. NATURAL KEYS (verified unique against live data 25 Jul 2026) ----------
-- Order: (business_date, aggregator_order_no) unique across all 101,002 rows.
-- Item:  (business_date, restaurant_name, invoice_no, item_name, item_price,
--         item_quantity) unique across all 152,029 rows.
-- These let a re-pull find the SAME row and correct it in place.
create unique index if not exists uq_pp_online_natural
  on landing.petpooja_online_orders (business_date, aggregator_order_no);

create unique index if not exists uq_pp_item_natural
  on landing.petpooja_order_summary_item
     (business_date, restaurant_name, invoice_no, item_name, item_price, item_quantity);

-- ---------- 3. PER-DAY FINGERPRINT (the cheap check) ----------
-- One row per (report, business_date). The morning check compares two numbers; only
-- a mismatch triggers row-level work. verify_count is how many independent pulls
-- have agreed: a day confirmed 3 times is trustworthy, a day that keeps moving is not.
create table if not exists landing.spine_day_fingerprints (
  id              bigint generated always as identity primary key,
  report_key      text not null,
  business_date   date not null,
  row_count       int  not null,
  checksum        text not null,      -- md5 over the normalised rows of that day
  first_seen_at   timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  verify_count    int not null default 1,
  last_changed_at timestamptz,
  unique (report_key, business_date)
);
comment on table landing.spine_day_fingerprints is
  'Per business day per report: row count + checksum. If a fresh pull matches, the '
  'day is confirmed with no row work. Mismatch triggers a row-level diff.';

-- ---------- 4. CHANGE LOG (narrow, field level) ----------
-- The audit trail that replaces duplicating rows. One entry per changed FIELD.
create table if not exists landing.spine_row_changes (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  report_key     text not null,
  business_date  date not null,
  natural_key    text not null,       -- human readable key of the affected row
  change_type    text not null,       -- 'inserted' | 'corrected' | 'voided'
  column_name    text,                -- null for insert/void
  old_value      text,
  new_value      text,
  is_material    boolean not null default false,
  changed_at     timestamptz not null default now()
);
create index if not exists idx_row_changes_day
  on landing.spine_row_changes (report_key, business_date, changed_at);
create index if not exists idx_row_changes_material
  on landing.spine_row_changes (is_material, changed_at);

-- ---------- 5. DAILY CHECK LOG (the sense-check report) ----------
create table if not exists landing.spine_daily_checks (
  id                bigint generated always as identity primary key,
  ingest_run_id     bigint references landing.ingest_runs(id),
  report_key        text not null,
  business_date     date not null,
  verdict           text not null,    -- 'confirmed' | 'corrected' | 'first_load' | 'partial'
  rows_in_source    int,
  rows_in_spine     int,
  rows_inserted     int not null default 0,
  rows_corrected    int not null default 0,
  rows_voided       int not null default 0,
  material_changes  int not null default 0,
  checked_at        timestamptz not null default now()
);
create index if not exists idx_daily_checks_day
  on landing.spine_daily_checks (business_date, report_key, checked_at);

-- ---------- 6. VIEWS: hide voided rows, expose verification state ----------
create or replace view public.v_report_online_orders as
  select id, business_date, order_date, invoice_date, aggregator_order_no, pos_invoice_no,
         order_from, outlet_name, outlet_display_name, petpooja_identifier, order_type,
         customer_name, customer_phone, payment_type, delivery_status, status, my_amount,
         aggregator_discount, outlet_discount, delivery_charges, container_charges,
         additional_charge, total, order_acceptance_time, order_delivery_time,
         cancelled_by, reason, tip, complimentary
  from landing.petpooja_online_orders
  where voided_at is null;

create or replace view public.v_report_order_summary_item as
  select id, business_date, restaurant_name, invoice_no, order_ts, payment_type, order_type,
         status, area, virtual_brand_name, brand_grouping, assign_to, customer_phone,
         customer_name, customer_address, persons, order_cancel_reason, my_amount, total_tax,
         discount, delivery_charge, container_charge, service_charge, additional_charge,
         deduction_charge, waived_off, round_off, total, item_name, category_name, sap_code,
         item_price, item_quantity, item_total
  from landing.petpooja_order_summary_item
  where voided_at is null;

-- Data-health view for the portal: how well verified is each recent day.
create or replace view public.v_spine_data_health as
  select f.report_key, f.business_date, f.row_count, f.verify_count,
         f.last_verified_at, f.last_changed_at,
         coalesce((select count(*) from landing.spine_row_changes r
                   where r.report_key=f.report_key and r.business_date=f.business_date
                     and r.is_material), 0) as material_changes
  from landing.spine_day_fingerprints f;

revoke all on public.v_spine_data_health from anon, authenticated;
grant select on public.v_spine_data_health to service_role;

notify pgrst, 'reload schema';
