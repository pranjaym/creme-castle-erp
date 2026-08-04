-- ============================================================
-- Migration 060: ZOMATO ORDER DETAILS (order-level overlay from the partner dashboard)
-- Target: the spine Supabase project. Additive; only CREATE / ALTER TYPE ADD VALUE.
-- Design doc: erp-plan/zomato-order-details-feed.md (4 Aug 2026). Flags F16 to F19.
--
-- One row per Zomato order per REVISION. The Zomato "Order history" export carries
-- fields that keep changing after the order day (status, ratings, reviews,
-- complaints, phones), so re-pulls SUPERSEDE rather than update: a changed order
-- gets a new row and the old row is stamped superseded_by / superseded_at. Current
-- state = rows where superseded_by is null. Nothing is ever deleted or overwritten.
--
-- row_hash rules (must match workers/zomato-ingest/ingest.py, never change silently):
--   * computed over the 30 raw columns EXCEPT kpt_duration_minutes, which differs
--     wholesale between export runs (F19) and would force a pointless supersede of
--     every row every evening;
--   * items_in_order is canonicalised (items split on comma, sorted) before hashing,
--     because Zomato reorders the item list between runs; the STORED value stays raw;
--   * customer_phone is cleaned of trailing control bytes (0x14) before storing AND
--     hashing.
-- ============================================================

alter type source_system add value if not exists 'zomato';

create table if not exists landing.zomato_order_details (
  id                        bigint generated always as identity primary key,
  ingest_run_id             bigint references landing.ingest_runs(id),
  order_date                date not null,      -- calendar date of order_placed_at (IST);
                                                -- Zomato's export day, NOT the 04:00 rule
  order_placed_at           timestamptz,        -- parsed '12:00 AM, January 01 2026' as IST
  -- the 30 export columns, verbatim as text (raw fidelity, like every landing table)
  restaurant_id             text,
  restaurant_name           text,
  subzone                   text,
  city                      text,
  zomato_order_id           text not null,      -- 'Order ID'
  order_placed_at_raw       text,               -- 'Order Placed At'
  order_status              text,
  delivery                  text,
  distance                  text,
  items_in_order            text,               -- raw string; hash uses sorted items
  instructions              text,
  discount_construct        text,
  bill_subtotal             text,
  packaging_charges         text,
  restaurant_discount_promo text,               -- 'Restaurant discount (Promo)'
  restaurant_discount_flat  text,               -- '(Flat offs, Freebies & others)'
  gold_discount             text,
  brand_pack_discount       text,
  total                     text,
  rating                    text,
  review                    text,
  cancellation_rejection_reason        text,
  restaurant_compensation_cancellation text,
  restaurant_penalty_rejection         text,
  kpt_duration_minutes      text,               -- F19: unstable between runs; NOT hashed,
                                                -- NOT for KPIs until F19 is resolved
  rider_wait_minutes        text,
  order_ready_marked        text,
  customer_complaint_tag    text,
  customer_id               text,               -- Zomato's hashed customer identity
  customer_phone            text,               -- real phone when Zomato shares it
                                                -- (Customer details export); 0x14 stripped
  row_hash                  text not null,
  superseded_by             bigint references landing.zomato_order_details(id),
  superseded_at             timestamptz,
  loaded_at                 timestamptz not null default now()
);

-- Current state must hold ONE row per order. The loader dedupes within a file
-- (keeps the last occurrence; the 7-month sample had exactly 1 in-file duplicate);
-- this index makes any slip loud instead of silent.
--
-- The predicate is superseded_AT, not superseded_BY, deliberately: the loader
-- must free an order's "current" slot BEFORE its replacement row exists (stamp
-- superseded_at, insert the new row, then link superseded_by), because the
-- lineage pointer can only be written once the new id is known. Both stamps are
-- set in the same transaction, so after commit the two predicates agree; the
-- index and views standardise on superseded_at is null.
create unique index if not exists uq_zomato_order_current
  on landing.zomato_order_details (zomato_order_id)
  where superseded_at is null;
create index if not exists idx_zomato_order_date
  on landing.zomato_order_details (order_date);
create index if not exists idx_zomato_order_customer
  on landing.zomato_order_details (customer_id)
  where superseded_at is null;

-- Settling-horizon measurement (feed doc section 6): every pull logs, per order
-- date in its window, how many orders were new, changed (superseded), unchanged.
-- After ~2 weeks this table says how many trailing days actually still change,
-- and the pull window is tightened to match (Pranjay expects ~3).
create table if not exists landing.zomato_change_log (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  pull_date      date not null,
  order_date     date not null,
  new_rows       int not null default 0,
  changed_rows   int not null default 0,
  unchanged_rows int not null default 0,
  loaded_at      timestamptz not null default now()
);
create index if not exists idx_zomato_change_log_dates
  on landing.zomato_change_log (pull_date, order_date);

-- Portal download view, same contract as the Petpooja report views (051):
-- current rows only, service_role only.
create or replace view public.v_report_zomato_order_details as
  select id, order_date, order_placed_at, restaurant_id, restaurant_name, subzone, city,
         zomato_order_id, order_status, delivery, distance, items_in_order, instructions,
         discount_construct, bill_subtotal, packaging_charges, restaurant_discount_promo,
         restaurant_discount_flat, gold_discount, brand_pack_discount, total, rating, review,
         cancellation_rejection_reason, restaurant_compensation_cancellation,
         restaurant_penalty_rejection, kpt_duration_minutes, rider_wait_minutes,
         order_ready_marked, customer_complaint_tag, customer_id, customer_phone
  from landing.zomato_order_details
  where superseded_at is null;

revoke all on public.v_report_zomato_order_details from anon, authenticated;
grant select on public.v_report_zomato_order_details to service_role;
