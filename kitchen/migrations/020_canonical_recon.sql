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
