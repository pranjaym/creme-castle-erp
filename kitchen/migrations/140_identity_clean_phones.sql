-- ============================================================
-- Migration 140: identity clean phones (F26 fix) + marketable flag
-- Applied 23 August 2026 on Pranjay's go-ahead. See erp-plan/integration-notes.md
-- sections 11.6 and 11.7, and oms-spine-feed-spec.md section 8.
-- STAGED in erp-plan/migrations-staging; copy to
-- creme-castle-erp/kitchen/migrations/ (session could not write there).
--
-- What this does:
--   1. Adds identity.customers.marketable: 'yes' | 'zomato_terms' | 'no'.
--      The label every marketing export must filter on.
--   2. Teaches identity.refresh_identity() to use CLEAN phone numbers from
--      core.orders (10 digits, starts 6 to 9, at most 30 orders and at most
--      3 distinct names per number). Virtual and relay numbers can NEVER
--      match: most stored "phones" are aggregator relay lines (one carries
--      11,098 orders; Swiggy shows 74 numbers across 81,955 orders).
--   3. Merges Tier C duplicates that share one clean POS phone, by
--      supersession (no deletes, reason recorded), and makes the nightly
--      link rebuild respect supersession so merges stick.
--
-- Dry run measured 23 Aug 2026 before applying: 19,211 clean phones;
-- 4,700 Tier C and 9,671 Tier A customers gain a phone; 248 merge groups
-- folding 275 duplicate Tier C identities.
-- ============================================================

alter table identity.customers
  add column if not exists marketable text
  check (marketable in ('yes', 'zomato_terms', 'no'));

comment on column identity.customers.marketable is
  'Contact permission by phone source: yes = our own number (OMS direct, clean POS counter); zomato_terms = usable only within Zomato partner terms (consent shares, clean Zomato report numbers); no/null = analysis only. Every marketing export filters on this.';

-- Existing consent phones get their label immediately.
update identity.customers
set marketable = 'zomato_terms'
where phone_source = 'zomato_consent' and marketable is null;

create or replace function identity.refresh_identity()
 returns bigint
 language plpgsql
as $function$
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
  set phone = p.phone, phone_source = 'zomato_consent', marketable = 'zomato_terms'
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

  -- 4. Order to customer links, fully rebuilt. Links resolve supersession
  -- (140): a merged-away customer's key must point at its canonical row, or
  -- merges would silently undo themselves every night.
  delete from identity.order_customer;

  insert into identity.order_customer (order_id, customer_id, tier)
  select o.id, coalesce(c.superseded_by, c.id), 'A'
  from core.orders o
  join identity.customers c on c.zomato_customer_id = o.zomato_customer_id
  where o.zomato_customer_id is not null;
  get diagnostics v_a = row_count;

  insert into identity.order_customer (order_id, customer_id, tier)
  select k.order_id, coalesce(c.superseded_by, c.id), 'C'
  from _ckeys k
  join identity.customers c on c.match_key = k.match_key;
  get diagnostics v_c = row_count;

  select count(*) into v_unmatched
  from core.orders o
  where not exists (select 1 from identity.order_customer oc where oc.order_id = o.id);

  -- 4b (140). Clean phones from core.orders onto customers.
  -- A CLEAN number: 10 digits, starts 6 to 9, at most 30 orders and at most
  -- 3 distinct customer names across all of history. Everything else
  -- (aggregator relay and virtual numbers) is invisible to this step.
  create temp table _clean on commit drop as
  select d, bool_or(is_pos) as seen_at_pos
  from (
    select right(regexp_replace(o.customer_phone_raw, '\D', '', 'g'), 10) as d,
           (o.source = 'pos_items_only') as is_pos,
           o.customer_name
    from core.orders o
    where coalesce(o.customer_phone_raw, '') <> ''
  ) x
  where length(d) = 10 and left(d, 1) in ('6','7','8','9')
  group by d
  having count(*) <= 30 and count(distinct customer_name) <= 3;

  -- A customer gets a phone only when ALL their clean-phone evidence agrees
  -- on exactly one number, and only if they do not already have one
  -- (zomato_consent phones are never overwritten).
  create temp table _cust_phone on commit drop as
  select oc.customer_id, min(cp.d) as d, bool_or(cp.seen_at_pos) as seen_at_pos
  from identity.order_customer oc
  join core.orders o on o.id = oc.order_id
  join _clean cp on cp.d = right(regexp_replace(o.customer_phone_raw, '\D', '', 'g'), 10)
  group by oc.customer_id
  having count(distinct cp.d) = 1;

  update identity.customers ic
  set phone = p.d,
      phone_source = case when p.seen_at_pos then 'pos_clean' else 'zomato_report_clean' end,
      marketable = case when p.seen_at_pos then 'yes' else 'zomato_terms' end
  from _cust_phone p
  where ic.id = p.customer_id
    and ic.superseded_by is null
    and ic.phone is null;

  -- 4c (140). Merge Tier C duplicates that share one clean POS phone.
  -- Supersede, never delete; canonical = the oldest row. Only rows whose
  -- phone came from the POS (our own capture) merge; Zomato-sourced numbers
  -- never drive a merge.
  create temp table _dups on commit drop as
  select ic.phone as d, min(ic.id) as canonical_id, array_agg(ic.id) as ids
  from identity.customers ic
  where ic.tier = 'C' and ic.phone is not null
    and ic.phone_source = 'pos_clean' and ic.superseded_by is null
  group by ic.phone
  having count(*) > 1;

  update identity.customers ic
  set superseded_by = dp.canonical_id,
      superseded_at = now(),
      supersede_reason = 'merged 140: same clean POS phone as canonical customer'
  from _dups dp
  where ic.id = any(dp.ids) and ic.id <> dp.canonical_id;

  -- Point tonight's links at the canonicals for anything just merged.
  update identity.order_customer oc
  set customer_id = c.superseded_by
  from identity.customers c
  where oc.customer_id = c.id and c.superseded_by is not null;

  -- 5. mart.customer_summary, fully rebuilt. Superseded customers have no
  -- links after 4c, so they drop out of the mart naturally.
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
end $function$;
