-- ============================================================
-- Migration 252: SUPPLYNOTE LANDING (inventory module, build step 1)
-- 10 November 2026, Pranjay's go ("Yes, apply it"). Staged first in
-- erp-plan/migrations-staging/ (F41), moved here on approval.
--
-- Target: the spine Supabase project. Additive only (CREATE ... IF NOT EXISTS).
-- Nothing existing is altered. No begin/commit in this file: the caller owns
-- the transaction.
-- Design record: erp-plan/inventory-module-plan.md, erp-plan/supplynote-api-notes.md.
--
-- Why. The inventory module (projection, order plan, PO tracker, stock health)
-- reads SupplyNote through its read-only Data API. SupplyNote keeps no daily
-- stock history we can chart, and its figures move all day, so the spine takes
-- its own copy: every item's stock once a day, every stock movement, every
-- purchase order and its lines. The module reads these tables, never the API.
--
-- Scope of the pull: products for the whole business; stock, movements and
-- purchase orders for the Noida Central Warehouse (outlet_id
-- 5dd9015b742a4b9b20c45677). All categories are landed, not only packaging,
-- so raw materials need no second backfill later.
--
-- Conventions inherited from 060, 130, 210 and 221, unchanged:
--   * landing schema; ingest_run_id references landing.ingest_runs
--     (source_system 'supplynote', already in the enum since 000);
--   * re-loads SUPERSEDE, never update; nothing is deleted (CLAUDE.md rule 6);
--   * unique partial index on the natural key where superseded_at is null.
-- One difference, deliberate: these tables keep the columns the module reads
-- as typed columns AND the whole source row in raw (jsonb), because the source
-- is JSON with real numbers, not an exported text file. row_hash is the
-- sha256 of the canonical JSON of raw.
--
-- Time convention: SupplyNote sends UTC with no zone suffix. The worker adds
-- the zone, so every timestamp here is timestamptz and correct in any zone.
-- Join on ids only, never on outlet or product NAMES (F32, F40).
-- ============================================================

-- ------------------------------------------------------------
-- T1. Product master. One current row per SupplyNote product.
-- ------------------------------------------------------------
create table if not exists landing.supplynote_products (
  id             bigserial primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  product_id     text not null,
  sku_code       text,
  product_title  text,
  category       text,
  sub_category   text,
  base_unit      text,
  brand          text,
  hsn_code       text,
  tax_pct        numeric,
  is_active      boolean,
  raw            jsonb not null,
  row_hash       text not null,
  superseded_by  bigint,
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists supplynote_products_key
  on landing.supplynote_products (product_id) where superseded_at is null;
create index if not exists supplynote_products_sku
  on landing.supplynote_products (sku_code) where superseded_at is null;
comment on table landing.supplynote_products is
  'SupplyNote product master (dataset products). One current row per product_id; a changed product supersedes its old row. sku_code is the code the team uses; product_id is the join key.';

-- ------------------------------------------------------------
-- T2. Stock, once a day per item. This is the history SupplyNote does not
-- keep. snapshot_date is the IST calendar date of the pull. A later pull on
-- the same date supersedes the earlier one, so the current row of a date is
-- the last reading taken that day (the evening run, after the day's entries).
-- ------------------------------------------------------------
create table if not exists landing.supplynote_stock_daily (
  id                           bigserial primary key,
  ingest_run_id                bigint references landing.ingest_runs(id),
  snapshot_date                date not null,
  pulled_at                    timestamptz not null,
  outlet_id                    text not null,
  product_id                   text not null,
  outlet_product_id            text,
  current_stock                numeric,
  last_purchased_price         numeric,
  last_weighted_average_price  numeric,
  is_active                    boolean,
  raw                          jsonb not null,
  row_hash                     text not null,
  superseded_by                bigint,
  superseded_at                timestamptz,
  loaded_at                    timestamptz not null default now()
);
create unique index if not exists supplynote_stock_daily_key
  on landing.supplynote_stock_daily (snapshot_date, outlet_id, product_id) where superseded_at is null;
create index if not exists supplynote_stock_daily_product
  on landing.supplynote_stock_daily (product_id, snapshot_date) where superseded_at is null;
comment on table landing.supplynote_stock_daily is
  'SupplyNote book stock per item per outlet per IST day (dataset outlet-products). Book stock, not a physical count: it can be negative when a delivery is entered late. Quantities are in each product''s base unit and must never be summed across products.';

-- ------------------------------------------------------------
-- T3. Stock movements. One row per ledger entry, keyed on SupplyNote's log_id.
-- quantity_adjusted is signed (negative out, positive in).
-- Consumption rule (ordering-module-plan.md): transaction_type StockOut with
-- reference_no like 'GD-TRN-%'. Receipts: StockIn with reference_no like 'GR-INV%'.
-- transaction_at can be null on a rare malformed source row; it is kept.
-- ------------------------------------------------------------
create table if not exists landing.supplynote_inventory_log (
  id                    bigserial primary key,
  ingest_run_id         bigint references landing.ingest_runs(id),
  log_id                text not null,
  outlet_id             text not null,
  product_id            text not null,
  transaction_at        timestamptz,
  transaction_type      text,
  reason                text,
  wastage_reason        text,
  reference_no          text,
  invoice_id            text,
  quantity_adjusted     numeric,
  stock_before          numeric,
  stock_after           numeric,
  unit_price            numeric,
  weighted_avg_price    numeric,
  is_accounting_update  boolean,
  source_updated_at     timestamptz,
  raw                   jsonb not null,
  row_hash              text not null,
  superseded_by         bigint,
  superseded_at         timestamptz,
  loaded_at             timestamptz not null default now()
);
create unique index if not exists supplynote_inventory_log_key
  on landing.supplynote_inventory_log (log_id) where superseded_at is null;
create index if not exists supplynote_inventory_log_product_time
  on landing.supplynote_inventory_log (outlet_id, product_id, transaction_at) where superseded_at is null;
create index if not exists supplynote_inventory_log_time
  on landing.supplynote_inventory_log (transaction_at) where superseded_at is null;
comment on table landing.supplynote_inventory_log is
  'SupplyNote stock ledger (dataset inventory-log), one row per movement. Times are UTC instants; derive the IST day in the reader. A ledger row should never change; if one does, the old row is superseded and both are kept.';

-- ------------------------------------------------------------
-- T4. Purchase order headers. Carries delivery_due_at, the promised date.
-- SupplyNote flags that must NOT be read at face value (established 8 to 9 Sep 2026):
--   is_open_po   = a PO raised without a named vendor, NOT "still open";
--   is_finished  = a bill exists, NOT "goods received".
-- "Open" is defined by us on the lines: ordered - cancelled - received > 0.
-- ------------------------------------------------------------
create table if not exists landing.supplynote_purchase_orders (
  id                 bigserial primary key,
  ingest_run_id      bigint references landing.ingest_runs(id),
  purchase_order_id  text not null,
  purchase_order_no  text,
  direction          text,
  outlet_id          text,
  outlet_name        text,
  seller_id          text,
  seller_name        text,
  po_saved_at        timestamptz,
  po_dated_at        timestamptz,
  confirmed_at       timestamptz,
  delivery_due_at    timestamptz,
  status             text,
  total_amount       numeric,
  is_open_po         boolean,
  is_closed          boolean,
  is_finished        boolean,
  is_void            boolean,
  source_created_at  timestamptz,
  source_updated_at  timestamptz,
  raw                jsonb not null,
  row_hash           text not null,
  superseded_by      bigint,
  superseded_at      timestamptz,
  loaded_at          timestamptz not null default now()
);
create unique index if not exists supplynote_purchase_orders_key
  on landing.supplynote_purchase_orders (purchase_order_id) where superseded_at is null;
create index if not exists supplynote_purchase_orders_due
  on landing.supplynote_purchase_orders (outlet_id, delivery_due_at) where superseded_at is null;
comment on table landing.supplynote_purchase_orders is
  'SupplyNote purchase order headers (dataset purchase-orders). A changed PO supersedes its old row, so the history of a PO (due date moved, voided, closed) is kept. Do not read is_open_po or is_finished as "open" or "received".';

-- ------------------------------------------------------------
-- T5. Purchase order lines. The quantity chain per item per PO.
-- Quantities are in the line's unit; multiply by unit_conversion for base units.
-- ------------------------------------------------------------
create table if not exists landing.supplynote_purchase_order_lines (
  id                     bigserial primary key,
  ingest_run_id          bigint references landing.ingest_runs(id),
  purchase_order_line_id text not null,
  purchase_order_id      text not null,
  direction              text,
  outlet_id              text,
  product_id             text,
  seller_id              text,
  quantity_ordered       numeric,
  quantity_confirmed     numeric,
  quantity_invoiced      numeric,
  quantity_delivered     numeric,
  quantity_received      numeric,
  quantity_cancelled     numeric,
  quantity_returned      numeric,
  unit                   text,
  base_unit              text,
  unit_conversion        numeric,
  unit_price             numeric,
  tax_pct                numeric,
  raw                    jsonb not null,
  row_hash               text not null,
  superseded_by          bigint,
  superseded_at          timestamptz,
  loaded_at              timestamptz not null default now()
);
create unique index if not exists supplynote_purchase_order_lines_key
  on landing.supplynote_purchase_order_lines (purchase_order_line_id) where superseded_at is null;
create index if not exists supplynote_purchase_order_lines_po
  on landing.supplynote_purchase_order_lines (purchase_order_id) where superseded_at is null;
create index if not exists supplynote_purchase_order_lines_product
  on landing.supplynote_purchase_order_lines (outlet_id, product_id) where superseded_at is null;
comment on table landing.supplynote_purchase_order_lines is
  'SupplyNote purchase order lines (dataset purchase-order-lines, which has no date filter: the worker re-reads the whole outlet each run and supersedes only what changed). Open quantity = (quantity_ordered - quantity_cancelled - quantity_received) x unit_conversion.';

-- Row level security on, no policies: service role only, like every landing table.
alter table landing.supplynote_products             enable row level security;
alter table landing.supplynote_stock_daily          enable row level security;
alter table landing.supplynote_inventory_log        enable row level security;
alter table landing.supplynote_purchase_orders      enable row level security;
alter table landing.supplynote_purchase_order_lines enable row level security;
