-- ============================================================
-- Migration 151: T-2 CAP + RESTATEMENT CHECKER (applied 24 Aug 2026)
--
-- Pranjay's call: day-1 Zomato figures are not trustworthy; the portal and
-- the mailer must show settled data only. dash_latest_date now caps at
-- IST-today minus 2, and everything (home, date pickers, mailer) reads it.
--
-- dash_restatement_check(p_date) measures exactly how much a day's quality
-- figures changed between their FIRST load and now (the supersede chain is
-- the snapshot). Run it each morning for date-2 and date-3 to test the
-- "T-1 is wrong" hypothesis with numbers. First data point, 24 Aug: business
-- day 22 Aug showed ZERO restated stores between its first load (23 Aug
-- evening pull) and the 24 Aug morning pull. Collect a week before judging.
-- (Definitions live in the DB per rule 1; SQL identical to what was applied.)
-- ============================================================

create or replace function public.dash_latest_date()
returns date language sql stable security definer
set search_path = public, landing
as $fn$
  select least(
    (select max(business_date::date) from landing.zomato_outlet_day_quality where superseded_by is null),
    ((now() at time zone 'Asia/Kolkata')::date - 2)
  )
$fn$;

create or replace function public.dash_restatement_check(p_date date)
returns jsonb language sql stable security definer
set search_path = public, landing
as $fn$
with rows_all as (
  select restaurant_id, total_complaints::numeric as comps,
         total_rejected_orders::numeric as rejs, online_time_pct::numeric as online,
         average_food_order_rating::numeric as rating, loaded_at, superseded_by
  from landing.zomato_outlet_day_quality
  where business_date::date = p_date
),
firsts as (
  select distinct on (restaurant_id) restaurant_id, comps, rejs, online, rating
  from rows_all order by restaurant_id, loaded_at asc
),
currents as (
  select restaurant_id, comps, rejs, online, rating from rows_all where superseded_by is null
)
select jsonb_build_object(
  'business_date', p_date,
  'stores', (select count(*) from currents),
  'stores_restated', (select count(*) from firsts f join currents c using (restaurant_id)
     where f.comps is distinct from c.comps or f.rejs is distinct from c.rejs
        or f.online is distinct from c.online or f.rating is distinct from c.rating),
  'complaints_first_total', (select sum(comps) from firsts),
  'complaints_now_total', (select sum(comps) from currents),
  'rejections_first_total', (select sum(rejs) from firsts),
  'rejections_now_total', (select sum(rejs) from currents),
  'avg_abs_online_change', (select round(avg(abs(coalesce(c.online,0) - coalesce(f.online,0))),2)
     from firsts f join currents c using (restaurant_id)),
  'avg_abs_rating_change', (select round(avg(abs(coalesce(c.rating,0) - coalesce(f.rating,0))),2)
     from firsts f join currents c using (restaurant_id))
)
$fn$;
revoke all on function public.dash_restatement_check(date) from public, anon, authenticated;
grant execute on function public.dash_restatement_check(date) to service_role;
