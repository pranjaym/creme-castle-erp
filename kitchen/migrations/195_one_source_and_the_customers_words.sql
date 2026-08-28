-- ============================================================
-- Migration 195: one source for order counts, and the customer's own words
-- (28 Aug 2026, both asked for by Pranjay after Ajay Rana's report)
--
-- PART 1: ORDER AND DELIVERED COUNTS MOVE TO THE ORDER-LEVEL FEED.
-- The page was mixing two sources and showing both: "Delivered 96 of 96" in a
-- tile and "3 of 98" two sections below, for the same store and day. Checked
-- three ways against Petpooja for the week to 22 Aug 2026, network-wide:
--
--   source                                 all orders   delivered
--   segment cube (what we used)               17,162      16,973
--   business order feed                       17,404      17,125
--   evening order-details feed                17,387      17,131
--   PETPOOJA, Zomato channel (the check)      17,396      17,140
--
-- The two order-level feeds land within 0.05% of Petpooja. The segment cube is
-- about 1% low because it is an aggregation across marketing segments and
-- drops orders that do not fit one. Matched order by order for one store over
-- a week, the evening feed and Petpooja agree on 553 delivered out of 553.
--
-- The evening feed wins over the business order feed because it covers the
-- whole history (603 days, from 1 Jan 2025) while the business feed starts on
-- 1 Aug 2026 and has gaps. Money stays on the segment cube: subtotal, net
-- sales, discounts, impressions, menu opens and ads exist nowhere else.
--
-- PART 2: THE CUSTOMER'S REVIEW TEXT, WHICH WE HELD AND NEVER SHOWED.
-- Pranjay: "I can see a lot of complaints written 'reason not tagged by
-- Zomato'. Are there other sources from where we can find those reasons?"
--
-- Checked. For complaint TAGS there is no second source: in the week to 22 Aug
-- the business feed tagged 246 of 810 complaints and the evening feed carries
-- 247 tags, which is the same set. Zomato simply does not record a reason for
-- roughly seven complaints in ten, in either export. Only 9 of the 564
-- untagged were recoverable.
--
-- But the evening feed carries something better that no page has ever shown:
-- the REVIEW THE CUSTOMER WROTE. In that same week, 38 of the 137 one-star
-- orders came with words, and they say what a tag never could:
--   "all cookies and biscuits were broken in the box not great handling"
--   "Feels not fresh I didn't like it.."
--   "Cake was very very creamy lots of cream.. taste was good.."
-- Every complaint and every rated order now carries its review where one
-- exists, and the evening feed's own complaint tag is used as a second chance
-- before falling back to "reason not tagged by Zomato".
-- ============================================================


CREATE OR REPLACE FUNCTION public.dash_all(p_date date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'landing'
AS $fn$
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
-- money for the day: the segment cube is the only source that carries it
sdm as (
  select restaurant_id, sum(subtotal_value::numeric) as subtotal
  from landing.zomato_outlet_day_segment
  where superseded_by is null and business_date::date = p_date
    and nrl_segment <> 'all' and offer_sensitivity <> 'all' and mealtime <> 'all'
  group by restaurant_id
),
-- counts for the day: one row per order, which is what ties to Petpooja
sd as (
  select restaurant_id, count(*)::numeric as orders,
    count(*) filter (where order_status = 'Delivered')::numeric as delivered
  from landing.zomato_order_details
  where superseded_by is null and order_date = p_date
  group by restaurant_id
),
swm as (
  select restaurant_id, sum(subtotal_value::numeric) as subtotal
  from landing.zomato_outlet_day_segment, ws
  where superseded_by is null and business_date::date between ws.s and ws.e
    and nrl_segment <> 'all' and offer_sensitivity <> 'all' and mealtime <> 'all'
  group by restaurant_id
),
sw as (
  select restaurant_id, count(*)::numeric as orders,
    count(*) filter (where order_status = 'Delivered')::numeric as delivered
  from landing.zomato_order_details, ws
  where superseded_by is null and order_date between ws.s and ws.e
  group by restaurant_id
),
sprev as (
  select restaurant_id, round(count(*)/7.0) as avgord
  from landing.zomato_order_details
  where superseded_by is null
    and order_date between (p_date - 7) and (p_date - 1)
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
        'orders', sd.orders, 'delivered', sd.delivered, 'subtotal', sdm.subtotal,
        'rating', qd.rating, 'comps', qd.comps, 'cpct', qd.cpct,
        'srej', qd.srej, 'rej', qd.rej, 'rpct', qd.rpct,
        'online', qd.online, 'offmin', qd.offmin,
        'wait', od.wait, 'fr', od.fr, 'avgord', sprev.avgord),
      'wk', jsonb_build_object(
        'orders', sw.orders, 'delivered', sw.delivered, 'subtotal', swm.subtotal,
        'rating', qw.rating, 'comps', qw.comps, 'srej', qw.srej, 'rej', qw.rej,
        'online', qw.online, 'offmin', qw.offmin,
        'wait', ow.wait, 'waits3', ow.waits3, 'fr', ow.fr,
        'stockout', ow.stockout, 'refunds', ow.refunds)
      ) order by o.internal_code), '[]'::jsonb)
    from public.outlets o
    left join qd on qd.restaurant_id = o.zomato_restaurant_id
    left join qw on qw.restaurant_id = o.zomato_restaurant_id
    left join sd on sd.restaurant_id = o.zomato_restaurant_id
    left join sdm on sdm.restaurant_id = o.zomato_restaurant_id
    left join sw on sw.restaurant_id = o.zomato_restaurant_id
    left join swm on swm.restaurant_id = o.zomato_restaurant_id
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
CREATE OR REPLACE FUNCTION public.dash_store_detail(p_code text, p_date date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'landing'
AS $fn$
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
items_fb as (
  -- F31 FALLBACK. Zomato's business item export has produced no item rows at
  -- all since 23 Aug 2026 (it returns Go pointer addresses where the item
  -- detail should be), so every basket on a recent day was rendering as a
  -- dash: "Items out of stock" with no item, which tells a store manager
  -- nothing. The EVENING order-history feed (landing.zomato_order_details,
  -- the 18:00 pull) still carries clean item text in the same
  -- "1 x Name, 2 x Name" shape, verified 100% populated for 22 to 26 Aug and
  -- dated on the same business day (offset 0 on all 2,302 orders checked).
  -- It is a fallback and not the primary because it carries names and
  -- quantities only: no catalogue id, category or unit cost. The window is
  -- widened by a day either side as a margin.
  -- extended 28 Aug 2026: the same feed also carries the customer's written
  -- REVIEW and Zomato's own complaint tag, neither of which any page has ever
  -- shown. The item condition moved inside the expression so an order with a
  -- review but no items is still picked up.
  select t.zomato_order_id,
    case when nullif(t.items_in_order, '') is not null and t.items_in_order not like '[0x%'
         then t.items_in_order end as basket,
    nullif(t.review, '') as review,
    nullif(t.customer_complaint_tag, '') as ev_tag
  from landing.zomato_order_details t, ws
  where t.superseded_by is null
    and t.order_date between (ws.s - 1) and (ws.e + 1)
),
ord as (
  select b.business_date::date as d, b.zomato_order_id, b.order_state, coalesce(it.basket, fb.basket) as basket, fb.review as review, fb.ev_tag as ev_tag,
    to_char(left(nullif(b.placed_at,'NA'),19)::timestamp,'Dy DD') as dlabel,
    to_char(left(nullif(b.placed_at,'NA'),19)::timestamp,'HH12:MI am') as tm,
    b.placed_at, b.rejection_reason, b.order_rating, b.complaint_on_order, b.complaint_reason,
    nullif(b.refund_amount_agreed,'NA')::numeric as refund, b.order_subtotal::numeric as subtotal,
    nullif(b.food_prep_time,'NA')::numeric as prep_min,
    extract(epoch from (left(nullif(b.picked_up_at,'NA'),19)::timestamp
      - left(nullif(b.rider_reached_outlet_at,'NA'),19)::timestamp))/60.0 as rider_wait
  from landing.zomato_business_order b
  join o on o.rid = b.restaurant_id
  left join items it on it.zomato_order_id = b.zomato_order_id
  left join items_fb fb on fb.zomato_order_id = b.zomato_order_id, ws
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
  select d, dlabel, tm, coalesce(nullif(complaint_reason,''), ev_tag, 'reason not tagged by Zomato') as tag,
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
      'time', tm, 'rating', order_rating, 'basket', basket, 'review', review, 'review', review) order by placed_at), '[]'::jsonb)
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
      'dlabel', dlabel, 'time', tm, 'rating', order_rating, 'basket', basket, 'review', review, 'review', review,
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

CREATE OR REPLACE FUNCTION public.dash_area_detail(p_am text, p_date date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'landing'
AS $fn$
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
items_fb as (
  -- F31 FALLBACK. Zomato's business item export has produced no item rows at
  -- all since 23 Aug 2026 (it returns Go pointer addresses where the item
  -- detail should be), so every basket on a recent day was rendering as a
  -- dash: "Items out of stock" with no item, which tells a store manager
  -- nothing. The EVENING order-history feed (landing.zomato_order_details,
  -- the 18:00 pull) still carries clean item text in the same
  -- "1 x Name, 2 x Name" shape, verified 100% populated for 22 to 26 Aug and
  -- dated on the same business day (offset 0 on all 2,302 orders checked).
  -- It is a fallback and not the primary because it carries names and
  -- quantities only: no catalogue id, category or unit cost. The window is
  -- widened by a day either side as a margin.
  -- extended 28 Aug 2026: the same feed also carries the customer's written
  -- REVIEW and Zomato's own complaint tag, neither of which any page has ever
  -- shown. The item condition moved inside the expression so an order with a
  -- review but no items is still picked up.
  select t.zomato_order_id,
    case when nullif(t.items_in_order, '') is not null and t.items_in_order not like '[0x%'
         then t.items_in_order end as basket,
    nullif(t.review, '') as review,
    nullif(t.customer_complaint_tag, '') as ev_tag
  from landing.zomato_order_details t, ws
  where t.superseded_by is null
    and t.order_date between (ws.s - 1) and (ws.e + 1)
),
ord as (
  select o.code, b.business_date::date as d, b.zomato_order_id, b.order_state, coalesce(it.basket, fb.basket) as basket, fb.review as review, fb.ev_tag as ev_tag,
    -- the day label is the BUSINESS date, never the wall clock: an order placed
    -- at 01:30 belongs to the previous business day (matches migration 190)
    to_char(b.business_date::date,'Dy DD') as dlabel,
    to_char(left(nullif(b.placed_at,'NA'),19)::timestamp,'HH12:MI am') as tm,
    b.placed_at, b.rejection_reason, b.order_rating, b.complaint_on_order, b.complaint_reason,
    nullif(b.refund_amount_agreed,'NA')::numeric as refund, b.order_subtotal::numeric as subtotal,
    nullif(b.food_prep_time,'NA')::numeric as prep_min,
    extract(epoch from (left(nullif(b.picked_up_at,'NA'),19)::timestamp
      - left(nullif(b.rider_reached_outlet_at,'NA'),19)::timestamp))/60.0 as rider_wait
  from landing.zomato_business_order b join o on o.rid = b.restaurant_id
  left join items it on it.zomato_order_id = b.zomato_order_id
  left join items_fb fb on fb.zomato_order_id = b.zomato_order_id, ws
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
      'tag', coalesce(nullif(complaint_reason,''), ev_tag, 'reason not tagged by Zomato'),
      'basket', basket, 'review', review, 'refund', round(coalesce(refund,0)), 'today', (d = p_date))
      order by placed_at desc), '[]'::jsonb)
    from ord where complaint_on_order = 'Yes'),
  'low_ratings', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'dlabel', dlabel, 'time', tm, 'rating', order_rating, 'basket', basket, 'review', review, 'review', review,
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
    from money_store where (stockout_wk + refunds_wk) > 0),
  -- Orders turned away because the SHOP WAS SHUT (added 26 Aug 2026 on
  -- Pranjay's instruction). Zomato only routes an order to a store it believes
  -- is OPEN, so every row here is a listing that was live while the shop could
  -- not serve. That makes it an opening-time and tablet question, never a stock
  -- question, and it is the one rejection reason that should never happen at
  -- all. The store's own online % for that day travels with each order as the
  -- proof that the listing was up, and the hour is carried because the pattern
  -- is in the clock: these cluster at opening time and overnight.
  'shut_orders', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', r.code, 'am', p_am, 'dlabel', r.dlabel, 'time', r.tm, 'reason', r.rejection_reason,
      'basket', r.basket, 'value', round(r.subtotal), 'today', (r.d = p_date),
      'hour', to_char(left(nullif(r.placed_at,'NA'),19)::timestamp,'HH24'),
      'online_day', (select q2.online from q q2 where q2.code = r.code and q2.d = r.d),
      'offmin_day', (select q2.offmin from q q2 where q2.code = r.code and q2.d = r.d))
      order by r.placed_at desc), '[]'::jsonb)
    from ord r where nullif(r.rejection_reason,'') in ('Restaurant is closed','Unavailable to accept the order')),
  'shut_stores', (select coalesce(jsonb_agg(x order by (x->>'orders')::int desc,
      (x->>'value')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object('code', code, 'am', p_am, 'orders', count(*),
        'value', round(sum(subtotal)), 'days', count(distinct d)) as x
      from ord where nullif(rejection_reason,'') in ('Restaurant is closed','Unavailable to accept the order')
      group by code) s),
  'shut_hours', (select coalesce(jsonb_agg(jsonb_build_object(
      'hour', h.hr, 'orders', h.n, 'value', h.v) order by h.hr), '[]'::jsonb) from (
      select to_char(left(nullif(placed_at,'NA'),19)::timestamp,'HH24') as hr,
        count(*) as n, round(sum(subtotal)) as v
      from ord where nullif(rejection_reason,'') in ('Restaurant is closed','Unavailable to accept the order')
      group by 1) h)
)
$fn$;

revoke all on function public.dash_area_detail(text, date) from public, anon, authenticated;
grant execute on function public.dash_area_detail(text, date) to service_role;

CREATE OR REPLACE FUNCTION public.dash_central_detail(p_date date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'landing'
AS $fn$
with o as (select internal_code as code, zomato_restaurant_id as rid,
                  locality, coalesce(area_manager,'Unassigned') as am
           from public.outlets where active),
ws as (select (p_date - 6)::date as s, p_date as e),
q as (
  select o.code, o.am, q.business_date::date as d, q.online_time_pct::numeric as online,
    round(q.offline_time::numeric/60) as offmin,
    q.total_complaints::numeric as comps,
    (q.item_out_of_stock::numeric + q.kitchen_is_full::numeric + q.outlet_closed::numeric
      + q.timeout::numeric + q.device_issues::numeric) as srej,
    q.average_food_order_rating::numeric as rating
  from landing.zomato_outlet_day_quality q join o on o.rid = q.restaurant_id, ws
  where q.superseded_by is null and q.business_date::date between ws.s and ws.e
),
items as (
  -- restricted to the 7-day window: unfiltered by restaurant this table is the
  -- whole network's item history, and the aggregate would scan all of it
  select i.zomato_order_id,
    string_agg(i.item_quantity || ' x ' || i.item_name, ', ' order by i.line_no::int) as basket
  from landing.zomato_business_order_item i, ws
  where i.superseded_by is null and i.business_date between ws.s and ws.e
  group by 1
),
items_fb as (
  -- F31 FALLBACK. Zomato's business item export has produced no item rows at
  -- all since 23 Aug 2026 (it returns Go pointer addresses where the item
  -- detail should be), so every basket on a recent day was rendering as a
  -- dash: "Items out of stock" with no item, which tells a store manager
  -- nothing. The EVENING order-history feed (landing.zomato_order_details,
  -- the 18:00 pull) still carries clean item text in the same
  -- "1 x Name, 2 x Name" shape, verified 100% populated for 22 to 26 Aug and
  -- dated on the same business day (offset 0 on all 2,302 orders checked).
  -- It is a fallback and not the primary because it carries names and
  -- quantities only: no catalogue id, category or unit cost. The window is
  -- widened by a day either side as a margin.
  -- extended 28 Aug 2026: the same feed also carries the customer's written
  -- REVIEW and Zomato's own complaint tag, neither of which any page has ever
  -- shown. The item condition moved inside the expression so an order with a
  -- review but no items is still picked up.
  select t.zomato_order_id,
    case when nullif(t.items_in_order, '') is not null and t.items_in_order not like '[0x%'
         then t.items_in_order end as basket,
    nullif(t.review, '') as review,
    nullif(t.customer_complaint_tag, '') as ev_tag
  from landing.zomato_order_details t, ws
  where t.superseded_by is null
    and t.order_date between (ws.s - 1) and (ws.e + 1)
),
ord as (
  select o.code, o.am, b.business_date::date as d, b.order_state, coalesce(it.basket, fb.basket) as basket, fb.review as review, fb.ev_tag as ev_tag,
    -- the day label is the BUSINESS date, never the wall clock: an order placed
    -- at 01:30 belongs to the previous business day, and labelling it by its
    -- timestamp put "Sat 15" rows inside the "earlier this week" list
    to_char(b.business_date::date,'Dy DD') as dlabel,
    to_char(left(nullif(b.placed_at,'NA'),19)::timestamp,'HH12:MI am') as tm,
    b.placed_at, b.rejection_reason, b.order_rating, b.complaint_on_order, b.complaint_reason,
    nullif(b.refund_amount_agreed,'NA')::numeric as refund, b.order_subtotal::numeric as subtotal,
    nullif(b.food_prep_time,'NA')::numeric as prep_min,
    extract(epoch from (left(nullif(b.picked_up_at,'NA'),19)::timestamp
      - left(nullif(b.rider_reached_outlet_at,'NA'),19)::timestamp))/60.0 as rider_wait
  from landing.zomato_business_order b join o on o.rid = b.restaurant_id
  left join items it on it.zomato_order_id = b.zomato_order_id
  left join items_fb fb on fb.zomato_order_id = b.zomato_order_id, ws
  where b.superseded_by is null and b.business_date::date between ws.s and ws.e
),
wait_store as (
  select code, am,
    round(avg(rider_wait) filter (where order_state='Delivered' and d = p_date)::numeric,2) as wait_day,
    round(avg(rider_wait) filter (where order_state='Delivered')::numeric,2) as wait_wk,
    count(*) filter (where order_state='Delivered' and rider_wait >= 3) as waits3_wk,
    count(*) filter (where order_state='Delivered') as delivered_wk,
    count(*) filter (where order_state='Delivered' and prep_min <= 1 and rider_wait >= 3) as fr_wk,
    count(*) filter (where order_state='Delivered' and prep_min <= 1 and rider_wait >= 3 and d = p_date) as fr_day
  from ord group by code, am
),
money_store as (
  select code, am,
    coalesce(sum(subtotal) filter (where nullif(rejection_reason,'')
      in ('Items out of stock','Kitchen is full','Restaurant is closed','Timeout','Unavailable to accept the order')),0) as stockout_wk,
    coalesce(sum(refund),0) as refunds_wk,
    count(*) filter (where nullif(rejection_reason,'')
      in ('Items out of stock','Kitchen is full','Restaurant is closed','Timeout','Unavailable to accept the order')) as rej_wk,
    count(*) filter (where complaint_on_order='Yes') as comp_wk
  from ord group by code, am
),
-- Levers. The segment cube carries the F25 filter, exactly as dash_all does.
seg as (
  select o.code, o.am, s.business_date::date as d,
    sum(s.subtotal_value::numeric) as subtotal, sum(s.net_sales::numeric) as net_sales,
    sum(s.orders_received::numeric) as orders,
    sum(s.promo_discount::numeric + s.dish_discounts::numeric + s.bogo_discount::numeric
        + s.freebie::numeric + s.gold_discount::numeric) as discount,
    sum(s.orders_with_offers::numeric) as offer_orders,
    sum(s.impressions::numeric) as impressions, sum(s.menu_opens::numeric) as menu_opens
  from landing.zomato_outlet_day_segment s join o on o.rid = s.restaurant_id, ws
  where s.superseded_by is null and s.business_date::date between ws.s and ws.e
    and s.nrl_segment <> 'all' and s.offer_sensitivity <> 'all' and s.mealtime <> 'all'
  group by 1,2,3
),
ads as (
  select o.code, o.am, a.business_date::date as d,
    sum(a.ad_spends::numeric) as spend, sum(a.net_sales_from_ads::numeric) as ad_sales,
    sum(a.orders_from_ads::numeric) as ad_orders
  from landing.zomato_outlet_day_ads_segment a join o on o.rid = a.restaurant_id, ws
  where a.superseded_by is null and a.segment_type = 'spending_potential'
    and a.business_date::date between ws.s and ws.e
  group by 1,2,3
),
lever_store as (
  select o.code, o.am,
    coalesce(sum(s.subtotal) filter (where s.d = p_date),0) as sub_day,
    coalesce(sum(s.discount) filter (where s.d = p_date),0) as disc_day,
    coalesce(sum(s.subtotal),0) as sub_wk,
    coalesce(sum(s.discount),0) as disc_wk,
    coalesce(sum(s.net_sales),0) as net_wk,
    coalesce(sum(s.orders),0) as orders_wk,
    coalesce(sum(s.offer_orders),0) as offer_orders_wk,
    coalesce(sum(s.impressions),0) as impr_wk,
    coalesce(sum(s.menu_opens),0) as opens_wk,
    coalesce((select sum(a.spend) from ads a where a.code = o.code and a.d = p_date),0) as spend_day,
    coalesce((select sum(a.spend) from ads a where a.code = o.code),0) as spend_wk,
    coalesce((select sum(a.ad_sales) from ads a where a.code = o.code),0) as adsales_wk,
    coalesce((select sum(a.ad_orders) from ads a where a.code = o.code),0) as adorders_wk
  from o left join seg s on s.code = o.code
  group by o.code, o.am
)
select jsonb_build_object(
  'date', p_date, 'week_start', (select s from ws),
  'stores', (select coalesce(jsonb_agg(code order by code),'[]'::jsonb) from o),
  'ams', (select coalesce(jsonb_agg(distinct am),'[]'::jsonb) from o),
  -- the network's own 7-day line, one row per day
  'trend', (select coalesce(jsonb_agg(jsonb_build_object(
      'd', t.d, 'orders', t.orders, 'comps', t.comps,
      'cpct', case when t.orders > 0 then round(100.0*t.comps/t.orders,2) else null end,
      'srej', t.srej, 'online', t.online, 'rating', t.rating,
      'wait', t.wait, 'discount_pct', t.discount_pct, 'spend', t.spend, 'roi', t.roi)
      order by t.d), '[]'::jsonb)
    from (
      select g.d,
        (select sum(s.orders) from seg s where s.d = g.d) as orders,
        (select sum(q2.comps) from q q2 where q2.d = g.d) as comps,
        (select sum(q2.srej) from q q2 where q2.d = g.d) as srej,
        (select round(avg(q2.online),2) from q q2 where q2.d = g.d) as online,
        (select round(avg(q2.rating) filter (where q2.rating > 0),2) from q q2 where q2.d = g.d) as rating,
        (select round(avg(r.rider_wait) filter (where r.order_state='Delivered')::numeric,2)
           from ord r where r.d = g.d) as wait,
        (select case when sum(s.subtotal) > 0 then round(100.0*sum(s.discount)/sum(s.subtotal),1) end
           from seg s where s.d = g.d) as discount_pct,
        (select round(sum(a.spend)) from ads a where a.d = g.d) as spend,
        (select case when sum(a.spend) > 0 then round(sum(a.ad_sales)/sum(a.spend),1) end
           from ads a where a.d = g.d) as roi
      from (select distinct d from q) g) t),
  -- outlets that were not fully online on the selected day, with their 7-day line
  'online_dips', (select coalesce(jsonb_agg(x order by (x->>'online_day')::numeric), '[]'::jsonb) from (
      select jsonb_build_object('code', dd.code, 'am', dd.am, 'online_day', dd.online,
        'offmin_day', dd.offmin,
        'series', (select jsonb_agg(jsonb_build_object('d', q2.d, 'online', q2.online) order by q2.d)
                   from q q2 where q2.code = dd.code),
        'offmin_wk', (select sum(q3.offmin) from q q3 where q3.code = dd.code)) as x
      from q dd where dd.d = p_date and dd.online < 100) y),
  'rejections', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'am', am, 'dlabel', dlabel, 'time', tm, 'reason', rejection_reason,
      'basket', basket, 'value', round(subtotal), 'today', (d = p_date))
      order by placed_at desc), '[]'::jsonb)
    from ord where nullif(rejection_reason,'')
      in ('Items out of stock','Kitchen is full','Restaurant is closed','Timeout','Unavailable to accept the order')),
  -- complaints: the day in full, the rest of the week newest-first and capped,
  -- because a network week runs to several hundred orders. The cap is stated
  -- on the page and every store page carries its own full list.
  'complaints', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', c.code, 'am', c.am, 'dlabel', c.dlabel, 'time', c.tm,
      'tag', coalesce(nullif(c.complaint_reason,''), c.ev_tag, 'reason not tagged by Zomato'),
      'basket', c.basket, 'review', c.review, 'refund', round(coalesce(c.refund,0)), 'today', (c.d = p_date))
      order by c.placed_at desc), '[]'::jsonb)
    from (select * from ord where complaint_on_order = 'Yes'
          order by placed_at desc limit 600) c),
  'complaints_total', (select count(*) from ord where complaint_on_order = 'Yes'),
  'low_ratings', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', l.code, 'am', l.am, 'dlabel', l.dlabel, 'time', l.tm, 'rating', l.order_rating,
      'basket', l.basket, 'review', l.review, 'tag', nullif(l.complaint_reason,''), 'today', (l.d = p_date))
      order by l.order_rating, l.placed_at desc), '[]'::jsonb)
    from (select * from ord where order_rating in ('1','2','3')
          order by order_rating, placed_at desc limit 400) l),
  'low_ratings_total', (select count(*) from ord where order_rating in ('1','2','3')),
  'wait_stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'am', am, 'wait_day', wait_day, 'wait_wk', wait_wk, 'waits3_wk', waits3_wk,
      'delivered_wk', delivered_wk, 'pct3', case when delivered_wk > 0
        then round(100.0*waits3_wk/delivered_wk,1) else null end)
      order by wait_wk desc nulls last), '[]'::jsonb) from wait_store),
  'fr_stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'am', am, 'fr_day', fr_day, 'fr_wk', fr_wk, 'delivered_wk', delivered_wk,
      'pct', case when delivered_wk > 0 then round(100.0*fr_wk/delivered_wk,1) else null end)
      order by fr_wk desc), '[]'::jsonb) from wait_store where fr_wk > 0),
  'fr_orders', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'am', am, 'dlabel', dlabel, 'time', tm, 'ready_secs', round(prep_min*60),
      'waited_min', round(rider_wait::numeric,1), 'basket', basket) order by rider_wait desc), '[]'::jsonb)
    from (select * from ord where order_state='Delivered' and prep_min <= 1 and rider_wait >= 3
          order by rider_wait desc limit 25) z),
  'money_stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'am', am, 'stockout_wk', round(stockout_wk), 'refunds_wk', round(refunds_wk),
      'total_wk', round(stockout_wk + refunds_wk), 'rej_wk', rej_wk, 'comp_wk', comp_wk)
      order by (stockout_wk + refunds_wk) desc), '[]'::jsonb)
    from money_store where (stockout_wk + refunds_wk) > 0),
  -- the levers, per store: a discount or an ad rupee also names its outlet
  'lever_stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'am', am,
      'sub_day', round(sub_day), 'disc_day', round(disc_day),
      'disc_pct_day', case when sub_day > 0 then round(100.0*disc_day/sub_day,1) end,
      'sub_wk', round(sub_wk), 'disc_wk', round(disc_wk),
      'disc_pct_wk', case when sub_wk > 0 then round(100.0*disc_wk/sub_wk,1) end,
      'net_wk', round(net_wk), 'orders_wk', orders_wk,
      'offer_pct_wk', case when orders_wk > 0 then round(100.0*offer_orders_wk/orders_wk,1) end,
      'spend_day', round(spend_day), 'spend_wk', round(spend_wk),
      'adsales_wk', round(adsales_wk), 'adorders_wk', adorders_wk,
      'roi_wk', case when spend_wk > 0 then round(adsales_wk/spend_wk,1) end,
      'impr_wk', impr_wk, 'opens_wk', opens_wk,
      'open_pct_wk', case when impr_wk > 0 then round(100.0*opens_wk/impr_wk,2) end,
      'conv_pct_wk', case when opens_wk > 0 then round(100.0*orders_wk/opens_wk,1) end)
      order by disc_wk desc), '[]'::jsonb) from lever_store),
  -- Orders turned away because the SHOP WAS SHUT (added 26 Aug 2026 on
  -- Pranjay's instruction). Zomato only routes an order to a store it believes
  -- is OPEN, so every row here is a listing that was live while the shop could
  -- not serve. That makes it an opening-time and tablet question, never a stock
  -- question, and it is the one rejection reason that should never happen at
  -- all. The store's own online % for that day travels with each order as the
  -- proof that the listing was up, and the hour is carried because the pattern
  -- is in the clock: these cluster at opening time and overnight.
  'shut_orders', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', r.code, 'am', r.am, 'dlabel', r.dlabel, 'time', r.tm, 'reason', r.rejection_reason,
      'basket', r.basket, 'value', round(r.subtotal), 'today', (r.d = p_date),
      'hour', to_char(left(nullif(r.placed_at,'NA'),19)::timestamp,'HH24'),
      'online_day', (select q2.online from q q2 where q2.code = r.code and q2.d = r.d),
      'offmin_day', (select q2.offmin from q q2 where q2.code = r.code and q2.d = r.d))
      order by r.placed_at desc), '[]'::jsonb)
    from ord r where nullif(r.rejection_reason,'') in ('Restaurant is closed','Unavailable to accept the order')),
  'shut_stores', (select coalesce(jsonb_agg(x order by (x->>'orders')::int desc,
      (x->>'value')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object('code', code, 'am', am, 'orders', count(*),
        'value', round(sum(subtotal)), 'days', count(distinct d)) as x
      from ord where nullif(rejection_reason,'') in ('Restaurant is closed','Unavailable to accept the order')
      group by code, am) s),
  'shut_hours', (select coalesce(jsonb_agg(jsonb_build_object(
      'hour', h.hr, 'orders', h.n, 'value', h.v) order by h.hr), '[]'::jsonb) from (
      select to_char(left(nullif(placed_at,'NA'),19)::timestamp,'HH24') as hr,
        count(*) as n, round(sum(subtotal)) as v
      from ord where nullif(rejection_reason,'') in ('Restaurant is closed','Unavailable to accept the order')
      group by 1) h)
)
$fn$;

revoke all on function public.dash_central_detail(date) from public, anon, authenticated;
grant execute on function public.dash_central_detail(date) to service_role;
