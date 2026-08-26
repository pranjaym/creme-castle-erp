-- ============================================================
-- Migration 180: dash_area_detail (area manager page, 25 Aug 2026 feedback)
--
-- The area page answers "which of my stores needs me today, and what exactly
-- do I say to that store". So every number an AM sees must carry the outlet
-- name and the orders behind it. Sections requested by Pranjay:
--   online dips, rejections, complaints, 1-3 star orders, rider wait,
--   false ready, money lost, each per outlet with receipts.
-- One call returns everything for the area; the page never queries per store.
-- ============================================================
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
      in ('Items out of stock','Kitchen is full','Outlet closed','Timeout','Device issues')),0) as stockout_wk,
    coalesce(sum(refund),0) as refunds_wk,
    count(*) filter (where nullif(rejection_reason,'')
      in ('Items out of stock','Kitchen is full','Outlet closed','Timeout','Device issues')) as rej_wk,
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
      in ('Items out of stock','Kitchen is full','Outlet closed','Timeout','Device issues')),
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
