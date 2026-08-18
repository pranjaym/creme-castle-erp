-- 074: the customer identity layer and the first marts, per the approved
-- framework (erp-plan/customer-analytics-framework.md sections 4 and 5).
--
-- Tiers, per the framework:
--   Tier A (verified): Zomato's own customer_id, carried onto core.orders.
--   Tier C (ESTIMATE): normalized name + location + area, for orders without
--     a Zomato customer_id (Swiggy, POS, and the Zomato remainder). Labelled
--     as an estimate everywhere it surfaces (covenant rule 5).
--   Tier B (consent phones from the Zomato feed) stores the phone on the
--     Tier A customer; it is contact data and future cross channel evidence,
--     not a separate matching tier today.
--
-- Divergence from the framework text, recorded: no physical
-- identity.customer_signals table in v1. The signals are recomputed
-- deterministically from core.orders on every refresh and the link lives in
-- identity.order_customer; a signals archive adds nothing while the landing
-- tables hold every input. Revisit if Tier B cross channel matching arrives.
--
-- Stability: identity.customers rows are never deleted. Tier A customers key
-- on zomato_customer_id, Tier C on match_key; refreshes upsert, so customer
-- ids are stable across refreshes and safe to hold in exports. Future merges
-- supersede with a reason (columns ready), never delete.
--
-- identity.order_customer and the mart tables are derived and fully rebuilt
-- on each refresh (same covenant stance as core: rebuild mechanics, not data
-- loss). Cancelled orders stay in order counts but are excluded from spend.

create schema if not exists identity;
create schema if not exists mart;

-- Lowercase, trimmed, single spaced; empty becomes null.
create or replace function identity.norm(t text) returns text
language sql immutable as $$
  select nullif(lower(regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g')), '')
$$;

create table identity.customers (
  id bigint generated always as identity primary key,
  tier text not null check (tier in ('A', 'C')),
  zomato_customer_id text unique,
  match_key text unique,
  phone text,
  phone_source text,
  superseded_by bigint references identity.customers(id),
  superseded_at timestamptz,
  supersede_reason text,
  created_at timestamptz not null default now(),
  check ((tier = 'A' and zomato_customer_id is not null and match_key is null)
      or (tier = 'C' and match_key is not null and zomato_customer_id is null))
);

create table identity.order_customer (
  order_id bigint primary key references core.orders(id) on delete cascade,
  customer_id bigint not null references identity.customers(id),
  tier text not null,
  refreshed_at timestamptz not null default now()
);
create index identity_oc_customer_idx on identity.order_customer (customer_id);

create table identity.refresh_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  customers_total integer,
  customers_new integer,
  links_tier_a integer,
  links_tier_c integer,
  orders_unmatched integer,
  note text
);

create table mart.customer_summary (
  customer_id bigint primary key references identity.customers(id),
  tier text not null,
  identity_basis text not null,
  display_name text,
  phone text,
  orders_count integer not null,
  orders_cancelled integer not null,
  first_order date,
  last_order date,
  total_spend numeric,
  avg_order_value numeric,
  favorite_outlet text,
  favorite_item text,
  channels text,
  areas text,
  avg_rating numeric,
  ratings_count integer,
  complaints integer,
  is_repeat boolean not null,
  refreshed_at timestamptz not null default now()
);
create index mart_cs_repeat_idx on mart.customer_summary (is_repeat, orders_count desc);
create index mart_cs_phone_idx on mart.customer_summary (phone) where phone is not null;

create table mart.item_repeat_patterns (
  item_name text not null,
  channel text not null,
  orders_with_item integer,
  first_order_appearances integer,
  repeat_order_appearances integer,
  distinct_customers integer,
  first_time_customers integer,
  came_back_after_first integer,
  comeback_rate numeric,
  refreshed_at timestamptz not null default now(),
  primary key (item_name, channel)
);

-- Order level view for ad hoc analysis: every identified order with its
-- customer id and tier alongside the full order row.
create or replace view mart.customer_orders as
select oc.customer_id, oc.tier as identity_tier, o.*
from identity.order_customer oc
join core.orders o on o.id = oc.order_id;

create or replace function identity.refresh_identity()
returns bigint
language plpgsql as $$
declare
  v_run_id bigint;
  v_new integer := 0;
  v_a integer := 0;
  v_c integer := 0;
  v_unmatched integer := 0;
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext('identity.refresh_identity'));

  insert into identity.refresh_runs default values returning id into v_run_id;

  -- 1. Tier A customers: upsert, never delete (stable ids).
  insert into identity.customers (tier, zomato_customer_id)
  select distinct 'A', o.zomato_customer_id
  from core.orders o
  where o.zomato_customer_id is not null
  on conflict (zomato_customer_id) do nothing;
  get diagnostics n = row_count; v_new := v_new + n;

  -- 2. Consent shared phones from the Zomato feed onto Tier A customers.
  update identity.customers ic
  set phone = p.phone, phone_source = 'zomato_consent'
  from (
    select distinct on (nullif(trim(customer_id), '')) nullif(trim(customer_id), '') as cid,
      substring(regexp_replace(customer_phone, '\D', '', 'g') from 3 for 10) as phone
    from landing.zomato_order_details
    where superseded_by is null
      and regexp_replace(customer_phone, '\D', '', 'g') ~ '^91[6-9][0-9]{9}'
      and nullif(trim(customer_id), '') is not null
    order by nullif(trim(customer_id), ''), loaded_at desc
  ) p
  where ic.zomato_customer_id = p.cid
    and (ic.phone is distinct from p.phone);

  -- 3. Tier C keys: name + location + area, for orders without a Zomato id.
  create temp table _ckeys on commit drop as
  select o.id as order_id,
    identity.norm(o.customer_name) || '|'
      || coalesce(o.location_id::text, lower(o.outlet_raw)) || '|'
      || coalesce(identity.norm(o.pos_area), left(identity.norm(o.customer_address), 40), '')
      as match_key
  from core.orders o
  where o.zomato_customer_id is null
    and identity.norm(o.customer_name) is not null;

  insert into identity.customers (tier, match_key)
  select distinct 'C', match_key from _ckeys
  on conflict (match_key) do nothing;
  get diagnostics n = row_count; v_new := v_new + n;

  -- 4. Order to customer links, fully rebuilt.
  delete from identity.order_customer;

  insert into identity.order_customer (order_id, customer_id, tier)
  select o.id, c.id, 'A'
  from core.orders o
  join identity.customers c on c.zomato_customer_id = o.zomato_customer_id
  where o.zomato_customer_id is not null;
  get diagnostics v_a = row_count;

  insert into identity.order_customer (order_id, customer_id, tier)
  select k.order_id, c.id, 'C'
  from _ckeys k
  join identity.customers c on c.match_key = k.match_key;
  get diagnostics v_c = row_count;

  select count(*) into v_unmatched
  from core.orders o
  where not exists (select 1 from identity.order_customer oc where oc.order_id = o.id);

  -- 5. mart.customer_summary, fully rebuilt.
  truncate mart.customer_summary;
  insert into mart.customer_summary (customer_id, tier, identity_basis,
    display_name, phone, orders_count, orders_cancelled, first_order, last_order,
    total_spend, avg_order_value, favorite_outlet, favorite_item, channels,
    areas, avg_rating, ratings_count, complaints, is_repeat)
  select c.id, c.tier,
    case c.tier when 'A' then 'zomato_customer_id (verified)'
                else 'name+outlet+area (ESTIMATE)' end,
    mode() within group (order by o.customer_name) filter (where o.customer_name is not null),
    c.phone,
    count(*)::integer,
    (count(*) filter (where o.status ilike 'cancel%'))::integer,
    min(o.business_date), max(o.business_date),
    sum(o.order_total) filter (where o.status not ilike 'cancel%' or o.status is null),
    round(avg(o.order_total) filter (where o.status not ilike 'cancel%' or o.status is null), 0),
    mode() within group (order by o.outlet_raw),
    null,
    string_agg(distinct coalesce(o.channel, o.order_type), ' | '),
    string_agg(distinct coalesce(o.zomato_subzone, o.pos_area), ' | '),
    round(avg(o.zomato_rating), 2),
    (count(*) filter (where o.zomato_rating is not null))::integer,
    (count(*) filter (where o.zomato_complaint_tag is not null))::integer,
    count(*) >= 2
  from identity.order_customer oc
  join identity.customers c on c.id = oc.customer_id
  join core.orders o on o.id = oc.order_id
  group by c.id, c.tier, c.phone;

  update mart.customer_summary s
  set favorite_item = f.item_name
  from (
    select distinct on (oc.customer_id) oc.customer_id, oi.item_name
    from identity.order_customer oc
    join core.order_items oi on oi.order_id = oc.order_id
    group by oc.customer_id, oi.item_name
    order by oc.customer_id, count(*) desc, oi.item_name
  ) f
  where s.customer_id = f.customer_id;

  -- 6. mart.item_repeat_patterns, fully rebuilt. rn = the order's position in
  -- its customer's history; an item on an rn 1 order is a first order item.
  create temp table _ranked on commit drop as
  select oc.customer_id, oc.order_id,
    row_number() over (partition by oc.customer_id order by o.business_date, o.id) as rn,
    count(*) over (partition by oc.customer_id) as n_orders,
    coalesce(o.channel, o.order_type, 'unknown') as channel
  from identity.order_customer oc
  join core.orders o on o.id = oc.order_id;

  truncate mart.item_repeat_patterns;
  insert into mart.item_repeat_patterns (item_name, channel, orders_with_item,
    first_order_appearances, repeat_order_appearances, distinct_customers,
    first_time_customers, came_back_after_first, comeback_rate)
  select oi.item_name, r.channel,
    count(distinct oi.order_id),
    count(distinct oi.order_id) filter (where r.rn = 1),
    count(distinct oi.order_id) filter (where r.rn > 1),
    count(distinct r.customer_id),
    count(distinct r.customer_id) filter (where r.rn = 1),
    count(distinct r.customer_id) filter (where r.rn = 1 and r.n_orders > 1),
    round(
      count(distinct r.customer_id) filter (where r.rn = 1 and r.n_orders > 1)::numeric
      / nullif(count(distinct r.customer_id) filter (where r.rn = 1), 0), 4)
  from core.order_items oi
  join _ranked r on r.order_id = oi.order_id
  where oi.item_name is not null
  group by 1, 2;

  update identity.refresh_runs set finished_at = clock_timestamp(),
    customers_total = (select count(*) from identity.customers),
    customers_new = v_new, links_tier_a = v_a, links_tier_c = v_c,
    orders_unmatched = v_unmatched
  where id = v_run_id;

  drop table if exists _ckeys;
  drop table if exists _ranked;
  return v_run_id;
end $$;

-- Daily server side refresh at 15:15 UTC (20:45 IST), after the evening core
-- refresh (14:30 UTC) has landed the day's orders and Zomato enrichment.
select cron.schedule('identity_refresh_daily', '15 15 * * *',
  $$set statement_timeout = 0; select identity.refresh_identity()$$);
