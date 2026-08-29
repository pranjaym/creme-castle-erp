-- 212: the Swiggy restaurant_id to location map, DERIVED, never hand-typed.
--
-- F40's standing lesson is never to join two exports on an outlet NAME. This
-- map never touches a name: core.orders carries Swiggy's own order number in
-- aggregator_order_no, so matched orders pin each Swiggy restaurant_id to the
-- Petpooja location that billed it. Verified 29 Aug 2026: all 41 restaurant
-- ids map to exactly one location each, 100 percent agreement, 44,951 orders
-- of evidence. Because it is a view, a new Swiggy outlet maps itself as soon
-- as its first orders flow, and the confidence column would expose any future
-- ambiguity instead of hiding it.
--
-- Toing by Swiggy rides on the SAME restaurant ids (the brand file includes
-- Toing orders), so both channels feed the match.
create or replace view core.v_swiggy_outlet_map as
with m as (
  select s.restaurant_id, o.location_id, count(*) n,
         min(o.business_date) first_seen, max(o.business_date) last_seen
  from core.orders o
  join landing.swiggy_coupon_orders s
    on s.order_id = o.aggregator_order_no and s.superseded_at is null
  where o.channel in ('Swiggy', 'Toing by Swiggy')
    and o.superseded_at is null
    and o.location_id is not null
  group by 1, 2
), ranked as (
  select m.*,
         row_number() over (partition by restaurant_id order by n desc) rn,
         sum(n) over (partition by restaurant_id) total
  from m
)
select restaurant_id,
       location_id,
       n as matched_orders,
       round(n::numeric / total, 4) as confidence,   -- < 1.0 means ambiguity, investigate
       first_seen,
       last_seen
from ranked
where rn = 1;
