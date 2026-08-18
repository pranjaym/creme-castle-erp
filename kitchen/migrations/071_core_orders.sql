-- 071: core.orders and core.order_items, the first two derived tables of the
-- customer analytics framework (erp-plan/customer-analytics-framework.md,
-- approved by Pranjay 15 Aug 2026).
--
-- Design rules:
--   Derived layer: rebuilt from landing tables by core.refresh_orders(), never
--   hand edited, droppable and rebuildable at any time. The landing tables
--   remain the append-only source of truth; deletes here are rebuild
--   mechanics, not data loss.
--   Identity: online orders anchor to their landing row id (stable) and carry
--   (channel, aggregator_order_no), verified unique across the full history.
--   POS-only orders (dine in, pick up) anchor to (outlet, business_date,
--   invoice_no). Junk invoices ('0', 'O1', blank) never link to items and are
--   logged as exceptions.
--   Every refresh is logged in core.refresh_runs with row counts and
--   exceptions, so every number is reproducible.

create schema if not exists core;

-- Safe text to numeric: strips currency symbols, commas, and 'NaN'.
create or replace function core.to_num(t text) returns numeric
language plpgsql immutable as $$
begin
  return nullif(regexp_replace(coalesce(t, ''), '[^0-9.\-]', '', 'g'), '')::numeric;
exception when others then
  return null;
end $$;

-- Outlet name to canonical location id, case insensitive, master name first
-- then aliases. Returns null when unmapped (kept visible via exceptions).
create or replace function core.map_location(p_name text) returns bigint
language sql stable as $$
  select id from (
    select l.id, 1 as pri from public.locations l where lower(l.name) = lower(p_name)
    union all
    select a.location_id, 2 from public.location_aliases a where lower(a.external_name) = lower(p_name)
  ) x order by pri limit 1
$$;

create table core.orders (
  id bigint generated always as identity primary key,
  source text not null check (source in ('online_report', 'pos_items_only')),
  channel text,
  location_id bigint references public.locations(id),
  outlet_raw text not null,
  business_date date not null,
  invoice_no text,
  aggregator_order_no text,
  landing_order_id bigint,
  order_ts_raw text,
  order_type text,
  payment_type text,
  status text,
  customer_name text,
  customer_phone_raw text,
  customer_address text,
  pos_area text,
  subtotal numeric,
  discount_total numeric,
  charges_total numeric,
  order_total numeric,
  cancelled_by text,
  cancel_reason text,
  zomato_customer_id text,
  zomato_subzone text,
  zomato_city text,
  zomato_rating numeric,
  zomato_review text,
  zomato_complaint_tag text,
  zomato_discount_construct text,
  items_count integer,
  items_total numeric,
  items_linked boolean not null default false,
  refreshed_at timestamptz not null default now()
);

create unique index core_orders_landing_uq on core.orders (landing_order_id)
  where source = 'online_report';
create unique index core_orders_pos_uq on core.orders (outlet_raw, business_date, invoice_no)
  where source = 'pos_items_only';
create index core_orders_nat_idx on core.orders (outlet_raw, business_date, invoice_no);
create index core_orders_date_idx on core.orders (business_date);
create index core_orders_agg_idx on core.orders (aggregator_order_no)
  where aggregator_order_no is not null;
create index core_orders_zcust_idx on core.orders (zomato_customer_id)
  where zomato_customer_id is not null;

create table core.order_items (
  id bigint generated always as identity primary key,
  order_id bigint references core.orders(id),
  link_status text not null check (link_status in ('linked', 'orphan_junk_invoice', 'orphan_no_order')),
  landing_item_id bigint not null unique,
  location_id bigint references public.locations(id),
  outlet_raw text not null,
  business_date date not null,
  invoice_no text,
  item_name text,
  category_name text,
  sap_code text,
  item_price numeric,
  item_quantity numeric,
  item_total numeric,
  refreshed_at timestamptz not null default now()
);

create index core_items_order_idx on core.order_items (order_id);
create index core_items_date_idx on core.order_items (business_date);
create index core_items_name_idx on core.order_items (item_name);

create table core.refresh_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  window_from date,
  full_rebuild boolean not null default false,
  orders_online integer,
  orders_pos_only integer,
  items_written integer,
  items_orphaned integer,
  exceptions_written integer,
  note text
);

create table core.refresh_exceptions (
  id bigint generated always as identity primary key,
  run_id bigint not null references core.refresh_runs(id),
  reason text not null,
  outlet_raw text,
  business_date date,
  invoice_no text,
  aggregator_order_no text,
  created_at timestamptz not null default now()
);
create index core_exceptions_run_idx on core.refresh_exceptions (run_id);

create or replace function core.refresh_orders(p_days_back integer default 11)
returns bigint
language plpgsql as $$
declare
  v_run_id bigint;
  v_from date;
  v_orders_online integer := 0;
  v_orders_pos integer := 0;
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

  insert into core.refresh_exceptions (run_id, reason, outlet_raw)
  select distinct v_run_id, 'unmapped_outlet', c.outlet_raw
  from core.orders c
  where c.business_date >= v_from and c.location_id is null;
  get diagnostics n = row_count; v_exc := v_exc + n;

  update core.refresh_runs set finished_at = clock_timestamp(),
    orders_online = v_orders_online, orders_pos_only = v_orders_pos,
    items_written = v_items, items_orphaned = v_orphans,
    exceptions_written = v_exc
  where id = v_run_id;

  drop table if exists _grp;
  return v_run_id;
end $$;
