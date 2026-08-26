-- ============================================================
-- Migration 192: the shut-shop tracker (26 Aug 2026, Pranjay's instruction)
--
-- "This is a very important list, especially when a restaurant is closed. I
-- need the whole list for the last 7 days, and this should be part of the
-- tracker in central and area manager. The order should not be rejected
-- because the restaurant was closed."
--
-- Adds three keys to BOTH dash_central_detail and dash_area_detail:
--   shut_orders  every order of the 7 days rejected as 'Restaurant is closed'
--                or 'Unavailable to accept the order', with the store's own
--                online % for that day travelling alongside it
--   shut_stores  the same, counted per outlet, worst first
--   shut_hours   the same, counted per hour of the day
--
-- Why the online % matters, and why this is its own section rather than a
-- line inside the general rejection list: Zomato only routes an order to a
-- store whose listing it believes is OPEN. Measured over 18 to 24 Aug 2026,
-- every one of the 14 such orders came to a store showing 98.8% to 100.0%
-- online, most of them 100.0% with zero minutes offline. So the tablet said
-- open and the shop could not serve. That is a different failure from running
-- out of stock and it needs a different conversation.
--
-- Also carried here: dash_area_detail's day label now comes from the BUSINESS
-- date rather than the order's own timestamp, the same one-line correction
-- already made in migration 190. Without it an order placed at 01:30 was
-- labelled with the next calendar day and appeared as a "Sat 15" row inside
-- the "earlier this week" list, which breaks the locked design rule that a
-- week list excludes the day above it.
--
-- Built from the LIVE definitions as they stood after migration 191, so the
-- corrected rejection vocabulary is preserved.
-- ============================================================


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
ord as (
  select o.code, b.business_date::date as d, b.zomato_order_id, b.order_state, it.basket,
    -- the day label is the BUSINESS date, never the wall clock: an order placed
    -- at 01:30 belongs to the previous business day (matches migration 190)
    to_char(b.business_date::date,'Dy DD') as dlabel,
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
      'hour', to_char(left(nullif(r.placed_at,'NA'),19)::timestamp + interval '5 hours 30 minutes','HH24'),
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
      select to_char(left(nullif(placed_at,'NA'),19)::timestamp + interval '5 hours 30 minutes','HH24') as hr,
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
ord as (
  select o.code, o.am, b.business_date::date as d, b.order_state, it.basket,
    -- the day label is the BUSINESS date, never the wall clock: an order placed
    -- at 01:30 belongs to the previous business day, and labelling it by its
    -- timestamp put "Sat 15" rows inside the "earlier this week" list
    to_char(b.business_date::date,'Dy DD') as dlabel,
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
      'tag', coalesce(nullif(c.complaint_reason,''),'reason not tagged by Zomato'),
      'basket', c.basket, 'refund', round(coalesce(c.refund,0)), 'today', (c.d = p_date))
      order by c.placed_at desc), '[]'::jsonb)
    from (select * from ord where complaint_on_order = 'Yes'
          order by placed_at desc limit 600) c),
  'complaints_total', (select count(*) from ord where complaint_on_order = 'Yes'),
  'low_ratings', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', l.code, 'am', l.am, 'dlabel', l.dlabel, 'time', l.tm, 'rating', l.order_rating,
      'basket', l.basket, 'tag', nullif(l.complaint_reason,''), 'today', (l.d = p_date))
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
      'hour', to_char(left(nullif(r.placed_at,'NA'),19)::timestamp + interval '5 hours 30 minutes','HH24'),
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
      select to_char(left(nullif(placed_at,'NA'),19)::timestamp + interval '5 hours 30 minutes','HH24') as hr,
        count(*) as n, round(sum(subtotal)) as v
      from ord where nullif(rejection_reason,'') in ('Restaurant is closed','Unavailable to accept the order')
      group by 1) h)
)
$fn$;

revoke all on function public.dash_central_detail(date) from public, anon, authenticated;
grant execute on function public.dash_central_detail(date) to service_role;
