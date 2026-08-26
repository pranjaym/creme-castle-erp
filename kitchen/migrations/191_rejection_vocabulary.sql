-- ============================================================
-- Migration 191: correct the store-caused rejection vocabulary (26 Aug 2026)
--
-- NOT YET APPLIED. Applying it changes numbers that are already on the live
-- store page, the live area page and the 07:30 mail, so it is Pranjay's call.
--
-- The problem, found while building the central page. Two Zomato feeds use
-- two different vocabularies for the same idea, exactly as they do for
-- complaints. The order feed's own words are:
--
--   Items out of stock | Kitchen is full | Restaurant is closed | Timeout |
--   Unavailable to accept the order
--
-- The filter written into migrations 150, 170 and 180 was taken from the
-- QUALITY report's column names instead. Two of its five strings, 'Outlet
-- closed' and 'Device issues', do not exist anywhere in the order feed and
-- can never match a row, while the order feed's own 'Restaurant is closed'
-- and 'Unavailable to accept the order' were never looked for.
--
-- What that costs, measured over the 7 days to 15 Aug 2026 across 41 stores:
--   store-caused rejections listed   47  ->  60   (13 orders never shown)
--   money lost, stockouts + refunds  Rs 32,636 -> Rs 39,348
-- and the missing rejections were silently counted as "other cancellations"
-- in dash_store_detail, which is the opposite of the truth.
--
-- Note the two feeds still do not agree after the fix and are not meant to:
-- Zomato's daily report counts 111 store rejections for that week against 60
-- order rows, because only orders that reached the store appear in the order
-- feed. The pages state both, never their sum.
--
-- This migration re-runs the three function definitions with the corrected
-- list and nothing else changed.
-- ============================================================



-- ---- from 150_dashboard_functions.sql (dash_all only) ----
create or replace function public.dash_all(p_date date)
returns jsonb
language sql stable
security definer
set search_path = public, landing
as $fn$
with ws as (select (p_date - 6)::date as s, p_date as e),
qd as (
  select restaurant_id,
    average_food_order_rating::numeric as rating,
    total_complaints::numeric as comps, complaints_pct::numeric as cpct,
    (item_out_of_stock::numeric + kitchen_is_full::numeric + outlet_closed::numeric
      + timeout::numeric + device_issues::numeric) as srej,
    total_rejected_orders::numeric as rej, rejected_orders_pct::numeric as rpct,
    online_time_pct::numeric as online, round(offline_time::numeric/60) as offmin
  from landing.zomato_outlet_day_quality
  where superseded_by is null and business_date::date = p_date
),
qw as (
  select restaurant_id,
    sum(total_complaints::numeric) as comps,
    sum(item_out_of_stock::numeric + kitchen_is_full::numeric + outlet_closed::numeric
      + timeout::numeric + device_issues::numeric) as srej,
    sum(total_rejected_orders::numeric) as rej,
    round(avg(online_time_pct::numeric),2) as online,
    round(sum(offline_time::numeric)/60) as offmin,
    round(avg(average_food_order_rating::numeric)
      filter (where average_food_order_rating::numeric > 0),2) as rating
  from landing.zomato_outlet_day_quality, ws
  where superseded_by is null and business_date::date between ws.s and ws.e
  group by restaurant_id
),
sd as (
  select restaurant_id,
    sum(orders_received::numeric) as orders,
    sum(delivered_orders::numeric) as delivered,
    sum(subtotal_value::numeric) as subtotal
  from landing.zomato_outlet_day_segment
  where superseded_by is null and business_date::date = p_date
    and nrl_segment <> 'all' and offer_sensitivity <> 'all' and mealtime <> 'all'
  group by restaurant_id
),
sw as (
  select restaurant_id,
    sum(orders_received::numeric) as orders,
    sum(delivered_orders::numeric) as delivered,
    sum(subtotal_value::numeric) as subtotal
  from landing.zomato_outlet_day_segment, ws
  where superseded_by is null and business_date::date between ws.s and ws.e
    and nrl_segment <> 'all' and offer_sensitivity <> 'all' and mealtime <> 'all'
  group by restaurant_id
),
sprev as (
  select restaurant_id, round(sum(orders_received::numeric)/7.0) as avgord
  from landing.zomato_outlet_day_segment
  where superseded_by is null
    and business_date::date between (p_date - 7) and (p_date - 1)
    and nrl_segment <> 'all' and offer_sensitivity <> 'all' and mealtime <> 'all'
  group by restaurant_id
),
od as (
  select restaurant_id,
    round(avg(extract(epoch from (left(nullif(picked_up_at,'NA'),19)::timestamp
      - left(nullif(rider_reached_outlet_at,'NA'),19)::timestamp))/60.0)
      filter (where order_state = 'Delivered')::numeric, 2) as wait,
    count(*) filter (where order_state = 'Delivered'
      and nullif(food_prep_time,'NA')::numeric <= 1
      and extract(epoch from (left(nullif(picked_up_at,'NA'),19)::timestamp
        - left(nullif(rider_reached_outlet_at,'NA'),19)::timestamp))/60.0 >= 3) as fr
  from landing.zomato_business_order
  where superseded_by is null and business_date::date = p_date
  group by restaurant_id
),
ow as (
  select restaurant_id,
    round(avg(extract(epoch from (left(nullif(picked_up_at,'NA'),19)::timestamp
      - left(nullif(rider_reached_outlet_at,'NA'),19)::timestamp))/60.0)
      filter (where order_state = 'Delivered')::numeric, 2) as wait,
    count(*) filter (where order_state = 'Delivered'
      and extract(epoch from (left(nullif(picked_up_at,'NA'),19)::timestamp
        - left(nullif(rider_reached_outlet_at,'NA'),19)::timestamp))/60.0 >= 3) as waits3,
    count(*) filter (where order_state = 'Delivered'
      and nullif(food_prep_time,'NA')::numeric <= 1
      and extract(epoch from (left(nullif(picked_up_at,'NA'),19)::timestamp
        - left(nullif(rider_reached_outlet_at,'NA'),19)::timestamp))/60.0 >= 3) as fr,
    round(coalesce(sum(order_subtotal::numeric) filter (where nullif(rejection_reason,'')
      in ('Items out of stock','Kitchen is full','Restaurant is closed','Timeout','Unavailable to accept the order')),0)) as stockout,
    round(coalesce(sum(nullif(refund_amount_agreed,'NA')::numeric),0)) as refunds
  from landing.zomato_business_order, ws
  where superseded_by is null and business_date::date between ws.s and ws.e
  group by restaurant_id
),
reasons as (
  select sum(total_complaints::numeric) as comps,
    sum(wrong_item_s_delivered::numeric) as wrong,
    sum(item_s_missing_or_not_delivered::numeric) as missing,
    sum(poor_packaging_or_spillage::numeric) as packaging,
    sum(poor_taste_or_quality::numeric) as quality,
    sum(kpt_delay::numeric) as late
  from landing.zomato_outlet_day_quality q
  join public.outlets o on o.zomato_restaurant_id = q.restaurant_id, ws
  where q.superseded_by is null and q.business_date::date between ws.s and ws.e
),
lev as (
  select
    (select jsonb_build_object(
       'subtotal', sum(subtotal_value::numeric), 'net_sales', sum(net_sales::numeric),
       'orders', sum(orders_received::numeric), 'delivered', sum(delivered_orders::numeric),
       'discount', sum(promo_discount::numeric + dish_discounts::numeric + bogo_discount::numeric
         + freebie::numeric + gold_discount::numeric),
       'offer_orders', sum(orders_with_offers::numeric),
       'impressions', sum(impressions::numeric), 'menu_opens', sum(menu_opens::numeric))
     from landing.zomato_outlet_day_segment
     where superseded_by is null and business_date::date = p_date
       and nrl_segment <> 'all' and offer_sensitivity <> 'all' and mealtime <> 'all') as seg_day,
    (select jsonb_build_object(
       'subtotal', sum(subtotal_value::numeric), 'net_sales', sum(net_sales::numeric),
       'orders', sum(orders_received::numeric), 'delivered', sum(delivered_orders::numeric),
       'discount', sum(promo_discount::numeric + dish_discounts::numeric + bogo_discount::numeric
         + freebie::numeric + gold_discount::numeric),
       'offer_orders', sum(orders_with_offers::numeric),
       'impressions', sum(impressions::numeric), 'menu_opens', sum(menu_opens::numeric))
     from landing.zomato_outlet_day_segment, ws
     where superseded_by is null and business_date::date between ws.s and ws.e
       and nrl_segment <> 'all' and offer_sensitivity <> 'all' and mealtime <> 'all') as seg_wk,
    (select jsonb_build_object('spend', sum(ad_spends::numeric),
       'ad_sales', sum(net_sales_from_ads::numeric), 'ad_orders', sum(orders_from_ads::numeric))
     from landing.zomato_outlet_day_ads_segment
     where superseded_by is null and segment_type = 'spending_potential'
       and business_date::date = p_date) as ads_day,
    (select jsonb_build_object('spend', sum(ad_spends::numeric),
       'ad_sales', sum(net_sales_from_ads::numeric), 'ad_orders', sum(orders_from_ads::numeric))
     from landing.zomato_outlet_day_ads_segment, ws
     where superseded_by is null and segment_type = 'spending_potential'
       and business_date::date between ws.s and ws.e) as ads_wk
)
select jsonb_build_object(
  'date', p_date,
  'week_start', (select s from ws),
  'week_end', (select e from ws),
  'stores', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'code', o.internal_code, 'locality', o.locality, 'city', o.city, 'am', o.area_manager,
      'day', jsonb_build_object(
        'orders', sd.orders, 'delivered', sd.delivered, 'subtotal', sd.subtotal,
        'rating', qd.rating, 'comps', qd.comps, 'cpct', qd.cpct,
        'srej', qd.srej, 'rej', qd.rej, 'rpct', qd.rpct,
        'online', qd.online, 'offmin', qd.offmin,
        'wait', od.wait, 'fr', od.fr, 'avgord', sprev.avgord),
      'wk', jsonb_build_object(
        'orders', sw.orders, 'delivered', sw.delivered, 'subtotal', sw.subtotal,
        'rating', qw.rating, 'comps', qw.comps, 'srej', qw.srej, 'rej', qw.rej,
        'online', qw.online, 'offmin', qw.offmin,
        'wait', ow.wait, 'waits3', ow.waits3, 'fr', ow.fr,
        'stockout', ow.stockout, 'refunds', ow.refunds)
      ) order by o.internal_code), '[]'::jsonb)
    from public.outlets o
    left join qd on qd.restaurant_id = o.zomato_restaurant_id
    left join qw on qw.restaurant_id = o.zomato_restaurant_id
    left join sd on sd.restaurant_id = o.zomato_restaurant_id
    left join sw on sw.restaurant_id = o.zomato_restaurant_id
    left join sprev on sprev.restaurant_id = o.zomato_restaurant_id
    left join od on od.restaurant_id = o.zomato_restaurant_id
    left join ow on ow.restaurant_id = o.zomato_restaurant_id
    where o.active),
  'reasons_wk', (select to_jsonb(reasons) from reasons),
  'levers', (select to_jsonb(lev) from lev)
)
$fn$;
revoke all on function public.dash_all(date) from public, anon, authenticated;
grant execute on function public.dash_all(date) to service_role;

-- ---- from 170_store_detail_v3.sql ----
create or replace function public.dash_store_detail(p_code text, p_date date)
returns jsonb language sql stable security definer
set search_path = public, landing
as $fn$
with o as (select zomato_restaurant_id as rid, internal_code, locality, city, area_manager
           from public.outlets where internal_code = p_code),
ws as (select (p_date - 6)::date as s, p_date as e),
q as (
  select q.business_date::date as d, q.online_time_pct::numeric as online,
    round(q.offline_time::numeric/60) as offmin,
    q.total_complaints::numeric as comps,
    (q.item_out_of_stock::numeric + q.kitchen_is_full::numeric + q.outlet_closed::numeric
      + q.timeout::numeric + q.device_issues::numeric) as srej,
    q.average_food_order_rating::numeric as rating
  from landing.zomato_outlet_day_quality q, o, ws
  where q.superseded_by is null and q.restaurant_id = o.rid
    and q.business_date::date between ws.s and ws.e
),
seg as (
  select business_date::date as d, sum(orders_received::numeric) as orders
  from landing.zomato_outlet_day_segment s, o, ws
  where s.superseded_by is null and s.restaurant_id = o.rid
    and s.business_date::date between ws.s and ws.e
    and nrl_segment <> 'all' and offer_sensitivity <> 'all' and mealtime <> 'all'
  group by 1
),
meal as (
  select mealtime, sum(orders_received::numeric) as orders
  from landing.zomato_outlet_day_segment s, o, ws
  where s.superseded_by is null and s.restaurant_id = o.rid
    and s.business_date::date between ws.s and ws.e
    and nrl_segment <> 'all' and offer_sensitivity <> 'all' and mealtime <> 'all'
  group by 1
),
items as (
  select i.zomato_order_id,
    string_agg(i.item_quantity || ' x ' || i.item_name, ', ' order by i.line_no::int) as basket
  from landing.zomato_business_order_item i, o
  where i.superseded_by is null and i.restaurant_id = o.rid
  group by 1
),
ord as (
  select b.business_date::date as d, b.zomato_order_id, b.order_state, it.basket,
    to_char(left(nullif(b.placed_at,'NA'),19)::timestamp + interval '5 hours 30 minutes','Dy DD') as dlabel,
    to_char(left(nullif(b.placed_at,'NA'),19)::timestamp + interval '5 hours 30 minutes','HH12:MI am') as tm,
    b.placed_at, b.rejection_reason, b.order_rating, b.complaint_on_order, b.complaint_reason,
    nullif(b.refund_amount_agreed,'NA')::numeric as refund, b.order_subtotal::numeric as subtotal,
    nullif(b.food_prep_time,'NA')::numeric as prep_min,
    extract(epoch from (left(nullif(b.picked_up_at,'NA'),19)::timestamp
      - left(nullif(b.rider_reached_outlet_at,'NA'),19)::timestamp))/60.0 as rider_wait
  from landing.zomato_business_order b
  join o on o.rid = b.restaurant_id
  left join items it on it.zomato_order_id = b.zomato_order_id, ws
  where b.superseded_by is null and b.business_date::date between ws.s and ws.e
),
owait as (
  select d, round(avg(rider_wait) filter (where order_state = 'Delivered')::numeric, 2) as wait,
    count(*) filter (where order_state = 'Delivered' and rider_wait >= 3) as waits3,
    count(*) filter (where order_state = 'Delivered') as delivered
  from ord group by d
),
rej as (
  select d, dlabel, tm, rejection_reason, basket, round(subtotal) as value, placed_at
  from ord where nullif(rejection_reason,'')
    in ('Items out of stock','Kitchen is full','Restaurant is closed','Timeout','Unavailable to accept the order')
),
comp as (
  select d, dlabel, tm, coalesce(nullif(complaint_reason,''),'reason not tagged by Zomato') as tag,
    basket, round(coalesce(refund,0)) as refund, placed_at
  from ord where complaint_on_order = 'Yes'
),
fr as (
  select d, dlabel, tm, round(prep_min * 60) as ready_secs,
    round(rider_wait::numeric,1) as waited_min, basket
  from ord where order_state = 'Delivered' and prep_min <= 1 and rider_wait >= 3
)
select jsonb_build_object(
  'code', (select internal_code from o), 'locality', (select locality from o),
  'city', (select city from o), 'am', (select area_manager from o),
  'date', p_date, 'week_start', (select s from ws),
  'trend', (select coalesce(jsonb_agg(jsonb_build_object(
      'd', q.d, 'online', q.online, 'offmin', q.offmin, 'comps', q.comps, 'srej', q.srej,
      'rating', q.rating, 'orders', seg.orders, 'wait', ow.wait) order by q.d), '[]'::jsonb)
    from q left join seg on seg.d = q.d left join owait ow on ow.d = q.d),
  'mealtime_wk', (select coalesce(jsonb_object_agg(mealtime, orders), '{}'::jsonb) from meal),
  'complaints_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'time', tm, 'tag', tag, 'basket', basket, 'refund', refund) order by placed_at), '[]'::jsonb)
    from comp where d = p_date),
  'complaints_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'd', d, 'dlabel', dlabel, 'time', tm, 'tag', tag, 'basket', basket, 'refund', refund)
      order by placed_at desc), '[]'::jsonb) from comp where d <> p_date),
  'rated_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'time', tm, 'rating', order_rating, 'basket', basket) order by placed_at), '[]'::jsonb)
    from ord where d = p_date and nullif(order_rating,'') is not null and order_rating not in ('NA','0')),
  'rejections_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'time', tm, 'reason', rejection_reason, 'basket', basket, 'value', value)
      order by placed_at), '[]'::jsonb) from rej where d = p_date),
  'rejections_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'dlabel', dlabel, 'time', tm, 'reason', rejection_reason, 'basket', basket, 'value', value)
      order by placed_at desc), '[]'::jsonb) from rej where d <> p_date),
  'false_ready_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'time', tm, 'ready_secs', ready_secs, 'waited_min', waited_min, 'basket', basket)
      order by waited_min desc), '[]'::jsonb) from fr where d = p_date),
  'false_ready_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'dlabel', dlabel, 'time', tm, 'ready_secs', ready_secs, 'waited_min', waited_min, 'basket', basket)
      order by waited_min desc), '[]'::jsonb)
    from (select * from fr where d <> p_date order by waited_min desc limit 12) x),
  'low_ratings_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'dlabel', dlabel, 'time', tm, 'rating', order_rating, 'basket', basket,
      'tag', nullif(complaint_reason,'')) order by placed_at desc), '[]'::jsonb)
    from (select * from ord where order_rating in ('1','2') order by placed_at desc limit 20) x),
  'waits3_day', (select coalesce(waits3,0) from owait where d = p_date),
  'waits3_wk', (select coalesce(sum(waits3),0) from owait),
  'delivered_day', (select coalesce(delivered,0) from owait where d = p_date),
  'other_cancels_wk', (select count(*) from ord
    where nullif(rejection_reason,'') is not null and rejection_reason <> 'NA'
      and rejection_reason not in ('Items out of stock','Kitchen is full','Restaurant is closed','Timeout','Unavailable to accept the order')),
  'refunds_day', (select round(coalesce(sum(refund),0)) from comp where d = p_date),
  'refunds_wk', (select round(coalesce(sum(refund),0)) from comp),
  'stockout_day', (select coalesce(sum(value),0) from rej where d = p_date),
  'stockout_wk', (select coalesce(sum(value),0) from rej)
)
$fn$;
revoke all on function public.dash_store_detail(text, date) from public, anon, authenticated;
grant execute on function public.dash_store_detail(text, date) to service_role;

-- ---- from 180_area_detail.sql ----
create or replace function public.dash_area_detail(p_am text, p_date date)
returns jsonb language sql stable security definer
set search_path = public, landing
as $fn$
with o as (select internal_code as code, zomato_restaurant_id as rid, locality
           from public.outlets where active and area_manager = p_am),
ws as (select (p_date - 6)::date as s, p_date as e),
q as (
  select o.code, q.business_date::date as d, q.online_time_pct::numeric as online,
    round(q.offline_time::numeric/60) as offmin
  from landing.zomato_outlet_day_quality q join o on o.rid = q.restaurant_id, ws
  where q.superseded_by is null and q.business_date::date between ws.s and ws.e
),
items as (
  select i.zomato_order_id,
    string_agg(i.item_quantity || ' x ' || i.item_name, ', ' order by i.line_no::int) as basket
  from landing.zomato_business_order_item i join o on o.rid = i.restaurant_id
  where i.superseded_by is null group by 1
),
ord as (
  select o.code, b.business_date::date as d, b.zomato_order_id, b.order_state, it.basket,
    to_char(left(nullif(b.placed_at,'NA'),19)::timestamp + interval '5 hours 30 minutes','Dy DD') as dlabel,
    to_char(left(nullif(b.placed_at,'NA'),19)::timestamp + interval '5 hours 30 minutes','HH12:MI am') as tm,
    b.placed_at, b.rejection_reason, b.order_rating, b.complaint_on_order, b.complaint_reason,
    nullif(b.refund_amount_agreed,'NA')::numeric as refund, b.order_subtotal::numeric as subtotal,
    nullif(b.food_prep_time,'NA')::numeric as prep_min,
    extract(epoch from (left(nullif(b.picked_up_at,'NA'),19)::timestamp
      - left(nullif(b.rider_reached_outlet_at,'NA'),19)::timestamp))/60.0 as rider_wait
  from landing.zomato_business_order b join o on o.rid = b.restaurant_id
  left join items it on it.zomato_order_id = b.zomato_order_id, ws
  where b.superseded_by is null and b.business_date::date between ws.s and ws.e
),
wait_store as (
  select code,
    round(avg(rider_wait) filter (where order_state='Delivered' and d = p_date)::numeric,2) as wait_day,
    round(avg(rider_wait) filter (where order_state='Delivered')::numeric,2) as wait_wk,
    count(*) filter (where order_state='Delivered' and rider_wait >= 3) as waits3_wk,
    count(*) filter (where order_state='Delivered') as delivered_wk,
    count(*) filter (where order_state='Delivered' and prep_min <= 1 and rider_wait >= 3) as fr_wk,
    count(*) filter (where order_state='Delivered' and prep_min <= 1 and rider_wait >= 3 and d = p_date) as fr_day
  from ord group by code
),
money_store as (
  select code,
    coalesce(sum(subtotal) filter (where nullif(rejection_reason,'')
      in ('Items out of stock','Kitchen is full','Restaurant is closed','Timeout','Unavailable to accept the order')),0) as stockout_wk,
    coalesce(sum(refund),0) as refunds_wk,
    count(*) filter (where nullif(rejection_reason,'')
      in ('Items out of stock','Kitchen is full','Restaurant is closed','Timeout','Unavailable to accept the order')) as rej_wk,
    count(*) filter (where complaint_on_order='Yes') as comp_wk
  from ord group by code
)
select jsonb_build_object(
  'am', p_am, 'date', p_date, 'week_start', (select s from ws),
  'stores', (select coalesce(jsonb_agg(code order by code),'[]'::jsonb) from o),
  -- outlets that were not fully online on the selected day, with their 7-day line
  'online_dips', (select coalesce(jsonb_agg(x order by (x->>'online_day')::numeric), '[]'::jsonb) from (
      select jsonb_build_object('code', dd.code, 'online_day', dd.online, 'offmin_day', dd.offmin,
        'series', (select jsonb_agg(jsonb_build_object('d', q2.d, 'online', q2.online) order by q2.d)
                   from q q2 where q2.code = dd.code),
        'offmin_wk', (select sum(q3.offmin) from q q3 where q3.code = dd.code)) as x
      from q dd where dd.d = p_date and dd.online < 100) y),
  'rejections', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'dlabel', dlabel, 'time', tm, 'reason', rejection_reason,
      'basket', basket, 'value', round(subtotal), 'today', (d = p_date))
      order by placed_at desc), '[]'::jsonb)
    from ord where nullif(rejection_reason,'')
      in ('Items out of stock','Kitchen is full','Restaurant is closed','Timeout','Unavailable to accept the order')),
  'complaints', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'dlabel', dlabel, 'time', tm,
      'tag', coalesce(nullif(complaint_reason,''),'reason not tagged by Zomato'),
      'basket', basket, 'refund', round(coalesce(refund,0)), 'today', (d = p_date))
      order by placed_at desc), '[]'::jsonb)
    from ord where complaint_on_order = 'Yes'),
  'low_ratings', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'dlabel', dlabel, 'time', tm, 'rating', order_rating, 'basket', basket,
      'tag', nullif(complaint_reason,''), 'today', (d = p_date)) order by order_rating, placed_at desc), '[]'::jsonb)
    from ord where order_rating in ('1','2','3')),
  'wait_stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'wait_day', wait_day, 'wait_wk', wait_wk, 'waits3_wk', waits3_wk,
      'delivered_wk', delivered_wk, 'pct3', case when delivered_wk > 0
        then round(100.0*waits3_wk/delivered_wk,1) else null end)
      order by wait_wk desc nulls last), '[]'::jsonb) from wait_store),
  'fr_stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'fr_day', fr_day, 'fr_wk', fr_wk, 'delivered_wk', delivered_wk,
      'pct', case when delivered_wk > 0 then round(100.0*fr_wk/delivered_wk,1) else null end)
      order by fr_wk desc), '[]'::jsonb) from wait_store where fr_wk > 0),
  'fr_orders', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'dlabel', dlabel, 'time', tm, 'ready_secs', round(prep_min*60),
      'waited_min', round(rider_wait::numeric,1), 'basket', basket) order by rider_wait desc), '[]'::jsonb)
    from (select * from ord where order_state='Delivered' and prep_min <= 1 and rider_wait >= 3
          order by rider_wait desc limit 20) z),
  'money_stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'stockout_wk', round(stockout_wk), 'refunds_wk', round(refunds_wk),
      'total_wk', round(stockout_wk + refunds_wk), 'rej_wk', rej_wk, 'comp_wk', comp_wk)
      order by (stockout_wk + refunds_wk) desc), '[]'::jsonb)
    from money_store where (stockout_wk + refunds_wk) > 0)
)
$fn$;
revoke all on function public.dash_area_detail(text, date) from public, anon, authenticated;
grant execute on function public.dash_area_detail(text, date) to service_role;
