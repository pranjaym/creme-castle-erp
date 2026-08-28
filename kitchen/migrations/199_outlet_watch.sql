-- 199: the outlet detection alert. (F39 / F40, step 3)
--
-- STAGED, NOT APPROVED FOR APPLY. Kept out of kitchen/migrations/ on purpose: anything
-- in that folder is one migrate.mjs invocation away from executing, from any session
-- (F41). This file carries no transaction control; the caller owns the transaction.
--
-- WHY. Nothing has ever watched the outlet names arriving in the feeds. The cost of
-- that: CC-GGN-Udyog Vihar was renamed to CC-DL-South Campus in Petpooja's ITEM report
-- on 28 Feb 2026 and in its ORDER report only on 20 Jul 2026, and for those five months
-- the loader minted a phantom order for every real one, 2,673 in all (F40). Separately,
-- CC-DL-South Campus and CC-PB-Ludhiana sat with no city, store type or location code
-- in the dashboard for 40 and 17 days, missing from every city view, silently (F39).
--
-- THREE DESIGN DECISIONS, each one forced by a failed dry run of the naive version:
--
-- 1. ORDER REPORT ONLY (source = 'online_report'). The item report is the feed that
--    renamed early and duplicated; the order report is the trading truth. Scoping here
--    also drops the SK-* spoke kitchens, which are POS-only and would read as "quiet"
--    forever, and the 'oms' source, whose outlet_raw is a delivery AREA code (ND, GGN,
--    DL, SPJ, GN, FBD), not a store.
--
-- 2. MATERIAL DAYS ONLY (>= 3 orders in a day). The naive version called South Campus
--    'ok' on the cutover day because 71 stray item-report rows across 21 days, never
--    more than 9 on a day, made a brand new name look six months old. A threshold is
--    what separates a store trading from a handful of misfiled rows.
--
-- 3. ACTIVE LOCATIONS ONLY. A store Pranjay has marked closed must stop nagging. Mark
--    it (locations.active = false, or lifecycle <> 'active') and it leaves the watch.
--
-- Read by dashboard/auto/run_daily.py -> outlet_watch(), which prints the non-'ok' rows
-- in the 8am mail. That function checks to_regclass first, so the mail is unchanged
-- until this migration is applied.

create or replace view public.outlet_watch as
with material_days as (
  -- a day on which this name actually traded, not a stray misfiled row
  select o.outlet_raw, o.business_date, count(*) as n
    from core.orders o
   where o.superseded_at is null
     and o.source = 'online_report'
   group by o.outlet_raw, o.business_date
  having count(*) >= 3
),
seen as (
  select m.outlet_raw,
         min(m.business_date) as first_seen,
         max(m.business_date) as last_seen,
         sum(m.n)             as orders_all,
         sum(m.n) filter (where m.business_date >= current_date - 30) as orders_30d
    from material_days m
   group by m.outlet_raw
),
loc as (
  -- One pass over core.orders, not one per outlet. The correlated-subquery version of
  -- this ran 49 scans of 1.2M rows and did not finish inside two minutes.
  select o.outlet_raw,
         bool_or(o.location_id is not null)                as has_location,
         bool_or(l.active and l.lifecycle = 'active')      as location_active
    from core.orders o
    left join public.locations l on l.id = o.location_id
   where o.superseded_at is null
   group by o.outlet_raw
),
located as (
  select s.*, coalesce(loc.has_location, false) as has_location, loc.location_active
    from seen s left join loc on loc.outlet_raw = s.outlet_raw
)
select outlet_raw,
       first_seen,
       last_seen,
       orders_all,
       coalesce(orders_30d, 0) as orders_30d,
       has_location,
       case
         when not has_location                    then 'unmapped'
         when first_seen >= current_date - 30     then 'new'
         when last_seen  <  current_date - 7
              and coalesce(location_active, true) then 'quiet'
         else 'ok'
       end as status
  from located;

comment on view public.outlet_watch is
  'Outlet names arriving in the Petpooja ORDER report, with a status a human must '
  'answer: unmapped (no location), new (first material day inside 30 days), quiet '
  '(nothing for over a week while its location is still marked active), ok. Only days '
  'with 3 or more orders count, so a stray misfiled row cannot make a new name look '
  'established. Mark a location inactive to retire it from this watch.';


-- A rename or relocation is not one event, it is a PAIR: a name goes quiet in the same
-- week another appears. That pair is the signal missed for five months in F40. This
-- view names the suspects so the 8am mail can ask the one question that matters:
-- new store, rename, or relocation?
create or replace view public.outlet_rename_suspects as
select gone.outlet_raw      as went_quiet,
       gone.last_seen       as last_traded,
       arrived.outlet_raw   as appeared,
       arrived.first_seen   as first_traded,
       (arrived.first_seen - gone.last_seen) as days_apart
  from public.outlet_watch gone
  join public.outlet_watch arrived
    on arrived.outlet_raw <> gone.outlet_raw
   and arrived.first_seen between gone.last_seen - 7 and gone.last_seen + 7
 where gone.status = 'quiet'
   and arrived.status = 'new'
 order by arrived.first_seen desc;

comment on view public.outlet_rename_suspects is
  'One outlet name going quiet within a week of another appearing. Almost always a '
  'rename or a relocation, which must be modelled as ONE location with a new dated row '
  'in location_sites, never as a second store. See F40 and public.location_sites.';
