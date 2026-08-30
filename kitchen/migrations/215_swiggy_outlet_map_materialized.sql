-- 215: materialize the Swiggy outlet map. The 212 view recomputes the full
-- 46k-order match on every reference, and the 213 payload functions
-- reference it many times per call, which blew PostgREST's statement
-- timeout. The map changes only when new orders load, so it becomes a
-- materialized view refreshed by the swiggy worker after each load (and by
-- anyone who suspects staleness: refresh is cheap and reproducible).
create materialized view if not exists core.mv_swiggy_outlet_codes as
select m.restaurant_id, m.location_id, m.matched_orders, m.confidence,
       (select o.outlet_raw from core.orders o
         where o.location_id = m.location_id and o.superseded_at is null
         order by o.id desc limit 1) as code
from core.v_swiggy_outlet_map m;
create unique index if not exists uq_mv_swoc on core.mv_swiggy_outlet_codes (restaurant_id);

-- The code bridge now reads the materialized copy.
create or replace view core.v_swiggy_outlet_codes as
select restaurant_id, location_id, code from core.mv_swiggy_outlet_codes;
