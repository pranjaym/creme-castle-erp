-- ============================================================
-- Creme Castle Spine, Migration 150: DAILY DASHBOARD FUNCTIONS (portal Phase 2)
-- Target: the spine Supabase project. Additive; read-only functions.
--
-- Two functions serve the portal's daily dashboard module (store / area /
-- central). The definitions live HERE so the numbers are canonical in the
-- database (rule 1) and every renderer (portal pages, the daily mailer)
-- reads the same figures.
--
--   public.dash_all(p_date)                network-wide per-store day + week
--   public.dash_store_detail(p_code, p_date)  one store's trend + receipts
--
-- Data rules baked in (verified 23 Aug 2026):
--  - Sales/orders come from the segment cube with the F25 filter
--    (nrl/sensitivity/mealtime <> 'all') so double-loaded shapes never
--    double-count; this reconciles exactly with the order table.
--  - Kitchen preparation time is EXCLUDED (measures button pressing, not
--    kitchen work). Rider wait (rider-reached to picked-up) is the verified
--    speed measure. False-ready = marked ready within 1 min of accepting AND
--    rider waited 3+ min.
--  - Order-level fields exist from Aug 2026 only; before that they return
--    null/empty and the pages say so.
--  - Timestamps in the order table are IST wearing a fake UTC label; the
--    stored placed_at_ist is true UTC, so IST display adds 5h30.
-- Execution is restricted to service_role (the portal's server side).
-- ============================================================

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
      in ('Items out of stock','Kitchen is full','Outlet closed','Timeout','Device issues')),0)) as stockout,
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

create or replace function public.dash_store_detail(p_code text, p_date date)
returns jsonb
language sql stable
security definer
set search_path = public, landing
as $fn$
with o as (select zomato_restaurant_id as rid, internal_code, locality, city, area_manager
           from public.outlets where internal_code = p_code),
ws as (select (p_date - 6)::date as s, p_date as e),
trend as (
  select q.business_date::date as d,
    q.online_time_pct::numeric as online, q.total_complaints::numeric as comps,
    (q.item_out_of_stock::numeric + q.kitchen_is_full::numeric + q.outlet_closed::numeric
      + q.timeout::numeric + q.device_issues::numeric) as srej,
    q.average_food_order_rating::numeric as rating
  from landing.zomato_outlet_day_quality q, o, ws
  where q.superseded_by is null and q.restaurant_id = o.rid
    and q.business_date::date between ws.s and ws.e
),
seg_days as (
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
  select b.*, it.basket,
    extract(epoch from (left(nullif(b.picked_up_at,'NA'),19)::timestamp
      - left(nullif(b.rider_reached_outlet_at,'NA'),19)::timestamp))/60.0 as rider_wait,
    nullif(b.food_prep_time,'NA')::numeric as prep_min,
    to_char(left(nullif(b.placed_at,'NA'),19)::timestamp + interval '5 hours 30 minutes',
      'Dy DD, HH12:MI am') as placed_label
  from landing.zomato_business_order b
  join o on o.rid = b.restaurant_id
  left join items it on it.zomato_order_id = b.zomato_order_id, ws
  where b.superseded_by is null and b.business_date::date between ws.s and ws.e
)
select jsonb_build_object(
  'code', (select internal_code from o),
  'locality', (select locality from o), 'city', (select city from o),
  'am', (select area_manager from o),
  'date', p_date, 'week_start', (select s from ws),
  'trend', (select coalesce(jsonb_agg(jsonb_build_object(
      'd', t.d, 'online', t.online, 'comps', t.comps, 'srej', t.srej,
      'rating', t.rating, 'orders', sd.orders) order by t.d), '[]'::jsonb)
    from trend t left join seg_days sd on sd.d = t.d),
  'mealtime_wk', (select coalesce(jsonb_object_agg(mealtime, orders), '{}'::jsonb) from meal),
  'complaints_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'label', placed_label, 'basket', basket,
      'tag', coalesce(nullif(complaint_reason,''), 'issue reported'),
      'refund', nullif(refund_amount_agreed,'NA')) order by placed_at), '[]'::jsonb)
    from ord where business_date::date = p_date and complaint_on_order = 'Yes'),
  'rated_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'label', placed_label, 'basket', basket, 'rating', order_rating) order by placed_at), '[]'::jsonb)
    from ord where business_date::date = p_date
      and nullif(order_rating,'') is not null and order_rating not in ('NA','0')),
  'rejections_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'label', placed_label, 'basket', basket, 'reason', rejection_reason,
      'value', order_subtotal) order by placed_at desc), '[]'::jsonb)
    from ord where nullif(rejection_reason,'')
      in ('Items out of stock','Kitchen is full','Outlet closed','Timeout','Device issues')),
  'other_cancels_wk', (select count(*) from ord
    where nullif(rejection_reason,'') is not null and rejection_reason <> 'NA'
      and rejection_reason not in ('Items out of stock','Kitchen is full','Outlet closed','Timeout','Device issues')),
  'false_ready_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'label', placed_label, 'basket', basket,
      'ready_secs', round(prep_min * 60), 'waited_min', round(rider_wait::numeric, 1))
      order by rider_wait desc), '[]'::jsonb)
    from (select * from ord where order_state = 'Delivered' and prep_min <= 1
          and rider_wait >= 3 order by rider_wait desc limit 25) x),
  'low_ratings_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'label', placed_label, 'basket', basket, 'rating', order_rating,
      'tag', nullif(complaint_reason,'')) order by placed_at desc), '[]'::jsonb)
    from (select * from ord where order_rating in ('1','2')
          order by placed_at desc limit 25) x),
  'refunds_day', (select round(coalesce(sum(nullif(refund_amount_agreed,'NA')::numeric),0))
    from ord where business_date::date = p_date),
  'refunds_wk', (select round(coalesce(sum(nullif(refund_amount_agreed,'NA')::numeric),0)) from ord),
  'stockout_wk', (select round(coalesce(sum(order_subtotal::numeric),0)) from ord
    where nullif(rejection_reason,'')
      in ('Items out of stock','Kitchen is full','Outlet closed','Timeout','Device issues'))
)
$fn$;

revoke all on function public.dash_all(date) from public, anon, authenticated;
revoke all on function public.dash_store_detail(text, date) from public, anon, authenticated;
grant execute on function public.dash_all(date) to service_role;
grant execute on function public.dash_store_detail(text, date) to service_role;
