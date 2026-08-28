-- 201_spotcheck_parity.sql
--
-- Make the intraday feed speak the spot check's language, exactly.
--
-- Pranjay's existing CC Spot Check (cc_spotcheck, in erp-plan) has settled
-- definitions and he reads them every day. Inventing a second, nearly-identical
-- "sales" number would be the worst possible outcome: two tools disagreeing by a few
-- percent, and no way to tell which is right. So the definitions are lifted verbatim
-- from cc_spotcheck/config.py and cc_spotcheck/metrics.py, and parity is proved
-- against a real generated dashboard rather than assumed.
--
--   Net Sales     = My amount + Container Charge - (Outlet Disc + Agg Disc)
--   Disc Denom    = My amount + Container Charge      (= Net Sales + OD + Agg)
--   AOV           = Net Sales / Orders
--   Outlet Disc % = Outlet Disc / Disc Denom
--   Total Disc %  = (OD + Agg) / Disc Denom
--   Cancelled orders are excluded from every sales-side figure and counted separately.
--
-- Note this is NOT the same as the `total` column the first cut of the pulse used.
-- `total` is what the customer paid including delivery and taxes; Net Sales is what
-- the business books. On 28 August at 12:00 they differed by about 7 percent
-- (Rs 7.08L against Rs 6.60L), which is exactly the size of gap that starts an
-- argument in a review meeting. The spot check definition wins because it is the one
-- already in use.
--
-- Business day: cc_spotcheck uses a 07:00 start, the spine uses 04:00. They agree on
-- every real order, because the 04:00 to 06:59 window is empty on every day checked
-- (18 to 27 August 2026 and Raksha Bandhan 2025 all have their first order at 07:00,
-- to the second). The 07:00 boundary is used here to match the spot check.

-- Platform and city, lifted from cc_spotcheck/loaders.py so both tools bucket
-- identically. "Toing by Swiggy" rolls into Swiggy; anything not Swiggy-flavoured is
-- Zomato, which is the spot check's own (deliberately blunt) rule.
create or replace function intraday.platform(order_from text) returns text
  language sql immutable as
$$ select case when coalesce(order_from,'') ilike '%swiggy%'
                 or coalesce(order_from,'') ilike '%toing%'
               then 'Swiggy' else 'Zomato' end $$;

-- City from the second dash-separated token of the outlet code (CC-DL-Dwarka -> DL
-- -> Delhi), the same CITY_MAP the spot check carries.
create or replace function intraday.city(outlet_name text) returns text
  language sql immutable as
$$ select coalesce(
     (case split_part(coalesce(outlet_name,''), '-', 2)
        when 'DL'  then 'Delhi'      when 'ND'  then 'Noida'
        when 'GGN' then 'Gurugram'   when 'GZB' then 'Ghaziabad'
        when 'FBD' then 'Faridabad'  when 'UP'  then 'Meerut'
        when 'JP'  then 'Jaipur'     when 'CHD' then 'Chandigarh'
        when 'LKO' then 'Lucknow'    else null end), 'Unknown') $$;

-- The column list changes shape, so the dependants come down first and are rebuilt
-- below on the new definitions. Views only: no table is touched and no row moves.
drop view if exists intraday.v_pulse_hourly;
drop view if exists intraday.v_settled_hourly;
drop view if exists intraday.v_orders_now;

-- Expose the money components the spot check needs. The earlier view kept only the
-- order `total`, which cannot reconstruct Net Sales.
create or replace view intraday.v_orders_now as
select distinct on (business_date, intraday.order_key(aggregator_order_no, pos_invoice_no, id))
       business_date,
       intraday.order_key(aggregator_order_no, pos_invoice_no, id) as order_key,
       aggregator_order_no, pos_invoice_no, order_from,
       outlet_name, outlet_display_name, order_type, status, delivery_status,
       order_date, intraday.ts(order_date) as placed_at,
       intraday.platform(order_from)             as platform,
       intraday.city(outlet_name)                as city,
       intraday.money(total)                     as order_value,
       intraday.money(my_amount)                 as my_amount_num,
       intraday.money(container_charges)         as container_charges_num,
       intraday.money(delivery_charges)          as delivery_charges_num,
       intraday.money(additional_charge)         as additional_charge_num,
       intraday.money(aggregator_discount)       as agg_discount,
       intraday.money(outlet_discount)           as outlet_discount_num,
       -- The two spot check quantities, computed once, here, so no caller can get
       -- them subtly wrong.
       coalesce(intraday.money(my_amount), 0)
         + coalesce(intraday.money(container_charges), 0)
         - coalesce(intraday.money(outlet_discount), 0)
         - coalesce(intraday.money(aggregator_discount), 0)  as net_sales,
       coalesce(intraday.money(my_amount), 0)
         + coalesce(intraday.money(container_charges), 0)    as disc_denom,
       cancelled_by, reason,
       first_seen_run_id, last_seen_run_id, seen_count
from intraday.pp_online_orders
order by business_date, intraday.order_key(aggregator_order_no, pos_invoice_no, id),
         last_seen_run_id desc, id desc;

-- The same shape over the settled table, so today and any past day are measured with
-- one set of arithmetic. Every comparison in the pulse reads these two views only.
create or replace view intraday.v_settled_orders as
select business_date, aggregator_order_no, order_from, outlet_name, order_type,
       status, intraday.ts(order_date) as placed_at,
       intraday.platform(order_from)   as platform,
       intraday.city(outlet_name)      as city,
       intraday.money(total)           as order_value,
       coalesce(intraday.money(my_amount), 0)
         + coalesce(intraday.money(container_charges), 0)
         - coalesce(intraday.money(outlet_discount), 0)
         - coalesce(intraday.money(aggregator_discount), 0)  as net_sales,
       coalesce(intraday.money(my_amount), 0)
         + coalesce(intraday.money(container_charges), 0)    as disc_denom,
       coalesce(intraday.money(outlet_discount), 0)          as outlet_discount_num,
       coalesce(intraday.money(aggregator_discount), 0)      as agg_discount
from landing.petpooja_online_orders
where voided_at is null;


-- ------------------------------------------------- hourly, on the new definition --
-- Rebuilt on Net Sales rather than the customer-paid `total`, so every hour in the
-- pulse foots to the headline and to the spot check.
create or replace view intraday.v_pulse_hourly as
select business_date,
       date_trunc('hour', placed_at)                                as hour,
       count(*)                                                     as received,
       count(*) filter (where status <> 'Cancelled')                as orders,
       round(coalesce(sum(net_sales) filter (where status <> 'Cancelled'), 0))    as sales,
       count(*) filter (where status = 'Cancelled')                 as cancelled_orders,
       round(coalesce(sum(net_sales) filter (where status = 'Cancelled'), 0))     as cancelled_value,
       round(coalesce(avg(net_sales) filter (where status <> 'Cancelled'), 0))    as aov,
       round(coalesce(sum(disc_denom) filter (where status <> 'Cancelled'), 0))   as disc_denom,
       round(coalesce(sum(outlet_discount_num) filter (where status <> 'Cancelled'), 0)) as outlet_disc,
       round(coalesce(sum(agg_discount) filter (where status <> 'Cancelled'), 0)) as agg_disc
from intraday.v_orders_now
where placed_at is not null
group by 1, 2;

create or replace view intraday.v_settled_hourly as
select business_date,
       date_trunc('hour', placed_at)                                as hour,
       count(*)                                                     as received,
       count(*) filter (where status <> 'Cancelled')                as orders,
       round(coalesce(sum(net_sales) filter (where status <> 'Cancelled'), 0))    as sales,
       count(*) filter (where status = 'Cancelled')                 as cancelled_orders,
       round(coalesce(avg(net_sales) filter (where status <> 'Cancelled'), 0))    as aov,
       round(coalesce(sum(disc_denom) filter (where status <> 'Cancelled'), 0))   as disc_denom,
       round(coalesce(sum(outlet_discount_num) filter (where status <> 'Cancelled'), 0)) as outlet_disc,
       round(coalesce(sum(agg_discount) filter (where status <> 'Cancelled'), 0)) as agg_disc
from intraday.v_settled_orders
where placed_at is not null
group by 1, 2;
