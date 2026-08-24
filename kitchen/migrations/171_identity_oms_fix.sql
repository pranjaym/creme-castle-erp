-- ============================================================
-- Migration 171: correct 170's bucket merge (same day, 24 August 2026)
--
-- WHAT WENT WRONG. 170 step 4d superseded ANY live identity carrying a phone
-- that belongs to an OMS customer, including Tier C rows. A Tier C identity is
-- not a person: it is a name+outlet+area BUCKET, and a coarse or junk bucket
-- can hold several people's orders. Superseding the bucket moved ALL of its
-- orders onto one named OMS customer, not just the orders that actually carry
-- that customer's number.
--
-- Caught by a post-run outlier check, and it was obvious once looked at: the
-- worst case had 163 orders across 4 distinct phones and 5 names attached to
-- one person, and another was a junk bucket literally named 'NaN' with 80
-- Dine In orders. Measured damage: 2,465 Tier C buckets merged, of which the
-- fallout was 305 orders on 61 OMS identities carrying a clean phone that
-- belongs to somebody else (1.4% of the 21,559 orders on OMS identities).
-- Small, but it is exactly the failure the spec forbids: "matching on virtual
-- numbers would merge strangers into one customer, which is worse than no
-- match" (section 8). The same logic applies to merging on a coarse bucket.
--
-- THE FIX, in two parts:
--   1. Restore the 2,465 Tier C rows 170 superseded (clear the supersede
--      stamps; the rows were never deleted, so this is a true undo). The 138
--      Tier A rows superseded by 170 STAY merged: a zomato_customer_id is one
--      real person by construction, so merging it into the OMS person on a
--      matching real phone is sound.
--   2. Step 4d now merges ONLY identities that are themselves single-person
--      verified anchors (zomato_customer_id not null). Tier C buckets are
--      never merged. The cross-channel work is done entirely at ORDER level
--      by step 2c/_phone_orders, which moves an individual order only when
--      that order's own clean phone belongs to the OMS customer. Order level
--      evidence cannot drag a stranger along.
--
-- Effect on the prize: unchanged. The 13,649 order level links and the ~10.7k
-- people reunited across the 1 August cutover all came from _phone_orders,
-- not from the bucket merge. Only the wrongly attributed extras go away.
-- ============================================================

-- Part 1: undo the Tier C bucket merges from 170. Not a delete: these rows
-- were only stamped, and the stamp is what was wrong.
update identity.customers
set superseded_by = null, superseded_at = null,
    supersede_reason = 'restored by 171: 170 merged this Tier C bucket on a phone match, but a name+outlet+area bucket is not one person; cross-channel matching now happens at order level only'
where tier = 'C'
  and supersede_reason = 'merged 170: same verified phone as the OMS direct customer (authoritative)';

create or replace function identity.refresh_identity()
returns bigint
language plpgsql as $function$
declare
  v_run_id bigint;
  v_new integer := 0;
  v_a integer := 0;
  v_c integer := 0;
  v_unmatched integer := 0;
  v_oms_new integer := 0;
  v_oms_links integer := 0;
  v_phone_links integer := 0;
  v_merged_oms integer := 0;
  v_merged_dup integer := 0;
  n integer;
begin
  perform pg_advisory_xact_lock(hashtext('identity.refresh_identity'));

  insert into identity.refresh_runs default values returning id into v_run_id;

  -- 1. Tier A customers (Zomato): upsert, never delete (stable ids).
  insert into identity.customers (tier, zomato_customer_id)
  select distinct 'A', o.zomato_customer_id
  from core.orders o
  where o.zomato_customer_id is not null
  on conflict (zomato_customer_id) do nothing;
  get diagnostics n = row_count; v_new := v_new + n;

  -- 1b (170). Tier A customers (OMS direct). Every OMS customer, no date floor.
  create temp table _oms on commit drop as
  select oms_customer_id,
         right(regexp_replace(primary_mobile, '\D', '', 'g'), 10) as phone
  from landing.oms_customer
  where superseded_at is null
    and right(regexp_replace(primary_mobile, '\D', '', 'g'), 10) ~ '^[6-9][0-9]{9}$';

  insert into identity.customers (tier, oms_customer_id, phone, phone_source, marketable)
  select 'A', oms_customer_id, phone, 'oms_direct', 'yes'
  from _oms
  on conflict (oms_customer_id) do nothing;
  get diagnostics v_oms_new = row_count; v_new := v_new + v_oms_new;

  update identity.customers ic
  set phone = o.phone, phone_source = 'oms_direct', marketable = 'yes'
  from _oms o
  where ic.oms_customer_id = o.oms_customer_id
    and ic.phone is distinct from o.phone;

  create temp table _oms_phone on commit drop as
  select phone, min(oms_customer_id) as oms_customer_id
  from _oms group by phone having count(*) = 1;
  create index on _oms_phone (phone);

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

  -- 2b (170). CLEAN phone numbers, from the aggregator and POS side only.
  create temp table _clean on commit drop as
  select d, bool_or(is_pos) as seen_at_pos
  from (
    select right(regexp_replace(o.customer_phone_raw, '\D', '', 'g'), 10) as d,
           (o.source = 'pos_items_only') as is_pos,
           o.customer_name
    from core.orders o
    where coalesce(o.customer_phone_raw, '') <> ''
      and o.source <> 'oms'
  ) x
  where length(d) = 10 and left(d, 1) in ('6','7','8','9')
  group by d
  having count(*) <= 30 and count(distinct customer_name) <= 3;
  create index on _clean (d);

  -- 2c (170). Orders that will carry a VERIFIED Tier A link.
  create temp table _oms_orders on commit drop as
  select c.id as order_id, ic.id as customer_id
  from core.orders c
  join landing.oms_order_header h
    on h.id = c.landing_order_id and h.superseded_at is null
  join identity.customers ic on ic.oms_customer_id = h.oms_customer_id
  where c.source = 'oms' and h.oms_customer_id is not null;

  -- THE cross-channel / cross-cutover join, and (171) the ONLY place cross
  -- channel matching happens. One order at a time, on that order's own clean
  -- phone, so a coarse bucket can never drag a stranger onto a real person.
  create temp table _phone_orders on commit drop as
  select o.id as order_id, ic.id as customer_id
  from core.orders o
  join _clean cp on cp.d = right(regexp_replace(o.customer_phone_raw, '\D', '', 'g'), 10)
  join _oms_phone p on p.phone = cp.d
  join identity.customers ic on ic.oms_customer_id = p.oms_customer_id
  where o.source <> 'oms' and o.zomato_customer_id is null;

  -- 3. Tier C keys: name + location + area, for orders with no verified id.
  create temp table _ckeys on commit drop as
  select o.id as order_id,
    identity.norm(o.customer_name) || '|'
      || coalesce(o.location_id::text, lower(o.outlet_raw)) || '|'
      || coalesce(identity.norm(o.pos_area), left(identity.norm(o.customer_address), 40), '')
      as match_key
  from core.orders o
  where o.zomato_customer_id is null
    and identity.norm(o.customer_name) is not null
    and not exists (select 1 from _oms_orders x where x.order_id = o.id)
    and not exists (select 1 from _phone_orders x where x.order_id = o.id);

  insert into identity.customers (tier, match_key)
  select distinct 'C', match_key from _ckeys
  on conflict (match_key) do nothing;
  get diagnostics n = row_count; v_new := v_new + n;

  -- 4. Order to customer links, fully rebuilt.
  delete from identity.order_customer;

  insert into identity.order_customer (order_id, customer_id, tier)
  select o.id, coalesce(c.superseded_by, c.id), 'A'
  from core.orders o
  join identity.customers c on c.zomato_customer_id = o.zomato_customer_id
  where o.zomato_customer_id is not null;
  get diagnostics v_a = row_count;

  insert into identity.order_customer (order_id, customer_id, tier)
  select order_id, customer_id, 'A' from _oms_orders
  on conflict (order_id) do nothing;
  get diagnostics v_oms_links = row_count; v_a := v_a + v_oms_links;

  insert into identity.order_customer (order_id, customer_id, tier)
  select order_id, customer_id, 'A' from _phone_orders
  on conflict (order_id) do nothing;
  get diagnostics v_phone_links = row_count; v_a := v_a + v_phone_links;

  insert into identity.order_customer (order_id, customer_id, tier)
  select k.order_id, coalesce(c.superseded_by, c.id), 'C'
  from _ckeys k
  join identity.customers c on c.match_key = k.match_key
  on conflict (order_id) do nothing;
  get diagnostics v_c = row_count;

  select count(*) into v_unmatched
  from core.orders o
  where not exists (select 1 from identity.order_customer oc where oc.order_id = o.id);

  -- 4b (140). Clean phones from core.orders onto customers.
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

  -- 4d (171). Merge into the OMS identity, but ONLY from a single-person
  -- verified anchor. A zomato_customer_id is one real person, so a matching
  -- real phone means the same human and the OMS row (authoritative and
  -- contactable) survives. Tier C rows are buckets, not people, and are
  -- deliberately NOT merged here: see the 171 header for what that cost.
  create temp table _merge_oms on commit drop as
  select ic.id as loser_id, oc2.id as winner_id
  from identity.customers ic
  join _oms_phone p on p.phone = ic.phone
  join identity.customers oc2 on oc2.oms_customer_id = p.oms_customer_id
  where ic.superseded_by is null
    and ic.oms_customer_id is null
    and ic.zomato_customer_id is not null
    and ic.phone is not null
    and ic.id <> oc2.id;

  update identity.customers ic
  set superseded_by = m.winner_id,
      superseded_at = now(),
      supersede_reason = 'merged 170: same verified phone as the OMS direct customer (authoritative)'
  from _merge_oms m
  where ic.id = m.loser_id;
  get diagnostics v_merged_oms = row_count;

  -- 4c (140). Merge Tier C duplicates that share one clean POS phone.
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
  get diagnostics v_merged_dup = row_count;

  -- 4e (170). Flatten any supersede chain, then point links at the canonical.
  with recursive res as (
    select id, superseded_by as canon, 1 as depth
    from identity.customers where superseded_by is not null
    union all
    select r.id, c.superseded_by, r.depth + 1
    from res r join identity.customers c on c.id = r.canon
    where c.superseded_by is not null and r.depth < 20
  ), final as (
    select distinct on (id) id, canon from res order by id, depth desc
  )
  update identity.customers c
  set superseded_by = f.canon
  from final f
  where c.id = f.id and c.superseded_by is distinct from f.canon;

  update identity.order_customer oc
  set customer_id = c.superseded_by
  from identity.customers c
  where oc.customer_id = c.id and c.superseded_by is not null;

  -- 5. mart.customer_summary, fully rebuilt.
  truncate mart.customer_summary;
  insert into mart.customer_summary (customer_id, tier, identity_basis,
    display_name, phone, orders_count, orders_cancelled, first_order, last_order,
    total_spend, avg_order_value, favorite_outlet, favorite_item, channels,
    areas, avg_rating, ratings_count, complaints, is_repeat)
  select c.id, c.tier,
    case when c.oms_customer_id is not null then 'oms_customer_id (verified, direct)'
         when c.tier = 'A' then 'zomato_customer_id (verified)'
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

  -- 6. mart.item_repeat_patterns, fully rebuilt.
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
    orders_unmatched = v_unmatched,
    note = json_build_object(
      'oms_customers_new', v_oms_new,
      'oms_order_links', v_oms_links,
      'cross_channel_phone_links', v_phone_links,
      'merged_into_oms_tier_a_only', v_merged_oms,
      'merged_tier_c_dups', v_merged_dup)::text
  where id = v_run_id;

  drop table if exists _ckeys;
  drop table if exists _ranked;
  return v_run_id;
end $function$;
