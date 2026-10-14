-- 246: F74, the Swiggy code bridge labels three stores with short raw names.
--
-- Migration 215 built core.mv_swiggy_outlet_codes by taking the code from the
-- NEWEST core.orders.outlet_raw of the matched location. For three locations
-- that also fulfil D2C orders (type d2c_fulfillment) the newest order carries
-- the short raw name, so the bridge returned FBD for restaurant 1073851
-- (CC-FBD-Sector 15), GN for 30328 (CC-ND-Alpha 2) and SPJ for 846391
-- (CC-DL-Shahpurjat). Every Swiggy page function joins on this code against
-- outlets.internal_code, so those three stores had no Swiggy cancellations,
-- hours-short days, ratings or orders on any page since the Swiggy pages went
-- live on 30 Aug 2026 (18 store-charged cancellations in the 30 days to 11 Oct
-- alone). Found 14 Oct 2026 (integration-notes F74), approved the same day.
--
-- The outlet code of a location is public.locations.code, which is the same
-- string as outlets.internal_code for all 45 mapped restaurants (checked 14 Oct:
-- 42 already equal, the 3 above wrong). The bridge now takes it from there and
-- never from an order's raw name again. The map (212) is unchanged; only the
-- code column changes source. The unique index is recreated so the swiggy
-- worker's REFRESH ... CONCURRENTLY keeps working.
drop view if exists core.v_swiggy_outlet_codes;
drop materialized view if exists core.mv_swiggy_outlet_codes;

create materialized view core.mv_swiggy_outlet_codes as
select m.restaurant_id, m.location_id, m.matched_orders, m.confidence,
       l.code
from core.v_swiggy_outlet_map m
join public.locations l on l.id = m.location_id;
create unique index uq_mv_swoc on core.mv_swiggy_outlet_codes (restaurant_id);

create or replace view core.v_swiggy_outlet_codes as
select restaurant_id, location_id, code from core.mv_swiggy_outlet_codes;
