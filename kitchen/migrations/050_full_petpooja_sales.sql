-- ============================================================
-- Migration 050: FULL-FIDELITY PETPOOJA SALES LANDING (order + item)
-- Target: the spine Supabase project. Supersedes migration 041's report views.
--
-- Rebuilds the two Petpooja sales landing tables to store EVERY column from the
-- raw reports (order report = 27 columns, item report = 32 columns), so the spine
-- is the complete source of truth and the portal can reproduce the reports
-- verbatim. Column names match the raw report headers.
--
-- DECISION 24 Jul 2026 (written back to docs): store all columns INCLUDING customer
-- name / phone / address. This reverses the earlier rule that stripped customer PII
-- from the query-able landing tables. The immutable raw receipts in the
-- petpooja-raw bucket already held this PII; now the landing tables do too.
--
-- Non-destructive: the previous (partial) tables are RENAMED to *_pre050 and kept
-- (no rows are deleted; honours the no-hard-delete rule). The canonical names are
-- taken by fresh full tables. After applying, re-load the last 30 days so the new
-- tables fill with the full columns; the *_pre050 archives can be dropped later by
-- hand once you are satisfied.
-- ============================================================

-- Views hold no data; replace them to point at the new tables.
drop view if exists public.v_report_online_orders;
drop view if exists public.v_report_order_summary_item;

-- Archive the previous partial tables (keeps all rows under a new name). IF EXISTS
-- guards make this safe to re-run: if a table was already archived, it is skipped.
alter table if exists landing.petpooja_online_orders rename to petpooja_online_orders_pre050;
alter table if exists landing.petpooja_order_summary_item rename to petpooja_order_summary_item_pre050;
-- Free the old index names so the new tables can reuse the canonical ones. Only the
-- indexes that actually existed (migration 010) are renamed; all guarded by IF EXISTS.
-- NB the order table never had a store index, so there is none to rename here.
alter index if exists landing.uq_pp_online_hash rename to uq_pp_online_hash_pre050;
alter index if exists landing.uq_pp_item_hash rename to uq_pp_item_hash_pre050;
alter index if exists landing.idx_pp_item_store rename to idx_pp_item_store_pre050;

-- ---------- ORDER REPORT (online_orders_report_all), 27 columns ----------
create table if not exists landing.petpooja_online_orders (
  id                     bigint generated always as identity primary key,
  ingest_run_id          bigint references landing.ingest_runs(id),
  business_date          date not null,        -- business_day(order_date), 04:00 IST
  order_date             text,                 -- raw 'Date'
  invoice_date           text,                 -- 'Invoice Date'
  aggregator_order_no    text,
  pos_invoice_no         text,
  order_from             text,
  outlet_name            text,
  outlet_display_name    text,
  petpooja_identifier    text,
  order_type             text,
  customer_name          text,
  customer_phone         text,
  payment_type           text,
  delivery_status        text,
  status                 text,
  my_amount              text,
  aggregator_discount    text,
  outlet_discount        text,
  delivery_charges       text,
  container_charges      text,
  additional_charge      text,
  total                  text,
  order_acceptance_time  text,
  order_delivery_time    text,
  cancelled_by           text,
  reason                 text,
  tip                    text,
  complimentary          text,
  row_hash               text not null,
  loaded_at              timestamptz not null default now()
);
create unique index if not exists uq_pp_online_hash
  on landing.petpooja_online_orders (business_date, row_hash);
create index if not exists idx_pp_online_store
  on landing.petpooja_online_orders (outlet_name, business_date);

-- ---------- ITEM REPORT (order_summary_item), 32 columns ----------
create table if not exists landing.petpooja_order_summary_item (
  id                   bigint generated always as identity primary key,
  ingest_run_id        bigint references landing.ingest_runs(id),
  business_date        date not null,          -- business_day(order_ts), 04:00 IST
  restaurant_name      text,
  invoice_no           text,
  order_ts             text,                   -- raw 'date'
  payment_type         text,
  order_type           text,
  status               text,
  area                 text,
  virtual_brand_name   text,
  brand_grouping       text,
  assign_to            text,
  customer_phone       text,
  customer_name        text,
  customer_address     text,
  persons              text,
  order_cancel_reason  text,
  my_amount            text,
  total_tax            text,
  discount             text,
  delivery_charge      text,
  container_charge     text,
  service_charge       text,
  additional_charge    text,
  deduction_charge     text,
  waived_off           text,
  round_off            text,
  total                text,
  item_name            text,
  category_name        text,
  sap_code             text,
  item_price           text,
  item_quantity        text,
  item_total           text,
  row_hash             text not null,
  loaded_at            timestamptz not null default now()
);
create unique index if not exists uq_pp_item_hash
  on landing.petpooja_order_summary_item (business_date, row_hash);
create index if not exists idx_pp_item_store
  on landing.petpooja_order_summary_item (restaurant_name, business_date);

-- ---------- PORTAL REPORT VIEWS (all columns, template order) ----------
create view public.v_report_online_orders as
  select id, business_date, order_date, invoice_date, aggregator_order_no, pos_invoice_no,
         order_from, outlet_name, outlet_display_name, petpooja_identifier, order_type,
         customer_name, customer_phone, payment_type, delivery_status, status, my_amount,
         aggregator_discount, outlet_discount, delivery_charges, container_charges,
         additional_charge, total, order_acceptance_time, order_delivery_time,
         cancelled_by, reason, tip, complimentary
  from landing.petpooja_online_orders;

create view public.v_report_order_summary_item as
  select id, business_date, restaurant_name, invoice_no, order_ts, payment_type, order_type,
         status, area, virtual_brand_name, brand_grouping, assign_to, customer_phone,
         customer_name, customer_address, persons, order_cancel_reason, my_amount, total_tax,
         discount, delivery_charge, container_charge, service_charge, additional_charge,
         deduction_charge, waived_off, round_off, total, item_name, category_name, sap_code,
         item_price, item_quantity, item_total
  from landing.petpooja_order_summary_item;

revoke all on public.v_report_online_orders from anon, authenticated;
revoke all on public.v_report_order_summary_item from anon, authenticated;
grant select on public.v_report_online_orders to service_role;
grant select on public.v_report_order_summary_item to service_role;

notify pgrst, 'reload schema';
