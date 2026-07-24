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
