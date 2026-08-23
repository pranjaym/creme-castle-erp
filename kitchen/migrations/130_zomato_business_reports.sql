-- ============================================================
-- Migration 130: ZOMATO ENTERPRISE BUSINESS REPORTS
-- Target: the spine Supabase project. Additive only (CREATE ... IF NOT EXISTS).
-- Design docs: erp-plan/zomato-business-reports-catalogue.md (21 Aug 2026)
--              erp-plan/zomato-spine-tables-proposal.md
--
-- Source: the enterprise console at zomato.com/partners/business/, which is a
-- DIFFERENT surface from the order-history page behind landing.zomato_order_details
-- (migration 060). Reports are requested in the UI, emailed to the account, and
-- fetched from a 3-hour presigned S3 link. Six report shapes per window:
--   order level, segment cube, ads-by-spending-potential, ads-by-NRL,
--   quality cube (emailed), and Track ads (direct download).
--
-- Conventions inherited from 060, deliberately unchanged:
--   * landing schema, every source column stored as TEXT (raw fidelity);
--   * ingest_run_id references landing.ingest_runs (no new lineage table needed);
--   * re-pulls SUPERSEDE, never update: changed row gets a new row, the old row is
--     stamped superseded_at then superseded_by. Current state = superseded_at is null.
--     Nothing is ever deleted (CLAUDE.md rule 6);
--   * unique partial index on the natural key where superseded_at is null, so a
--     loader slip is loud instead of silent.
--
-- LOADER CONTRACTS that this schema assumes (catalogue doc section 12, and
-- zomato-spine-tables-proposal.md section 3). Breaking any of these silently
-- corrupts the table:
--   1. The quality cube's source file has 108 physical columns but only 106
--      distinct names: "Poor packaging or spillage" and "Others complaints" each
--      appear TWICE, once for all orders and once inside the large-orders block.
--      PARSE IT POSITIONALLY. A name-keyed reader drops two real columns.
--      The 28 columns kept here are source positions 45-49, 51-53, 55-69, 75-79.
--   2. Order-level timestamps are suffixed "+0000 UTC" and are NOT UTC. They are
--      IST. (placed_at peaks 20:00-23:00, empties 02:00-06:00.) The raw string is
--      stored verbatim; *_ist columns carry the parsed value.
--   3. Item lines are parsed out of items_in_order, whose item names contain square
--      brackets ("Overload Brownie [1 Pc]"), so the parser must handle nesting. On
--      every load, sum(quantity * unit_cost) must equal order_subtotal.
--   4. "Net sales" is two different things: the cube's excludes packaging, the order
--      file's net_order_value includes it. Never mix them.
--   5. food_prep_time units are UNKNOWN (fractional, against a dashboard reporting
--      "1 min"). Stored, but not for KPIs until two consecutive pulls agree (F19).
--   6. The grid is SPARSE. Rows exist only from an outlet's live date. Never dense
--      cross join outlets against dates.
--
-- Columns that arrive but carry no information today (kept, never dropped, because
-- Zomato may start populating them): order level review, refund_amount_requested,
-- winback_coupon_given, customer_offer_sensitivity, gold_discount, discount_construct,
-- winback_discount, other_service_fee_deduction, menu_open_source. Also rejected_by,
-- which is present but WRONG (reads "Mx rejected" on delivered orders).
--
-- One metric, "Total restaurant discount", is selectable in Zomato's picker but is
-- absent from every output shape. There is no column for it because it never arrives.
-- ============================================================

-- ------------------------------------------------------------
-- T1. Order grain, one row per Zomato order per revision. 53 source columns.
-- ------------------------------------------------------------
create table if not exists landing.zomato_business_order (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,          -- source dt, the Zomato report day
  zomato_order_id text not null,
  restaurant_id  text not null,
  placed_at_ist  timestamptz,             -- parsed placed_at, see contract 2
  mealtime       text,                    -- derived from placed_at_ist, not sourced
  line_count     int,                     -- derived, count of parsed item lines
  dt                                     text,   -- dt
  order_id                               text,   -- order_id
  res_id                                 text,   -- res_id
  res_name                               text,   -- res_name
  subzone                                text,   -- subzone
  city                                   text,   -- city
  delivery_mode                          text,   -- delivery_mode
  order_state                            text,   -- order_state
  items_in_order                         text,   -- items_in_order
  placed_at                              text,   -- placed_at
  accepted_at                            text,   -- accepted_at
  dp_assigned_at                         text,   -- dp_assigned_at
  food_ready_market_at                   text,   -- food_ready_market_at
  rider_reached_outlet_at                text,   -- rider_reached_outlet_at
  rider_arrived_at                       text,   -- rider_arrived_at
  picked_up_at                           text,   -- picked_up_at
  delivered_at                           text,   -- delivered_at
  expected_food_prep_time                text,   -- expected_food_prep_time
  food_prep_time                         text,   -- food_prep_time
  food_prep_delay                        text,   -- food_prep_delay
  handover_time                          text,   -- handover_time
  rejected_at                            text,   -- rejected_at
  rejected_by                            text,   -- rejected_by
  rejection_reason                       text,   -- rejection_reason
  order_rating                           text,   -- order_rating
  review                                 text,   -- review
  complaint_on_order                     text,   -- complaint_on_order
  complaint_reason                       text,   -- complaint_reason
  refund_amount_requested                text,   -- refund_amount_requested
  refund_amount_agreed                   text,   -- refund_amount_agreed
  winback_coupon_given                   text,   -- winback_coupon_given
  customer_name                          text,   -- customer_name
  customer_order_count                   text,   -- customer_order_count
  customer_last_order_date               text,   -- customer_last_order_date
  customer_locality                      text,   -- customer_locality
  distance                               text,   -- distance
  customer_offer_sensitivity             text,   -- customer_offer_sensitivity
  compensation_for_customer_cancellation text,   -- compensation_for_customer_cancellation
  order_subtotal                         text,   -- order_subtotal
  packaging_cost                         text,   -- packaging_cost
  net_order_value                        text,   -- net_order_value
  res_discount_promo                     text,   -- res_discount_promo
  promo_code                             text,   -- promo_code
  gold_discount                          text,   -- gold_discount
  discount_construct                     text,   -- discount_construct
  res_discount_item_level                text,   -- res_discount_item_level
  winback_discount                       text,   -- winback_discount
  service_fee                            text,   -- service_fee
  pg_fee                                 text,   -- pg_fee
  other_service_fee_deduction            text,   -- other_service_fee_deduction
  ads_campaign_order                     text,   -- ads_campaign_order
  campaign_id                            text,   -- campaign_id
  menu_open_source                       text,   -- menu_open_source
  row_hash       text not null,
  superseded_by  bigint references landing.zomato_business_order(id),
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_zomato_business_order_current
  on landing.zomato_business_order (zomato_order_id)
  where superseded_at is null;
create index if not exists idx_zbo_date on landing.zomato_business_order (business_date);
create index if not exists idx_zbo_outlet on landing.zomato_business_order (restaurant_id, business_date);
create index if not exists idx_zbo_campaign on landing.zomato_business_order (campaign_id)
  where superseded_at is null;

-- ------------------------------------------------------------
-- T2. Order-line grain, parsed out of items_in_order (contract 3).
--     pos_item_id is the Petpooja item id: this is the join that flag F18 wants.
--     Keys are per outlet listing, so the item dimension is (restaurant_id, pos_item_id),
--     with item_name as the roll-up. 96 distinct names produced 2,093 pos_item_ids
--     over two days.
-- ------------------------------------------------------------
create table if not exists landing.zomato_business_order_item (
  id                bigint generated always as identity primary key,
  ingest_run_id     bigint references landing.ingest_runs(id),
  business_date     date not null,
  zomato_order_id   text not null,
  restaurant_id     text not null,
  line_no           int  not null,        -- position within items_in_order, 1-based
  catalogue_id      text,
  pos_item_id       text,                 -- Petpooja item id
  item_name         text,
  item_category     text,
  item_sub_category text,
  item_quantity     text,
  item_unit_cost    text,
  line_value        numeric,              -- derived, quantity * unit_cost
  row_hash          text not null,
  superseded_by     bigint references landing.zomato_business_order_item(id),
  superseded_at     timestamptz,
  loaded_at         timestamptz not null default now()
);
create unique index if not exists uq_zomato_business_order_item_current
  on landing.zomato_business_order_item (zomato_order_id, line_no)
  where superseded_at is null;
create index if not exists idx_zboi_positem on landing.zomato_business_order_item (restaurant_id, pos_item_id)
  where superseded_at is null;
create index if not exists idx_zboi_date on landing.zomato_business_order_item (business_date);

-- ------------------------------------------------------------
-- T3. Outlet x date x NRL x offer sensitivity x mealtime. 58 metrics.
-- The finest grain the aggregates offer for sales, funnel, menu sources, offers,
-- large orders. Weekly and monthly cubes are NOT stored: they roll up from here.
-- ------------------------------------------------------------
create table if not exists landing.zomato_outlet_day_segment (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date     date not null,
  restaurant_id     text not null,
  nrl_segment       text not null,        -- New / Repeat / Lapsed customer
  offer_sensitivity text not null,        -- Highly / Medium / Low offer sensitive
  mealtime          text not null,        -- Breakfast / Lunch / Snacks / Dinner / Late night
  subtotal_value                              text,   -- Subtotal value
  net_sales                                   text,   -- Net sales
  orders_received                             text,   -- Orders received
  delivered_orders                            text,   -- Delivered orders
  average_subtotal_value_asv                  text,   -- Average subtotal value (ASV)
  average_order_value_aov                     text,   -- Average order value (AOV)
  items_per_order                             text,   -- Items per order
  sales_per_outlet                            text,   -- Sales per outlet
  orders_per_outlet                           text,   -- Orders per outlet
  packaging_charges                           text,   -- Packaging charges
  gross_sales_from_offers                     text,   -- Gross sales from offers
  impressions                                 text,   -- Impressions
  menu_opens                                  text,   -- Menu opens
  cart_builds                                 text,   -- Cart builds
  orders_placed                               text,   -- Orders placed
  impression_to_menu_i2m_pct                  text,   -- Impression to menu (I2M) (%)
  menu_to_order_m2o_pct                       text,   -- Menu to order (M2O) (%)
  menu_to_cart_m2c_pct                        text,   -- Menu to cart (M2C) (%)
  cart_to_order_c2o_pct                       text,   -- Cart to order (C2O) (%)
  pct_gross_sales_from_offers                 text,   -- % gross sales from offers
  brand_search                                text,   -- Brand search
  recommended_for_you                         text,   -- Recommended for you
  dish_or_cuisine_search                      text,   -- Dish/cuisine search
  homepage_listing                            text,   -- Homepage listing
  offers_page                                 text,   -- Offers page
  campaign_page                               text,   -- Campaign page
  other_menu_open_sources                     text,   -- Other menu open sources
  orders_with_offers                          text,   -- Orders with offers
  pct_orders_with_offers                      text,   -- % orders with offers
  effective_discount_pct                      text,   -- Effective discount (%)
  discount_given_per_order                    text,   -- Discount given per order
  orders_from_dotd                            text,   -- Orders from DOTD
  total_dotd_discount                         text,   -- Total DOTD discount
  net_sales_from_dotd                         text,   -- Net sales from DOTD
  orders_from_flash_sale                      text,   -- Orders from Flash Sale
  total_flash_sale_discount                   text,   -- Total flash sale discount
  net_sales_from_flash_sale                   text,   -- Net sales from Flash Sale
  mx_refund_amount                            text,   -- mx_refund_amount
  total_number_of_outlets                     text,   -- Total number of outlets
  promo_discount                              text,   -- Promo Discount
  dish_discounts                              text,   -- Dish discounts
  bogo_discount                               text,   -- BOGO discount
  freebie                                     text,   -- Freebie
  gold_discount                               text,   -- Gold Discount
  net_sales_from_large_orders                 text,   -- Net sales from large orders
  delivered_large_orders                      text,   -- Delivered large orders
  average_large_order_value                   text,   -- Average large order value
  rejected_large_orders_pct                   text,   -- Rejected large orders (%)
  average_large_order_kpt                     text,   -- Average large order KPT
  kpt_delayed_large_orders_pct                text,   -- KPT delayed large orders (%)
  average_food_order_rating_for_large_orders  text,   -- Average food order rating for large orders
  percentage_complaints_from_large_orders_pct text,   -- Percentage complaints from large orders (%)
  complaints_from_large_orders                text,   -- Complaints from large orders
  missing_item_s                              text,   -- Missing item(s)
  poor_packaging_or_spillage                  text,   -- Poor packaging or spillage
  poor_quality                                text,   -- Poor quality
  wrong_order_s                               text,   -- Wrong order(s)
  others_complaints                           text,   -- Others complaints
  row_hash       text not null,
  superseded_by  bigint references landing.zomato_outlet_day_segment(id),
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_zomato_outlet_day_segment_current
  on landing.zomato_outlet_day_segment (restaurant_id, business_date, nrl_segment, offer_sensitivity, mealtime)
  where superseded_at is null;
create index if not exists idx_zods_date on landing.zomato_outlet_day_segment (business_date);

-- ------------------------------------------------------------
-- T4. Outlet x date x customer segment, ads only. 14 metrics, TWO segment types.
-- Ads split by NRL and ads split by spending potential are different cuts and
-- NEITHER derives the other, so both are loaded here (proposal section 4a).
-- ------------------------------------------------------------
create table if not exists landing.zomato_outlet_day_ads_segment (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,
  restaurant_id  text not null,
  segment_type   text not null,           -- 'spending_potential' | 'nrl'
  segment_value  text not null,           -- Economical/Standard/Premium, or New/Repeat/Lapsed
  ad_impressions                  text,   -- Ad impressions
  ad_click_through_rate_pct       text,   -- Ad click through rate (%)
  ad_menu_opens                   text,   -- Ad menu opens
  ad_menu_to_order_pct            text,   -- Ad menu to order (%)
  ad_menu_to_cart_pct             text,   -- Ad menu to cart (%)
  ad_cart_to_order_pct            text,   -- Ad cart to order (%)
  ad_spends_per_order             text,   -- Ad spends per order
  net_sales_from_ads              text,   -- Net sales from ads
  pct_net_sales_from_ads          text,   -- % net sales from ads
  orders_from_ads                 text,   -- Orders from ads
  pct_orders_from_ads             text,   -- % orders from ads
  ad_spends                       text,   -- Ad spends
  ad_roi                          text,   -- Ad ROI
  ad_spends_as_a_percentage_of_cv text,   -- Ad spends as a percentage of CV
  row_hash       text not null,
  superseded_by  bigint references landing.zomato_outlet_day_ads_segment(id),
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_zomato_outlet_day_ads_segment_current
  on landing.zomato_outlet_day_ads_segment (restaurant_id, business_date, segment_type, segment_value)
  where superseded_at is null;
create index if not exists idx_zodas_date on landing.zomato_outlet_day_ads_segment (business_date);

-- ------------------------------------------------------------
-- T5. Outlet x date. ONLY the 28 metrics that exist in no other shape:
-- 23 service quality + 5 kitchen efficiency. Source positions 45-49, 51-53, 55-69,
-- 75-79 (contract 1: positional). The other 72 metrics in that file are discarded
-- after the reconciliation check in landing.zomato_recon_log.
-- ------------------------------------------------------------
create table if not exists landing.zomato_outlet_day_quality (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,
  restaurant_id  text not null,
  average_food_order_rating                 text,   -- Average Food order rating
  poor_rated_orders_pct                     text,   -- Poor rated orders (%)
  rejected_orders_pct                       text,   -- Rejected orders (%)
  complaints_pct                            text,   -- Complaints (%)
  refunded_complaints                       text,   -- Refunded complaints
  pct_restaurant_refunded_amount            text,   -- % Restaurant refunded amount
  customer_cancellation_pct                 text,   -- Customer cancellation (%)
  online_time_pct                           text,   -- Online time (%)
  total_rejected_orders                     text,   -- Total Rejected Orders
  item_out_of_stock                         text,   -- Item out of stock
  kitchen_is_full                           text,   -- Kitchen is full
  outlet_closed                             text,   -- Outlet closed
  timeout                                   text,   -- Timeout
  device_issues                             text,   -- Device issues
  others_rejected_orders                    text,   -- Others rejected orders
  total_complaints                          text,   -- Total Complaints
  poor_taste_or_quality                     text,   -- Poor taste/quality
  wrong_item_s_delivered                    text,   -- Wrong item(s) delivered
  poor_packaging_or_spillage                text,   -- Poor packaging or spillage
  item_s_missing_or_not_delivered           text,   -- Item(s) missing or not delivered
  kpt_delay                                 text,   -- KPT delay
  others_complaints                         text,   -- Others complaints
  offline_time                              text,   -- Offline time
  average_kitchen_preparation_time          text,   -- Average kitchen preparation time
  kpt_10_plus_mins_delayed_orders           text,   -- KPT 10+ mins delayed orders
  food_order_ready_accuracy_pct             text,   -- Food order ready accuracy (%)
  for_marked_ratio                          text,   -- for_marked_ratio
  orders_with_3_plus_mins_handover_time_pct text,   -- Orders with 3+ mins handover time (%)
  row_hash       text not null,
  superseded_by  bigint references landing.zomato_outlet_day_quality(id),
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_zomato_outlet_day_quality_current
  on landing.zomato_outlet_day_quality (restaurant_id, business_date)
  where superseded_at is null;
create index if not exists idx_zodq_date on landing.zomato_outlet_day_quality (business_date);

-- ------------------------------------------------------------
-- T6. Campaign x date, from Track ads ("Group data by: Dates"). Direct download,
--     no email step. Campaign identity, targeting and budget exist nowhere else.
-- ------------------------------------------------------------
create table if not exists landing.zomato_ad_campaign_day (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,
  campaign_id    text not null,
  campaign_type  text,        -- Branding On Search / Visits Pack / Res Onboarding / ...
  restaurant_id  text,
  status         text,        -- Active / Paused / Stopped / Completed / Pending / Scheduled
  source         text,        -- BOS Bidding / Ads Studio V2 / Ads Studio Single
  source_id      text,
  targeting      text,        -- keyword, or an audience such as "All customers"
  start_date     text,
  end_date       text,
  cpx            text,
  budget         text,
  roi            text,
  sales          text,
  spends         text,
  impressions    text,
  i2m            text,
  menu_opens     text,
  m2o            text,
  orders         text,
  row_hash       text not null,
  superseded_by  bigint references landing.zomato_ad_campaign_day(id),
  superseded_at  timestamptz,
  loaded_at      timestamptz not null default now()
);
create unique index if not exists uq_zomato_ad_campaign_day_current
  on landing.zomato_ad_campaign_day (campaign_id, business_date)
  where superseded_at is null;
create index if not exists idx_zacd_date on landing.zomato_ad_campaign_day (business_date);

-- ------------------------------------------------------------
-- T7. Outlet dimension, slowly changing. NOT optional: the outlet count moved
--     44 -> 45 -> 46 inside the sample files, and ten outlets do not exist before
--     February 2026. Without first_seen_date every new outlet reads as two years
--     of zero sales (contract 6).
-- ------------------------------------------------------------
create table if not exists landing.zomato_outlet (
  restaurant_id   text primary key,
  restaurant_name text,
  subzone         text,
  city            text,
  brand_id        text,
  brand_name      text,
  first_seen_date date,
  last_seen_date  date,
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Reconciliation log. The quality cube is pulled whole, and 72 of its metrics
-- duplicate what the segment and ads cubes already carry at a finer grain. Those
-- duplicates are not stored; instead every load compares them against the summed
-- cubes and records the difference here. If it ever stops being zero, one of the
-- two cubes is lying and we want the date it started.
-- Ratios are recomputed from their count and value bases, never averaged.
-- ------------------------------------------------------------
create table if not exists landing.zomato_recon_log (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  business_date  date not null,
  restaurant_id  text not null,
  metric         text not null,
  cube_value     numeric,     -- as reported by the no-breakdown quality file
  summed_value   numeric,     -- as summed from the segment / ads cubes
  delta          numeric,
  loaded_at      timestamptz not null default now()
);
create index if not exists idx_zrl_date on landing.zomato_recon_log (business_date, restaurant_id);
create index if not exists idx_zrl_nonzero on landing.zomato_recon_log (business_date)
  where delta <> 0;

-- ------------------------------------------------------------
-- Settling-horizon log, same purpose and shape as landing.zomato_change_log (060):
-- how many rows each pull found new / changed / unchanged, per shape and per day,
-- so the pull window can be tightened to the days that actually still move.
-- ------------------------------------------------------------
create table if not exists landing.zomato_business_change_log (
  id             bigint generated always as identity primary key,
  ingest_run_id  bigint references landing.ingest_runs(id),
  report_shape   text not null,   -- order | order_item | segment | ads_segment | quality | campaign
  pull_date      date not null,
  business_date  date not null,
  new_rows       int not null default 0,
  changed_rows   int not null default 0,
  unchanged_rows int not null default 0,
  loaded_at      timestamptz not null default now()
);
create index if not exists idx_zbcl_dates
  on landing.zomato_business_change_log (pull_date, business_date, report_shape);
