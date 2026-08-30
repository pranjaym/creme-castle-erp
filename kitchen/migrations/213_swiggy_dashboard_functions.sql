-- ============================================================
-- Migration 213: the Swiggy payload functions for the merged daily pages.
-- Approved design: erp-plan/swiggy-dashboard-plan.md (30 Aug 2026) and the
-- three merged-*-template-v3.html files. Same contract as dash_store_detail
-- and friends (migration 150/170): the definitions live in the database so
-- the portal and the future mailer can never disagree.
--
-- Verified equivalences: these functions reproduce the numbers of the
-- approved templates, which were themselves proven against the Aug-19/27
-- files and Petpooja (swiggy-reconciliation-notes.md).
--
-- Conventions locked with Pranjay:
--   * store-charged cancellation = everything except Swiggy's own tech
--     reasons (l2 'SDC%' or sub-disposition containing 'Tech Issue');
--   * cancellation VALUE and BASKET come from the billed Petpooja order,
--     matched on Swiggy's own order number (aggregator_order_no), never a
--     name; Swiggy's sheet carries neither amounts nor quantities;
--   * ratings are grouped ONE ROW PER RATED ORDER (worst star of the
--     basket), with quantities from the item sales sheet;
--   * ranks: cancellations + 1-2 star orders + hours offline, lower wins;
--   * reason words strip Swiggy's numeric prefix ('386-...').
-- ============================================================

-- The id-to-code bridge, derived like core.v_swiggy_outlet_map (212).
create or replace view core.v_swiggy_outlet_codes as
select m.restaurant_id, m.location_id,
       (select o.outlet_raw from core.orders o
         where o.location_id = m.location_id and o.superseded_at is null
         order by o.id desc limit 1) as code
from core.v_swiggy_outlet_map m;

-- ------------------------------------------------------------
-- Shared building block: one row per store-charged cancelled ORDER.
-- ------------------------------------------------------------
create or replace function public.swiggy_cancels(p_from date, p_to date)
returns table (rid text, code text, d date, t timestamp, why text,
               prep boolean, val numeric, basket text)
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
           string_agg(distinct c.item_name, ', '))
    from landing.swiggy_cancellations c
    join core.v_swiggy_outlet_codes oc on oc.restaurant_id = c.restaurant_id
   where c.superseded_at is null
     and c.business_date between p_from and p_to
     and not (coalesce(c.cancellation_l2, '') like 'SDC%'
              or coalesce(c.sub_disposition_name, '') like '%Tech Issue%')
   group by c.restaurant_id, oc.code, c.business_date, c.order_id
$fn$;

-- Shared building block: one row per RATED ORDER (worst star in the basket).
create or replace function public.swiggy_rated(p_from date, p_to date)
returns table (rid text, code text, d date, t timestamp, rating numeric,
               words text, basket text)
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
           string_agg(distinct f.item_name, ', '))
    from landing.swiggy_item_feedback f
    join core.v_swiggy_outlet_codes oc on oc.restaurant_id = f.restaurant_id
   where f.superseded_at is null
     and f.business_date between p_from and p_to
   group by f.restaurant_id, oc.code, f.business_date, f.order_id
$fn$;

-- Shared building block: per store per day operational stats.
create or replace function public.swiggy_store_days(p_from date, p_to date)
returns table (rid text, code text, d date, orders numeric, gmv numeric,
               ih numeric, short numeric, rating numeric)
language sql stable security definer
set search_path = public, landing, core
as $fn$
  select oc.restaurant_id, oc.code, s.business_date,
         s.orders::numeric, s.gmv::numeric,
         sv.ideal_open_hrs::numeric,
         greatest(sv.ideal_open_hrs::numeric - sv.actual_open_hrs::numeric, 0),
         r.avg_rating::numeric
    from core.v_swiggy_outlet_codes oc
    join landing.swiggy_sales_daily s
      on s.restaurant_id = oc.restaurant_id and s.superseded_at is null
     and s.business_date between p_from and p_to
    left join landing.swiggy_serviceability_daily sv
      on sv.restaurant_id = oc.restaurant_id and sv.business_date = s.business_date
     and sv.superseded_at is null and sv.dup_seq = 1
    left join landing.swiggy_outlet_rating_daily r
      on r.restaurant_id = oc.restaurant_id and r.business_date = s.business_date
     and r.superseded_at is null and r.dup_seq = 1
$fn$;

-- ------------------------------------------------------------
-- The store page payload.
-- ------------------------------------------------------------
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
      't', c.t, 'why', c.why, 'prep', c.prep, 'val', c.val, 'basket', c.basket)
      order by c.t), '[]'::jsonb) from cx c where c.d = p_date),
  'canc_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'd', c.d, 't', c.t, 'why', c.why, 'prep', c.prep, 'val', c.val, 'basket', c.basket)
      order by c.d, c.t), '[]'::jsonb) from cx c),
  'rated_day', (select coalesce(jsonb_agg(jsonb_build_object(
      't', r.t, 'rating', r.rating, 'basket', r.basket, 'words', r.words)
      order by r.t), '[]'::jsonb) from rt r where r.d = p_date),
  'comments_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'd', r.d, 't', r.t, 'rating', r.rating, 'basket', r.basket, 'words', r.words)
      order by r.d, r.t), '[]'::jsonb) from rt r where r.words is not null),
  'low_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'd', r.d, 't', r.t, 'rating', r.rating, 'basket', r.basket, 'words', r.words)
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

-- ------------------------------------------------------------
-- The area page payload.
-- ------------------------------------------------------------
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
      'code', c.code, 't', c.t, 'why', c.why, 'val', c.val, 'basket', c.basket)
      order by c.t), '[]'::jsonb) from cx c where c.d = p_date),
  'canc_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', c.code, 'd', c.d, 't', c.t, 'why', c.why, 'val', c.val, 'basket', c.basket)
      order by c.d, c.t), '[]'::jsonb) from cx c where c.d <> p_date),
  'low_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', r.code, 't', r.t, 'rating', r.rating, 'basket', r.basket, 'words', r.words)
      order by r.t), '[]'::jsonb) from rt r where r.d = p_date and r.rating <= 3),
  'low_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', r.code, 'd', r.d, 't', r.t, 'rating', r.rating, 'basket', r.basket, 'words', r.words)
      order by r.d, r.t), '[]'::jsonb) from rt r where r.d <> p_date and r.rating <= 3),
  'money_stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', m.code, 'canc_val_wk', m.v) order by m.v desc), '[]'::jsonb)
    from (select c.code, round(sum(coalesce(c.val, 0))) v from cx c group by 1) m))
$fn$;

-- ------------------------------------------------------------
-- The central page payload.
-- ------------------------------------------------------------
create or replace function public.dash_central_swiggy(p_date date)
returns jsonb language sql stable security definer
set search_path = public, landing, core
as $fn$
with ws as (select (p_date - 6)::date s, p_date e),
days as (select * from public.swiggy_store_days((select s from ws), (select e from ws))),
cx as (select * from public.swiggy_cancels((select s from ws), (select e from ws))),
rt as (select * from public.swiggy_rated((select s from ws), (select e from ws))),
ams as (select internal_code code, area_manager am from public.outlets),
league as (
  select d.rid, d.code,
         coalesce(cc.n, 0) + coalesce(d.short, 0) + coalesce(lw.n, 0) score, d.rating
    from days d
    left join (select rid, count(*) n from cx where d = p_date group by 1) cc on cc.rid = d.rid
    left join (select rid, count(*) n from rt where d = p_date and rating <= 2 group by 1) lw
      on lw.rid = d.rid
   where d.d = p_date and d.orders > 0),
ranked as (select l.*, row_number() over (order by l.score, l.rating desc nulls last) rnk from league l),
coup as (
  select business_date d, sum(coupon_discount::numeric) cd,
         sum(restaurant_trade_discount::numeric) rtd, sum(swiggy_trade_discount::numeric) std
    from landing.swiggy_coupon_orders, ws
   where superseded_at is null and business_date between ws.s and ws.e group by 1),
ads as (
  select a.restaurant_id rid, a.business_date d, sum(a.budget_burnt::numeric) b,
         sum(a.ads_gmv::numeric) g
    from landing.swiggy_ads_slot a, ws
   where a.superseded_at is null and a.business_date between ws.s and ws.e group by 1, 2)
select jsonb_build_object(
  'unmapped', (select coalesce(jsonb_agg(a.code), '[]'::jsonb) from ams a
    where a.code not in (select code from core.v_swiggy_outlet_codes where code is not null)),
  'trend', (select coalesce(jsonb_agg(jsonb_build_object('d', z.d, 'orders', z.o, 'gmv', z.g)
      order by z.d), '[]'::jsonb)
    from (select d.d, sum(d.orders) o, sum(d.gmv) g from days d group by 1) z),
  'stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', s.code, 'am', s.am, 'orders', s.orders, 'orders_wk', s.orders_wk,
      'open_pct', s.open_pct, 'short', s.short, 'canc', s.canc, 'low', s.low,
      'rating', s.rating, 'rank', s.rnk) order by s.rnk nulls last), '[]'::jsonb)
    from (
      select d.code, (select am from ams a where a.code = d.code) am,
             d.orders, wk.orders_wk, d.rating,
             case when d.ih > 0 then round(100.0 * (d.ih - d.short) / d.ih, 1) end open_pct,
             round(d.short, 1) short,
             (select count(*) from cx c where c.code = d.code and c.d = p_date) canc,
             (select count(*) from rt r where r.code = d.code and r.d = p_date and r.rating <= 2) low,
             (select rnk from ranked k where k.code = d.code) rnk
        from days d
        join (select code, sum(orders) orders_wk from days group by 1) wk on wk.code = d.code
       where d.d = p_date) s),
  'canc_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', c.code, 'am', (select am from ams a where a.code = c.code),
      't', c.t, 'why', c.why, 'val', c.val, 'basket', c.basket) order by c.t), '[]'::jsonb)
    from cx c where c.d = p_date),
  'canc_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', c.code, 'am', (select am from ams a where a.code = c.code),
      'd', c.d, 't', c.t, 'why', c.why, 'val', c.val, 'basket', c.basket)
      order by c.d, c.t), '[]'::jsonb) from cx c where c.d <> p_date),
  'low_day', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', r.code, 'am', (select am from ams a where a.code = r.code),
      't', r.t, 'rating', r.rating, 'basket', r.basket, 'words', r.words)
      order by r.t), '[]'::jsonb) from rt r where r.d = p_date and r.rating <= 3),
  'low_wk', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', r.code, 'am', (select am from ams a where a.code = r.code),
      'd', r.d, 't', r.t, 'rating', r.rating, 'basket', r.basket, 'words', r.words)
      order by r.d, r.t), '[]'::jsonb) from rt r where r.d <> p_date and r.rating <= 3),
  'short_series', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', z.code, 'am', (select am from ams a where a.code = z.code),
      'wk_short', z.wk_short, 'series', z.series) order by z.wk_short desc), '[]'::jsonb)
    from (
      select d.code, round(sum(d.short), 1) wk_short,
             jsonb_agg(jsonb_build_object('d', d.d, 'short', round(d.short, 2)) order by d.d) series
        from days d group by d.code having sum(d.short) >= 0.5) z),
  'money_stores', (select coalesce(jsonb_agg(jsonb_build_object(
      'code', m.code, 'am', (select am from ams a where a.code = m.code),
      'canc_val_wk', m.v) order by m.v desc), '[]'::jsonb)
    from (select c.code, round(sum(coalesce(c.val, 0))) v from cx c group by 1) m),
  'levers', jsonb_build_object(
    'gmv_day', (select round(sum(d.gmv)) from days d where d.d = p_date),
    'gmv_wk', (select round(sum(d.gmv)) from days d),
    'cd_day', (select round(cd) from coup where d = p_date),
    'rtd_day', (select round(rtd) from coup where d = p_date),
    'std_day', (select round(std) from coup where d = p_date),
    'cd_wk', (select round(sum(cd)) from coup),
    'rtd_wk', (select round(sum(rtd)) from coup),
    'std_wk', (select round(sum(std)) from coup),
    'burn_day', (select round(sum(b)) from ads where d = p_date),
    'adsg_day', (select round(sum(g)) from ads where d = p_date),
    'burn_wk', (select round(sum(b)) from ads),
    'adsg_wk', (select round(sum(g)) from ads),
    'conv_day', (select round(100.0 * sum(order_session::numeric) / nullif(sum(menu_sessions::numeric), 0), 1)
      from landing.swiggy_funnel_daily where superseded_at is null and business_date = p_date),
    'ntr_day', (select round(sum(orders::numeric)) from landing.swiggy_ntr_rr_daily
      where superseded_at is null and business_date = p_date and order_type = 'NTR'),
    'rtr_day', (select round(sum(orders::numeric)) from landing.swiggy_ntr_rr_daily
      where superseded_at is null and business_date = p_date and order_type = 'RTR'),
    'top_coupons', (select coalesce(jsonb_agg(jsonb_build_object(
        'code', z.code, 'n', z.n, 'cd', z.cd) order by z.cd desc), '[]'::jsonb)
      from (select coalesce(coupon_code, '(no coupon)') code, count(*) n,
                   round(sum(coupon_discount::numeric)) cd
              from landing.swiggy_coupon_orders, ws
             where superseded_at is null and business_date between ws.s and ws.e
             group by 1 order by 3 desc limit 8) z),
    'store_levers', (select coalesce(jsonb_agg(jsonb_build_object(
        'code', z.code, 'am', (select am from ams a where a.code = z.code),
        'gmv_wk', z.gmv_wk, 'burn_wk', z.burn_wk, 'adsg_wk', z.adsg_wk)
        order by z.gmv_wk desc), '[]'::jsonb)
      from (
        select d.code, round(sum(d.gmv)) gmv_wk,
               round(sum(coalesce(a.b, 0))) burn_wk, round(sum(coalesce(a.g, 0))) adsg_wk
          from days d left join ads a on a.rid = d.rid and a.d = d.d
         group by d.code having sum(coalesce(a.b, 0)) > 0) z),
    'bridge', (select jsonb_build_object('pp_n', count(*), 'pp_g', round(sum(o.order_total + o.discount_total)))
      from core.orders o
     where o.channel in ('Swiggy', 'Toing by Swiggy') and o.superseded_at is null
       and o.status = 'Delivered' and o.business_date = p_date)))
$fn$;
