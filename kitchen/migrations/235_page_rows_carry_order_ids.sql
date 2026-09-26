-- ============================================================
-- Migration 235: every order row on the daily pages carries its order id.
-- (26 Sep 2026, for the Questions module, migration 234.)
--
-- A question is attached to a ROW, and a row needs a stable key. The page
-- functions had the Zomato and Swiggy order ids in their queries all along
-- but never output them. This adds 'oid' to every order-level row object in
-- dash_store_detail and dash_area_detail (Zomato, from 225) and in
-- dash_store_swiggy and dash_area_swiggy (from 213), whose shared building
-- blocks swiggy_cancels and swiggy_rated gain an oid column (their return
-- type changes, so they are dropped and recreated; dash_central_swiggy reads
-- them with select * and is untouched).
--
-- Derived mechanically from 225 and 213 with counted replacements and
-- nothing else. No figure on any page changes; one more field per row.
-- ============================================================

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
    b.placed_at, b.rejection_reason, b.rejected_by, b.order_rating, b.complaint_on_order, b.complaint_reason,
    (coalesce(b.rejected_by,'') = 'Cancelled' and nullif(b.picked_up_at,'NA') is not null) as returned,
    coalesce(nullif(b.compensation_for_customer_cancellation,'NA')::numeric,0) as comp,
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
  select d, dlabel, tm, rejection_reason, basket, round(subtotal) as value, placed_at, zomato_order_id
  from ord where (order_state <> 'Delivered' and rejected_by = 'Mx rejected')
),
comp as (
  select d, dlabel, tm, coalesce(nullif(complaint_reason,''), ev_tag, 'reason not tagged by Zomato') as tag,
    basket, round(coalesce(refund,0)) as refund, placed_at, zomato_order_id
  from ord where complaint_on_order = 'Yes'
),
fr as (
  select d, dlabel, tm, round(prep_min * 60) as ready_secs,
    round(rider_wait::numeric,1) as waited_min, basket, zomato_order_id
  from ord where order_state = 'Delivered' and prep_min <= 1 and rider_wait >= 3
),
-- F49: cancelled by Zomato AFTER the rider picked up (the customer could not
-- receive it). Not the store's fault; Zomato pays compensation; the net is the
-- food that came back. Listed on its own, never under "turned away".
ret as (
  select d, dlabel, tm, rejection_reason, basket, round(subtotal) as value,
    round(comp) as comp, round(greatest(subtotal - comp, 0)) as net, placed_at, zomato_order_id
  from ord where returned
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
      'oid', zomato_order_id, 'time', tm, 'tag', tag, 'basket', basket, 'refund', refund) order by placed_at), '[]'::jsonb)
    from comp where d = p_date),
  'complaints_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', zomato_order_id, 'd', d, 'dlabel', dlabel, 'time', tm, 'tag', tag, 'basket', basket, 'refund', refund)
      order by placed_at desc), '[]'::jsonb) from comp where d <> p_date),
  'rated_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', zomato_order_id, 'time', tm, 'rating', order_rating, 'basket', basket, 'review', review, 'review', review) order by placed_at), '[]'::jsonb)
    from ord where d = p_date and nullif(order_rating,'') is not null and order_rating not in ('NA','0')),
  'rejections_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', zomato_order_id, 'time', tm, 'reason', rejection_reason, 'basket', basket, 'value', value)
      order by placed_at), '[]'::jsonb) from rej where d = p_date),
  'rejections_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', zomato_order_id, 'dlabel', dlabel, 'time', tm, 'reason', rejection_reason, 'basket', basket, 'value', value)
      order by placed_at desc), '[]'::jsonb) from rej where d <> p_date),
  'false_ready_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', zomato_order_id, 'time', tm, 'ready_secs', ready_secs, 'waited_min', waited_min, 'basket', basket)
      order by waited_min desc), '[]'::jsonb) from fr where d = p_date),
  'false_ready_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', zomato_order_id, 'dlabel', dlabel, 'time', tm, 'ready_secs', ready_secs, 'waited_min', waited_min, 'basket', basket)
      order by waited_min desc), '[]'::jsonb)
    from (select * from fr where d <> p_date order by waited_min desc limit 12) x),
  'low_ratings_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', zomato_order_id, 'dlabel', dlabel, 'time', tm, 'rating', order_rating, 'basket', basket, 'review', review, 'review', review,
      'tag', nullif(complaint_reason,'')) order by placed_at desc), '[]'::jsonb)
    from (select * from ord where order_rating in ('1','2') order by placed_at desc limit 20) x),
  'waits3_day', (select coalesce(waits3,0) from owait where d = p_date),
  'waits3_wk', (select coalesce(sum(waits3),0) from owait),
  'delivered_day', (select coalesce(delivered,0) from owait where d = p_date),
  'other_cancels_wk', (select count(*) from ord
    where nullif(rejection_reason,'') is not null and rejection_reason <> 'NA'
      and coalesce(rejected_by,'') <> 'Mx rejected' and not returned),
  'refunds_day', (select round(coalesce(sum(refund),0)) from comp where d = p_date),
  'refunds_wk', (select round(coalesce(sum(refund),0)) from comp),
  'stockout_day', (select coalesce(sum(value),0) from rej where d = p_date),
  'stockout_wk', (select coalesce(sum(value),0) from rej),
  'returned_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', zomato_order_id, 'time', tm, 'reason', rejection_reason, 'basket', basket, 'value', value, 'comp', comp, 'net', net)
      order by placed_at), '[]'::jsonb) from ret where d = p_date),
  'returned_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', zomato_order_id, 'dlabel', dlabel, 'time', tm, 'reason', rejection_reason, 'basket', basket, 'value', value, 'comp', comp, 'net', net)
      order by placed_at desc), '[]'::jsonb) from ret where d <> p_date),
  'returned_loss_day', (select coalesce(sum(net),0) from ret where d = p_date),
  'returned_loss_wk', (select coalesce(sum(net),0) from ret)
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
    b.placed_at, b.rejection_reason, b.rejected_by, b.order_rating, b.complaint_on_order, b.complaint_reason,
    (coalesce(b.rejected_by,'') = 'Cancelled' and nullif(b.picked_up_at,'NA') is not null) as returned,
    coalesce(nullif(b.compensation_for_customer_cancellation,'NA')::numeric,0) as comp,
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
    coalesce(sum(subtotal) filter (where (order_state <> 'Delivered' and rejected_by = 'Mx rejected')),0) as stockout_wk,
    coalesce(sum(refund),0) as refunds_wk,
    coalesce(sum(greatest(subtotal - comp, 0)) filter (where returned),0) as returned_wk,
    count(*) filter (where returned) as returned_n_wk,
    count(*) filter (where (order_state <> 'Delivered' and rejected_by = 'Mx rejected')) as rej_wk,
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
      'oid', zomato_order_id, 'code', code, 'dlabel', dlabel, 'time', tm, 'reason', rejection_reason,
      'basket', basket, 'value', round(subtotal), 'today', (d = p_date))
      order by placed_at desc), '[]'::jsonb)
    from ord where (order_state <> 'Delivered' and rejected_by = 'Mx rejected')),
  'complaints', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', zomato_order_id, 'code', code, 'dlabel', dlabel, 'time', tm,
      'tag', coalesce(nullif(complaint_reason,''), ev_tag, 'reason not tagged by Zomato'),
      'basket', basket, 'review', review, 'refund', round(coalesce(refund,0)), 'today', (d = p_date))
      order by placed_at desc), '[]'::jsonb)
    from ord where complaint_on_order = 'Yes'),
  'low_ratings', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', zomato_order_id, 'code', code, 'dlabel', dlabel, 'time', tm, 'rating', order_rating, 'basket', basket, 'review', review, 'review', review,
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
      'oid', zomato_order_id, 'code', code, 'dlabel', dlabel, 'time', tm, 'ready_secs', round(prep_min*60),
      'waited_min', round(rider_wait::numeric,1), 'basket', basket) order by rider_wait desc), '[]'::jsonb)
    from (select * from ord where order_state='Delivered' and prep_min <= 1 and rider_wait >= 3
          order by rider_wait desc limit 20) z),
  'money_stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', code, 'stockout_wk', round(stockout_wk), 'refunds_wk', round(refunds_wk),
      'total_wk', round(stockout_wk + refunds_wk), 'rej_wk', rej_wk, 'comp_wk', comp_wk,
      'returned_wk', round(returned_wk), 'returned_n_wk', returned_n_wk)
      order by (stockout_wk + refunds_wk) desc), '[]'::jsonb)
    from money_store where (stockout_wk + refunds_wk + returned_wk) > 0),
  -- Orders turned away because the SHOP WAS SHUT (added 26 Aug 2026 on
  -- Pranjay's instruction). Zomato only routes an order to a store it believes
  -- is OPEN, so every row here is a listing that was live while the shop could
  -- not serve. That makes it an opening-time and tablet question, never a stock
  -- question, and it is the one rejection reason that should never happen at
  -- all. The store's own online % for that day travels with each order as the
  -- proof that the listing was up, and the hour is carried because the pattern
  -- is in the clock: these cluster at opening time and overnight.
  'returned', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', zomato_order_id, 'code', code, 'am', p_am, 'dlabel', dlabel, 'time', tm, 'reason', rejection_reason,
      'basket', basket, 'value', round(subtotal), 'comp', round(comp),
      'net', round(greatest(subtotal - comp, 0)), 'today', (d = p_date))
      order by placed_at desc), '[]'::jsonb) from ord where returned),
  'shut_orders', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', r.zomato_order_id, 'code', r.code, 'am', p_am, 'dlabel', r.dlabel, 'time', r.tm, 'reason', r.rejection_reason,
      'basket', r.basket, 'value', round(r.subtotal), 'today', (r.d = p_date),
      'hour', to_char(left(nullif(r.placed_at,'NA'),19)::timestamp,'HH24'),
      'online_day', (select q2.online from q q2 where q2.code = r.code and q2.d = r.d),
      'offmin_day', (select q2.offmin from q q2 where q2.code = r.code and q2.d = r.d))
      order by r.placed_at desc), '[]'::jsonb)
    from ord r where r.rejection_reason = 'Restaurant is closed' and (r.order_state <> 'Delivered' and r.rejected_by = 'Mx rejected')),
  'shut_stores', (select coalesce(jsonb_agg(x order by (x->>'orders')::int desc,
      (x->>'value')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object('code', code, 'am', p_am, 'orders', count(*),
        'value', round(sum(subtotal)), 'days', count(distinct d)) as x
      from ord where rejection_reason = 'Restaurant is closed' and (order_state <> 'Delivered' and rejected_by = 'Mx rejected')
      group by code) s),
  'shut_hours', (select coalesce(jsonb_agg(jsonb_build_object(
      'hour', h.hr, 'orders', h.n, 'value', h.v) order by h.hr), '[]'::jsonb) from (
      select to_char(left(nullif(placed_at,'NA'),19)::timestamp,'HH24') as hr,
        count(*) as n, round(sum(subtotal)) as v
      from ord where rejection_reason = 'Restaurant is closed' and (order_state <> 'Delivered' and rejected_by = 'Mx rejected')
      group by 1) h)
)
$fn$;

revoke all on function public.dash_area_detail(text, date) from public, anon, authenticated;
grant execute on function public.dash_area_detail(text, date) to service_role;

drop function if exists public.swiggy_cancels(date, date);
drop function if exists public.swiggy_rated(date, date);

create or replace function public.swiggy_cancels(p_from date, p_to date)
returns table (rid text, code text, d date, t timestamp, why text,
               prep boolean, val numeric, basket text, oid text)
language sql stable security definer
set search_path = public, landing, core
as $fn$
  select c.restaurant_id, oc.code, c.business_date,
         min(c.ordered_time::timestamp),
         regexp_replace(max(coalesce(c.sub_disposition_name, c.cancellation_l2, c.cancellation_l1,
                                     'no reason given')), '^\d+-', ''),
         bool_or(coalesce(c.is_food_prepared, '') in ('1', 'true', 'True')),
         (select o.order_total + o.discount_total from core.orders o
           where o.aggregator_order_no = c.order_id and o.superseded_at is null limit 1),
         coalesce(
           (select string_agg(trim_scale(oi.item_quantity::numeric)::text || ' x ' || oi.item_name,
                              ', ' order by oi.id)
              from core.orders o2 join core.order_items oi on oi.order_id = o2.id
             where o2.aggregator_order_no = c.order_id and o2.superseded_at is null),
           string_agg(distinct c.item_name, ', ')),
         c.order_id
    from landing.swiggy_cancellations c
    join core.v_swiggy_outlet_codes oc on oc.restaurant_id = c.restaurant_id
   where c.superseded_at is null
     and c.business_date between p_from and p_to
     and not (coalesce(c.cancellation_l2, '') like 'SDC%'
              or coalesce(c.sub_disposition_name, '') like '%Tech Issue%')
   group by c.restaurant_id, oc.code, c.business_date, c.order_id
$fn$;

create or replace function public.swiggy_rated(p_from date, p_to date)
returns table (rid text, code text, d date, t timestamp, rating numeric,
               words text, basket text, oid text)
language sql stable security definer
set search_path = public, landing, core
as $fn$
  select f.restaurant_id, oc.code, f.business_date,
         (select min(i.ordered_time::timestamp) from landing.swiggy_item_sales i
           where i.order_id = f.order_id and i.superseded_at is null),
         min(f.restaurant_rating::numeric),
         max(nullif(nullif(f.comments, 'null'), '')),
         coalesce(
           (select string_agg(i.item_quantity || ' x ' || i.item_name, ', ' order by i.id)
              from landing.swiggy_item_sales i
             where i.order_id = f.order_id and i.superseded_at is null),
           string_agg(distinct f.item_name, ', ')),
         f.order_id
    from landing.swiggy_item_feedback f
    join core.v_swiggy_outlet_codes oc on oc.restaurant_id = f.restaurant_id
   where f.superseded_at is null
     and f.business_date between p_from and p_to
   group by f.restaurant_id, oc.code, f.business_date, f.order_id
$fn$;

create or replace function public.dash_store_swiggy(p_code text, p_date date)
returns jsonb language sql stable security definer
set search_path = public, landing, core
as $fn$
with me as (select restaurant_id rid from core.v_swiggy_outlet_codes where code = p_code limit 1),
ws as (select (p_date - 6)::date s, p_date e),
days as (select * from public.swiggy_store_days((select s from ws), (select e from ws))),
cx as (select * from public.swiggy_cancels((select s from ws), (select e from ws))
        where rid = (select rid from me)),
rt as (select * from public.swiggy_rated((select s from ws), (select e from ws))
        where rid = (select rid from me)),
league as (
  select d.code, d.orders,
         coalesce(cc.n, 0) cancels, coalesce(d.short, 0) short,
         d.rating, coalesce(lw.n, 0) low,
         coalesce(cc.n, 0) + coalesce(d.short, 0) + coalesce(lw.n, 0) score
    from days d
    left join (select rid, count(*) n from public.swiggy_cancels(p_date, p_date) group by 1) cc
      on cc.rid = d.rid
    left join (select rid, count(*) n from public.swiggy_rated(p_date, p_date)
                where rating <= 2 group by 1) lw on lw.rid = d.rid
   where d.d = p_date and d.orders > 0),
ranked as (
  select l.*, row_number() over (order by l.score, l.rating desc nulls last) rnk
    from league l),
avg7 as (
  select avg(s.orders::numeric) a from landing.swiggy_sales_daily s
   where s.superseded_at is null and s.restaurant_id = (select rid from me)
     and s.business_date between p_date - 7 and p_date - 1)
select jsonb_build_object(
  'mapped', (select rid from me) is not null,
  'day', (select jsonb_build_object(
      'orders', d.orders, 'gmv', d.gmv, 'ih', d.ih, 'short', d.short,
      'open_pct', case when d.ih > 0 then round(100.0 * (d.ih - d.short) / d.ih, 1) end,
      'rating', d.rating, 'avg7', round((select a from avg7), 0))
    from days d where d.rid = (select rid from me) and d.d = p_date),
  'trend', (select jsonb_agg(jsonb_build_object(
      'd', d.d, 'orders', d.orders, 'gmv', d.gmv, 'short', d.short, 'rating', d.rating)
      order by d.d)
    from days d where d.rid = (select rid from me)),
  'canc_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', c.oid, 't', c.t, 'why', c.why, 'prep', c.prep, 'val', c.val, 'basket', c.basket)
      order by c.t), '[]'::jsonb) from cx c where c.d = p_date),
  'canc_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', c.oid, 'd', c.d, 't', c.t, 'why', c.why, 'prep', c.prep, 'val', c.val, 'basket', c.basket)
      order by c.d, c.t), '[]'::jsonb) from cx c),
  'rated_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', r.oid, 't', r.t, 'rating', r.rating, 'basket', r.basket, 'words', r.words)
      order by r.t), '[]'::jsonb) from rt r where r.d = p_date),
  'comments_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', r.oid, 'd', r.d, 't', r.t, 'rating', r.rating, 'basket', r.basket, 'words', r.words)
      order by r.d, r.t), '[]'::jsonb) from rt r where r.words is not null),
  'low_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', r.oid, 'd', r.d, 't', r.t, 'rating', r.rating, 'basket', r.basket, 'words', r.words)
      order by r.d, r.t), '[]'::jsonb) from rt r where r.rating <= 2),
  'slot_wk', (select coalesce(jsonb_object_agg(slot, orders), '{}'::jsonb) from (
      select initcap(replace(sl.slot, '_', ' ')) slot, sum(sl.orders::numeric) orders
        from landing.swiggy_slot_sales sl, ws
       where sl.superseded_at is null and sl.restaurant_id = (select rid from me)
         and sl.business_date between ws.s and ws.e group by 1) z),
  'rank', (select rnk from ranked where code = p_code),
  'rank_of', (select count(*) from ranked),
  'league', (select coalesce(jsonb_agg(jsonb_build_object(
      'rank', r.rnk, 'code', r.code, 'orders', r.orders, 'cancels', r.cancels,
      'short', r.short, 'rating', r.rating) order by r.rnk), '[]'::jsonb)
    from ranked r where r.rnk <= 5 or r.code = p_code))
$fn$;

create or replace function public.dash_area_swiggy(p_am text, p_date date)
returns jsonb language sql stable security definer
set search_path = public, landing, core
as $fn$
with codes as (select internal_code code from public.outlets where area_manager = p_am),
ws as (select (p_date - 6)::date s, p_date e),
days as (select * from public.swiggy_store_days((select s from ws), (select e from ws))),
cx_all as (select * from public.swiggy_cancels((select s from ws), (select e from ws))),
rt_all as (select * from public.swiggy_rated((select s from ws), (select e from ws))),
league as (
  select d.rid, d.code,
         coalesce(cc.n, 0) + coalesce(d.short, 0) + coalesce(lw.n, 0) score, d.rating
    from days d
    left join (select rid, count(*) n from cx_all where d = p_date group by 1) cc on cc.rid = d.rid
    left join (select rid, count(*) n from rt_all where d = p_date and rating <= 2 group by 1) lw
      on lw.rid = d.rid
   where d.d = p_date and d.orders > 0),
ranked as (select l.*, row_number() over (order by l.score, l.rating desc nulls last) rnk from league l),
cx as (select * from cx_all where code in (select code from codes)),
rt as (select * from rt_all where code in (select code from codes))
select jsonb_build_object(
  'stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', s.code, 'orders', s.orders, 'orders_wk', s.orders_wk,
      'open_pct', s.open_pct, 'short', s.short, 'canc', s.canc, 'low', s.low,
      'rating', s.rating, 'rank', s.rnk) order by s.rnk nulls last), '[]'::jsonb)
    from (
      select d.code, d.orders, wk.orders_wk, d.rating,
             case when d.ih > 0 then round(100.0 * (d.ih - d.short) / d.ih, 1) end open_pct,
             round(d.short, 1) short,
             (select count(*) from cx c where c.code = d.code and c.d = p_date) canc,
             (select count(*) from rt r where r.code = d.code and r.d = p_date and r.rating <= 2) low,
             (select rnk from ranked k where k.code = d.code) rnk
        from days d
        join (select code, sum(orders) orders_wk from days group by 1) wk on wk.code = d.code
       where d.d = p_date and d.code in (select code from codes)) s),
  'unmapped', (select coalesce(jsonb_agg(c.code), '[]'::jsonb) from codes c
    where c.code not in (select code from core.v_swiggy_outlet_codes where code is not null)),
  'short_series', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', z.code, 'wk_short', z.wk_short, 'day_short', z.day_short, 'series', z.series)
      order by z.wk_short desc), '[]'::jsonb)
    from (
      select d.code, round(sum(d.short), 1) wk_short,
             round(max(d.short) filter (where d.d = p_date), 1) day_short,
             jsonb_agg(jsonb_build_object('d', d.d, 'short', round(d.short, 2)) order by d.d) series
        from days d where d.code in (select code from codes)
       group by d.code having sum(d.short) >= 0.3) z),
  'canc_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', c.oid, 'code', c.code, 't', c.t, 'why', c.why, 'val', c.val, 'basket', c.basket)
      order by c.t), '[]'::jsonb) from cx c where c.d = p_date),
  'canc_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', c.oid, 'code', c.code, 'd', c.d, 't', c.t, 'why', c.why, 'val', c.val, 'basket', c.basket)
      order by c.d, c.t), '[]'::jsonb) from cx c where c.d <> p_date),
  'low_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', r.oid, 'code', r.code, 't', r.t, 'rating', r.rating, 'basket', r.basket, 'words', r.words)
      order by r.t), '[]'::jsonb) from rt r where r.d = p_date and r.rating <= 3),
  'low_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'oid', r.oid, 'code', r.code, 'd', r.d, 't', r.t, 'rating', r.rating, 'basket', r.basket, 'words', r.words)
      order by r.d, r.t), '[]'::jsonb) from rt r where r.d <> p_date and r.rating <= 3),
  'money_stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', m.code, 'canc_val_wk', m.v) order by m.v desc), '[]'::jsonb)
    from (select c.code, round(sum(coalesce(c.val, 0))) v from cx c group by 1) m))
$fn$;

