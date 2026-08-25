-- ============================================================
-- Migration 170: dash_store_detail v3 (approved store page design, 25 Aug 2026)
--
-- The v3 store page shows a labelled "Yesterday" block and a labelled
-- "Last 7 days" block in every section, and every number lists its orders.
-- This replaces dash_store_detail with the richer shape that needs:
--   - trend: adds offline minutes and average rider wait per day
--   - complaints for the WEEK (not just the day), each with its order tag
--   - rejections and false-ready split into day and week
--   - each receipt carries d (date), dlabel (Fri 14) and time (clock only),
--     because a post-midnight order belongs to the previous business day and
--     showing the raw date confuses readers
-- Vocabulary note (the 25 Aug bug): order rows carry Zomato's ORDER-level
-- complaint tags, which differ from the words in Zomato's daily report. The
-- page builds its filters from these row tags; the daily report's counts come
-- from dash_store_reasons and are shown separately.
-- ============================================================

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
    in ('Items out of stock','Kitchen is full','Outlet closed','Timeout','Device issues')
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
      and rejection_reason not in ('Items out of stock','Kitchen is full','Outlet closed','Timeout','Device issues')),
  'refunds_day', (select round(coalesce(sum(refund),0)) from comp where d = p_date),
  'refunds_wk', (select round(coalesce(sum(refund),0)) from comp),
  'stockout_day', (select coalesce(sum(value),0) from rej where d = p_date),
  'stockout_wk', (select coalesce(sum(value),0) from rej)
)
$fn$;
revoke all on function public.dash_store_detail(text, date) from public, anon, authenticated;
grant execute on function public.dash_store_detail(text, date) to service_role;
