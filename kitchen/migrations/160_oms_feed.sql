-- ============================================================
-- Migration 160: THE OMS TO SPINE FEED (wide feed: headers, items, customers)
-- Target: the spine Supabase project. Additive, plus one constraint swap on
-- core.order_items (unique key becomes per-source) and a replace of
-- core.refresh_orders to derive OMS orders into core.
--
-- Design doc: erp-plan/oms-spine-feed-spec.md (21 Aug 2026, decisions resolved
-- 23 Aug 2026, built 24 Aug 2026 on Pranjay's go-ahead).
--
-- This is NOT the Build 1a recon feed. landing.oms_orders and its worker
-- pull_oms_orders.mjs stay untouched (spec section 1): that feed is delivery
-- date based and pre-aggregated for reconciliation. This feed is placed-date
-- based, full fidelity, and follows the zomato_order_details supersede shape:
-- append only, no hard deletes, a changed order gets a new row and the old row
-- is stamped superseded_by / superseded_at. Current state = superseded_at null.
--
-- row_hash rules (must match workers/oms-feed/pull_oms_feed.mjs, never change
-- silently): sha256 over the landed source columns in fixed order, nulls as
-- empty string, timestamps in ISO UTC. Excluded from the hash:
--   * header: updated_at_oms (churns without a business change);
--   * customer: order_count, last_order_at (derived counters that move on
--     every order and would supersede active customers daily, the F19 lesson).
-- Excluded columns are still stored.
--
-- Backfill floor for orders: 1 August 2026 (spec section 2/9: earlier D2C
-- was invoiced in Petpooja and already lives in the spine's POS rows).
-- Customers have no floor: all OMS customers feed identity, which attaches
-- people to orders and cannot double count revenue.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Landing: order headers, one row per OMS order per revision.
--    Columns mirror the LIVE OMS orders table (24 Aug 2026), which is wider
--    than the repo schema.sql (discount_amount, deposits, refunds, etc.).
--    OMS uuid columns (actors) are landed as text; no FK into a foreign
--    project's auth schema is possible or wanted.
-- ------------------------------------------------------------

create table if not exists landing.oms_order_header (
  id                       bigint generated always as identity primary key,
  ingest_run_id            bigint references landing.ingest_runs(id),
  oms_order_id             bigint not null,          -- orders.id in the OMS
  business_date            date not null,            -- date(placed_at) in IST (spec section 6)
  source                   text,                     -- shopify | whatsapp | b2b
  shopify_order_id         bigint,
  shopify_name             text,                     -- '#171643'
  legacy_retool_id         bigint,
  corporate_account_id     integer,
  oms_customer_id          bigint,                   -- customers.id in the OMS
  outlet_id                integer,
  outlet_code              text,                     -- denormalised from outlets.code at pull time
  status                   text,
  placed_at                timestamptz,
  delivery_date            date,
  slot_start               time,
  slot_end                 time,
  slot_text                text,
  address_line             text,
  area                     text,
  city                     text,
  pincode                  text,
  customer_name            text,
  customer_mobile          text,
  item_count               integer,
  total_amount             numeric,
  advance_amount           numeric,
  is_prepaid               boolean,
  attribution              jsonb,
  notes                    text,
  modifications            text,
  requires_skill           boolean,
  accepted_at              timestamptz,
  accepted_by              text,
  cancelled_at             timestamptz,
  cancelled_by             text,
  cancel_reason            text,
  created_by               text,
  created_at_oms           timestamptz,
  updated_at_oms           timestamptz,              -- stored, NOT hashed
  unacked_edit             boolean,
  attention_reason         text,
  edited_fields            jsonb,
  is_complimentary         boolean,
  complimentary_reason     text,
  discount_amount          numeric,
  deposit_amount           numeric,
  deposit_note             text,
  deposit_returned         numeric,
  deposit_returned_at      timestamptz,
  deposit_returned_by      text,
  refunded_amount          numeric,
  refunded_at              timestamptz,
  discount_note            text,
  b2b_doc_type             text,
  discount_origin_order_id bigint,
  row_hash                 text not null,
  superseded_by            bigint references landing.oms_order_header(id),
  superseded_at            timestamptz,
  loaded_at                timestamptz not null default now()
);

-- Same current-slot contract as landing.zomato_order_details: the predicate is
-- superseded_AT because the loader stamps the old row before the new id exists.
create unique index if not exists uq_oms_header_current
  on landing.oms_order_header (oms_order_id)
  where superseded_at is null;
create index if not exists idx_oms_header_business_date
  on landing.oms_order_header (business_date);
create index if not exists idx_oms_header_delivery_date
  on landing.oms_order_header (delivery_date);
create index if not exists idx_oms_header_customer
  on landing.oms_order_header (oms_customer_id)
  where superseded_at is null;

-- ------------------------------------------------------------
-- 2. Landing: order items, one row per OMS order_items row per revision.
--    An item removed from an order in the OMS is stamped superseded_at with
--    no successor (it stopped existing); it never disappears from landing.
-- ------------------------------------------------------------

create table if not exists landing.oms_order_item (
  id                  bigint generated always as identity primary key,
  ingest_run_id       bigint references landing.ingest_runs(id),
  oms_item_id         bigint not null,               -- order_items.id in the OMS
  oms_order_id        bigint not null,
  sku                 text,
  product_title       text,
  variant_title       text,
  flavour             text,
  weight_kg           numeric,
  weight_text         text,
  egg_option          text,
  quantity            integer,
  unit_price          numeric,
  line_total          numeric,
  cake_message        text,
  reference_image_url text,
  item_delivery_date  date,
  item_slot_text      text,
  notes               text,
  delivery_id         bigint,
  catalog_price       numeric,
  item_address_line   text,
  item_area           text,
  item_pincode        text,
  item_contact_name   text,
  item_contact_phone  text,
  row_hash            text not null,
  superseded_by       bigint references landing.oms_order_item(id),
  superseded_at       timestamptz,
  loaded_at           timestamptz not null default now()
);

create unique index if not exists uq_oms_item_current
  on landing.oms_order_item (oms_item_id)
  where superseded_at is null;
create index if not exists idx_oms_item_order
  on landing.oms_order_item (oms_order_id)
  where superseded_at is null;

-- ------------------------------------------------------------
-- 3. Landing: customers, one row per OMS customer per revision. No date
--    floor: all of them feed identity. addresses is the customer's
--    customer_addresses rows as a json array, ordered by id, captured at
--    pull time (kept out of a fourth table on purpose; the spec names three).
-- ------------------------------------------------------------

create table if not exists landing.oms_customer (
  id                   bigint generated always as identity primary key,
  ingest_run_id        bigint references landing.ingest_runs(id),
  oms_customer_id      bigint not null,              -- customers.id in the OMS
  primary_mobile       text,                         -- OMS-normalised 10 digit mobile
  name                 text,
  email                text,
  alt_mobile           text,
  first_source         text,
  created_at_oms       timestamptz,
  order_count          integer,                      -- stored, NOT hashed (derived counter)
  last_order_at        date,                         -- stored, NOT hashed (derived counter)
  first_touch_channel  text,
  first_touch_source   text,
  first_touch_medium   text,
  first_touch_campaign text,
  first_touch_at       timestamptz,
  first_touch_order_id bigint,
  addresses            jsonb,
  row_hash             text not null,
  superseded_by        bigint references landing.oms_customer(id),
  superseded_at        timestamptz,
  loaded_at            timestamptz not null default now()
);

create unique index if not exists uq_oms_customer_current
  on landing.oms_customer (oms_customer_id)
  where superseded_at is null;
create index if not exists idx_oms_customer_mobile
  on landing.oms_customer (primary_mobile)
  where superseded_at is null;

-- ------------------------------------------------------------
-- 4. Feed cursor: the highest order_events.id already consumed (spec
--    section 4). One row, updated only after a fully successful pull, so a
--    partial run reprocesses rather than skips (the landing is idempotent).
-- ------------------------------------------------------------

create table if not exists landing.oms_feed_state (
  id            smallint primary key default 1 check (id = 1),
  last_event_id bigint not null default 0,
  updated_at    timestamptz not null default now()
);
insert into landing.oms_feed_state (id, last_event_id)
  values (1, 0) on conflict (id) do nothing;

-- Landing stays private (same stance as 070): RLS on, zero policies. The
-- worker connects as the owner over the pooler; PostgREST roles see nothing.
alter table landing.oms_order_header enable row level security;
alter table landing.oms_order_item enable row level security;
alter table landing.oms_customer enable row level security;
alter table landing.oms_feed_state enable row level security;

-- ------------------------------------------------------------
-- 5. Outlet mapping: code-keyed alias rows. The full-name system='oms' alias
--    rows already exist (inserted 23 Aug 2026); the OMS feed speaks short
--    codes, so the codes get their own rows. The OMS derive step joins
--    location_aliases WITH system='oms' explicitly; these bare codes are
--    never consulted by core.map_location's callers (Petpooja and Zomato
--    names are full strings). Meerut stays out: absent from the OMS (F5,
--    marked inactive 23 Aug 2026).
-- ------------------------------------------------------------

insert into public.location_aliases (location_id, system, external_name, note)
select v.location_id, 'oms', v.code, v.note
from (values
  (25, 'SPJ', 'OMS outlet code SPJ = CC-DL-Shahpurjat. D2C dark store. Spec section 7, resolved 23 Aug 2026.'),
  (28, 'FBD', 'OMS outlet code FBD = CC-FBD-Sector 15. D2C dark store. Spec section 7, resolved 23 Aug 2026.'),
  (47, 'GN',  'OMS outlet code GN = CC-ND-Alpha 2 (Greater Noida). D2C dark store. Spec section 7, resolved 23 Aug 2026.'),
  (8,  'ND',  'OMS outlet code ND = SK-ND-Sector 67, custom cake kitchen of the D2C business. Spec section 7, resolved 23 Aug 2026.'),
  (9,  'DL',  'OMS outlet code DL = SK-DL-Janakpuri, custom cake kitchen of the D2C business. Spec section 7, resolved 23 Aug 2026.'),
  (10, 'GGN', 'OMS outlet code GGN = SK-GGN-Sikanderpur, custom cake kitchen of the D2C business. Spec section 7, resolved 23 Aug 2026.')
) as v(location_id, code, note)
where not exists (
  select 1 from public.location_aliases a
  where a.system = 'oms' and a.external_name = v.code);

-- ------------------------------------------------------------
-- 6. Core: the OMS lands as a third source. business_date is the placed
--    date (finance basis); the fulfilment day gets its own new column,
--    null for every existing row and every aggregator order (spec section 6).
-- ------------------------------------------------------------

alter table core.orders drop constraint if exists orders_source_check;
alter table core.orders add constraint orders_source_check
  check (source in ('online_report', 'pos_items_only', 'oms'));

alter table core.orders add column if not exists fulfilment_date date;
create index if not exists core_orders_fulfilment_idx
  on core.orders (fulfilment_date) where fulfilment_date is not null;

create unique index if not exists core_orders_oms_uq
  on core.orders (landing_order_id) where source = 'oms';

-- core.order_items: landing item ids from two different landing tables can
-- collide, so the unique key becomes (item_source, landing_item_id).
alter table core.order_items
  add column if not exists item_source text not null default 'petpooja';
alter table core.order_items drop constraint if exists order_items_landing_item_id_key;
create unique index if not exists core_items_source_landing_uq
  on core.order_items (item_source, landing_item_id);

alter table core.refresh_runs add column if not exists orders_oms integer;

-- ------------------------------------------------------------
-- 7. core.refresh_orders: identical to the live version (verified against
--    the database 24 Aug 2026) plus step 9, the OMS derive. OMS volume is
--    small (a few thousand orders in scope), so step 9 re-derives ALL OMS
--    rows on every refresh regardless of the window: cancellation fidelity
--    and idempotency without window edge cases. Revisit if source = 'oms'
--    ever grows past a few hundred thousand rows.
-- ------------------------------------------------------------

create or replace function core.refresh_orders(p_days_back integer default 11)
returns bigint
language plpgsql as $$
declare
  v_run_id bigint;
  v_from date;
  v_orders_online integer := 0;
  v_orders_pos integer := 0;
  v_orders_oms integer := 0;
  v_items integer := 0;
  v_orphans integer := 0;
  v_exc integer := 0;
  n integer;
begin
  -- One refresh at a time; a second caller queues behind the first.
  perform pg_advisory_xact_lock(hashtext('core.refresh_orders'));

  v_from := case when p_days_back is null then date '2024-01-01'
                 else current_date - p_days_back end;

  insert into core.refresh_runs (window_from, full_rebuild)
  values (v_from, p_days_back is null)
  returning id into v_run_id;

  delete from core.order_items where business_date >= v_from;
  delete from core.orders where business_date >= v_from;

  -- 1. Online orders from the Petpooja online order report.
  insert into core.orders (source, channel, location_id, outlet_raw, business_date,
    invoice_no, aggregator_order_no, landing_order_id, order_ts_raw, order_type,
    payment_type, status, customer_name, customer_phone_raw, subtotal,
    discount_total, charges_total, order_total, cancelled_by, cancel_reason)
  select 'online_report', o.order_from, core.map_location(o.outlet_name),
    o.outlet_name, o.business_date,
    nullif(trim(o.pos_invoice_no), ''), nullif(trim(o.aggregator_order_no), ''),
    o.id, o.order_date, o.order_type, o.payment_type, o.status,
    nullif(trim(o.customer_name), ''), nullif(trim(o.customer_phone), ''),
    core.to_num(o.my_amount),
    coalesce(core.to_num(o.aggregator_discount), 0) + coalesce(core.to_num(o.outlet_discount), 0),
    coalesce(core.to_num(o.delivery_charges), 0) + coalesce(core.to_num(o.container_charges), 0)
      + coalesce(core.to_num(o.additional_charge), 0),
    core.to_num(o.total), o.cancelled_by, o.reason
  from landing.petpooja_online_orders o
  where o.voided_at is null and o.business_date >= v_from;
  get diagnostics v_orders_online = row_count;

  -- 2. Zomato enrichment via the aggregator order number.
  update core.orders c set
    zomato_customer_id = z.cid, zomato_subzone = z.subzone, zomato_city = z.city,
    zomato_rating = z.rating, zomato_review = z.review,
    zomato_complaint_tag = z.tag, zomato_discount_construct = z.disc
  from (
    select distinct on (zomato_order_id) zomato_order_id,
      nullif(trim(customer_id), '') as cid, nullif(trim(subzone), '') as subzone,
      nullif(trim(city), '') as city, core.to_num(rating) as rating,
      nullif(trim(review), '') as review,
      nullif(trim(customer_complaint_tag), '') as tag,
      nullif(trim(discount_construct), '') as disc
    from landing.zomato_order_details
    where superseded_by is null and order_date >= v_from - 2
    order by zomato_order_id, loaded_at desc
  ) z
  where c.business_date >= v_from and c.channel = 'Zomato'
    and c.aggregator_order_no = z.zomato_order_id;

  -- 3. Item groups from the item report.
  create temp table _grp on commit drop as
  select s.restaurant_name, s.business_date, nullif(trim(s.invoice_no), '') as invoice_no,
    max(s.order_ts) as order_ts, max(s.order_type) as order_type,
    max(s.payment_type) as payment_type, max(s.status) as status,
    max(nullif(trim(s.customer_name), '')) as customer_name,
    max(nullif(trim(s.customer_phone), '')) as customer_phone,
    max(nullif(trim(s.customer_address), '')) as customer_address,
    max(nullif(trim(s.area), '')) as area,
    max(core.to_num(s.total)) as order_total,
    max(core.to_num(s.discount)) as discount_total
  from landing.petpooja_order_summary_item s
  where s.voided_at is null and s.business_date >= v_from
  group by 1, 2, 3;

  -- 4. POS-only orders: item groups with a real invoice and no online order.
  insert into core.orders (source, location_id, outlet_raw, business_date,
    invoice_no, order_ts_raw, order_type, payment_type, status, customer_name,
    customer_phone_raw, customer_address, pos_area, order_total, discount_total)
  select 'pos_items_only', core.map_location(g.restaurant_name), g.restaurant_name,
    g.business_date, g.invoice_no, g.order_ts, g.order_type, g.payment_type,
    g.status, g.customer_name, g.customer_phone, g.customer_address, g.area,
    g.order_total, g.discount_total
  from _grp g
  where g.invoice_no is not null and g.invoice_no not in ('0', 'O1')
    and not exists (
      select 1 from core.orders c
      where c.business_date = g.business_date
        and c.outlet_raw = g.restaurant_name and c.invoice_no = g.invoice_no);
  get diagnostics v_orders_pos = row_count;

  -- 5. Address and area onto matched online orders (Tier C identity inputs).
  update core.orders c
  set customer_address = g.customer_address, pos_area = g.area
  from _grp g
  where c.source = 'online_report' and c.business_date >= v_from
    and c.business_date = g.business_date and c.outlet_raw = g.restaurant_name
    and c.invoice_no = g.invoice_no
    and g.invoice_no is not null and g.invoice_no not in ('0', 'O1');

  -- 6. Items, linked to their order where the invoice is real and unambiguous.
  insert into core.order_items (order_id, link_status, landing_item_id,
    location_id, outlet_raw, business_date, invoice_no, item_name, category_name,
    sap_code, item_price, item_quantity, item_total)
  select pick.id,
    case when pick.id is not null then 'linked'
         when coalesce(nullif(trim(s.invoice_no), ''), '0') in ('0', 'O1') then 'orphan_junk_invoice'
         else 'orphan_no_order' end,
    s.id, core.map_location(s.restaurant_name), s.restaurant_name, s.business_date,
    nullif(trim(s.invoice_no), ''), s.item_name, s.category_name, s.sap_code,
    core.to_num(s.item_price), core.to_num(s.item_quantity), core.to_num(s.item_total)
  from landing.petpooja_order_summary_item s
  left join lateral (
    select c.id from core.orders c
    where c.business_date = s.business_date and c.outlet_raw = s.restaurant_name
      and c.invoice_no = nullif(trim(s.invoice_no), '')
      and coalesce(nullif(trim(s.invoice_no), ''), '0') not in ('0', 'O1')
    order by (c.source = 'online_report') desc, c.id
    limit 1
  ) pick on true
  where s.voided_at is null and s.business_date >= v_from;
  get diagnostics v_items = row_count;

  select count(*) into v_orphans from core.order_items
  where business_date >= v_from and order_id is null;

  -- 7. Roll item counts up onto orders.
  update core.orders c
  set items_count = i.n, items_total = i.t, items_linked = true
  from (
    select order_id, count(*) as n, sum(item_total) as t
    from core.order_items
    where order_id is not null and business_date >= v_from
    group by 1
  ) i
  where c.id = i.order_id;

  -- 8. Exceptions: visible, never silently dropped.
  insert into core.refresh_exceptions (run_id, reason, outlet_raw, business_date,
    invoice_no, aggregator_order_no)
  select v_run_id, 'junk_invoice_order', c.outlet_raw, c.business_date,
    c.invoice_no, c.aggregator_order_no
  from core.orders c
  where c.business_date >= v_from and c.source = 'online_report'
    and coalesce(c.invoice_no, '0') in ('0', 'O1');
  get diagnostics n = row_count; v_exc := v_exc + n;

  insert into core.refresh_exceptions (run_id, reason, outlet_raw, business_date,
    invoice_no, aggregator_order_no)
  select v_run_id, 'order_without_items', c.outlet_raw, c.business_date,
    c.invoice_no, c.aggregator_order_no
  from core.orders c
  where c.business_date >= v_from and c.source = 'online_report'
    and not c.items_linked and coalesce(c.invoice_no, '0') not in ('0', 'O1');
  get diagnostics n = row_count; v_exc := v_exc + n;

  -- 9. OMS D2C orders, from the wide OMS feed (spec sections 6 and 7).
  --    Re-derived in full every refresh: the volume is small and a
  --    cancellation can land weeks after the placed date, outside any
  --    rolling window. The floor is the 1 Aug 2026 cutover; earlier D2C
  --    revenue is already in the spine through its Petpooja POS rows.
  delete from core.order_items where item_source = 'oms';
  delete from core.orders where source = 'oms';

  insert into core.orders (source, channel, location_id, outlet_raw,
    business_date, fulfilment_date, invoice_no, landing_order_id, order_ts_raw,
    status, customer_name, customer_phone_raw, customer_address, pos_area,
    discount_total, order_total, cancel_reason)
  select 'oms',
    case h.source when 'shopify' then 'Website'
                  when 'whatsapp' then 'WhatsApp'
                  when 'b2b' then 'B2B'
                  else initcap(coalesce(h.source, 'unknown')) end,
    a.location_id,
    coalesce(h.outlet_code, 'OMS-unassigned'),
    h.business_date,
    h.delivery_date,
    coalesce(nullif(replace(coalesce(h.shopify_name, ''), '#', ''), ''),
             'CC-' || h.oms_order_id),
    h.id,
    h.placed_at::text,
    h.status,
    nullif(trim(h.customer_name), ''),
    nullif(trim(h.customer_mobile), ''),
    nullif(concat_ws(', ', nullif(trim(h.address_line), ''), nullif(trim(h.area), ''),
                     nullif(trim(h.city), ''), nullif(trim(h.pincode), '')), ''),
    nullif(trim(h.area), ''),
    h.discount_amount,
    h.total_amount,
    h.cancel_reason
  from landing.oms_order_header h
  left join public.location_aliases a
    on a.system = 'oms' and lower(a.external_name) = lower(h.outlet_code)
  where h.superseded_at is null
    and h.business_date >= date '2026-08-01';
  get diagnostics v_orders_oms = row_count;

  insert into core.order_items (order_id, link_status, landing_item_id,
    item_source, location_id, outlet_raw, business_date, invoice_no, item_name,
    sap_code, item_price, item_quantity, item_total)
  select c.id, 'linked', i.id, 'oms', c.location_id, c.outlet_raw,
    c.business_date, c.invoice_no,
    trim(concat_ws(' - ', nullif(trim(i.product_title), ''),
                   nullif(trim(i.variant_title), ''))),
    i.sku, i.unit_price, i.quantity, i.line_total
  from landing.oms_order_item i
  join landing.oms_order_header h
    on h.oms_order_id = i.oms_order_id and h.superseded_at is null
  join core.orders c on c.source = 'oms' and c.landing_order_id = h.id
  where i.superseded_at is null;
  get diagnostics n = row_count; v_items := v_items + n;

  update core.orders c
  set items_count = i.n, items_total = i.t, items_linked = true
  from (
    select order_id, count(*) as n, sum(item_total) as t
    from core.order_items
    where item_source = 'oms' and order_id is not null
    group by 1
  ) i
  where c.id = i.order_id and c.source = 'oms';

  insert into core.refresh_exceptions (run_id, reason, outlet_raw, business_date,
    invoice_no)
  select v_run_id, 'unmapped_outlet_oms', c.outlet_raw, c.business_date,
    c.invoice_no
  from core.orders c
  where c.source = 'oms' and c.location_id is null;
  get diagnostics n = row_count; v_exc := v_exc + n;

  -- 10. Unmapped outlets across the window (all sources).
  insert into core.refresh_exceptions (run_id, reason, outlet_raw)
  select distinct v_run_id, 'unmapped_outlet', c.outlet_raw
  from core.orders c
  where c.business_date >= v_from and c.location_id is null;
  get diagnostics n = row_count; v_exc := v_exc + n;

  update core.refresh_runs set finished_at = clock_timestamp(),
    orders_online = v_orders_online, orders_pos_only = v_orders_pos,
    orders_oms = v_orders_oms,
    items_written = v_items, items_orphaned = v_orphans,
    exceptions_written = v_exc
  where id = v_run_id;

  drop table if exists _grp;
  return v_run_id;
end $$;
