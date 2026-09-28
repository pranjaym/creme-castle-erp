-- 240: Coupon sharing, Zomato shared discount = Zomato's share + ours.
-- Authorised by Pranjay 28 Sep 2026 ("Go, do both": seed the deals and load
-- the month history). Found while trial-seeding the deals the same day.
--
-- 232 computed the Zomato shared discount as Rishabh's dashboard does:
--   Petpooja aggregator_discount + outlet_discount - Zomato restaurant_discount_flat (FVC).
-- That breaks whenever Petpooja's outlet_discount does not carry the same FVC
-- Zomato reports (order 8632219920: Flat Rs.100 off, Zomato paid 30, we paid 70,
-- but FVC 43.78 was subtracted from a Petpooja outlet discount of 70, so the
-- shared discount read 56.22 and our share 125%). About 0.6% of coupon orders,
-- all reading ABOVE deal, about Rs 22,700 of phantom overpayment over 8 weeks.
-- Tested on 44,210 flat-coupon orders 1 to 25 Sep 2026: the new formula equals
-- the coupon's face value on 99.9% (old: 99.4%); the 35 misses are one-off
-- personal codes. Percentage coupons: 97.8% vs 97.5%. No Gold or brand-pack
-- discount on any coupon order. Totals move by 0.17%.
-- Swiggy is unchanged. Only refresh_day is replaced; re-run it for every day.

create or replace function coupons.refresh_day(d date) returns void language plpgsql as $$
declare zn int; zm int; zc int; sn int; sm int; sc int;
begin
  delete from coupons.order_share where business_date = d;

  -- Zomato: Petpooja order + Zomato order-history row + Zomato business row.
  -- Shared discount = Zomato's share (Petpooja aggregator_discount) + ours
  -- (Zomato restaurant_discount_promo). Migration 240; see the header.
  insert into coupons.order_share (platform, order_no, business_date, outlet_code, city, code, construct, bill, burn, ours, theirs, extras, share_pct, is_coupon, matched)
  select 'zomato', pp.ono, d, pp.outlet_name, o.city,
         nullif(split_part(coalesce(bo.promo_code,''), ',', 1), ''),
         nullif(od.construct, ''),
         od.subtotal,
         pp.agg + coalesce(od.promo, 0),
         coalesce(od.promo, 0),
         pp.agg,
         coalesce(od.fvc, 0),
         case when pp.agg + coalesce(od.promo,0) > 0 then round(100 * coalesce(od.promo,0) / (pp.agg + coalesce(od.promo,0)), 2) end,
         (pp.agg + coalesce(od.promo,0) > 0 and nullif(od.construct,'') is not null),
         (od.oid is not null)
  from (
    select distinct on (aggregator_order_no) aggregator_order_no ono, outlet_name,
           coalesce(nullif(aggregator_discount,'')::numeric,0) agg
    from landing.petpooja_online_orders
    where business_date = d and lower(order_from) = 'zomato'
      and status not ilike '%cancel%' and voided_at is null and coalesce(aggregator_order_no,'') <> ''
    order by aggregator_order_no, id desc
  ) pp
  left join public.outlets o on o.internal_code = pp.outlet_name
  left join lateral (
    select zomato_order_id oid, discount_construct construct,
           nullif(bill_subtotal,'')::numeric subtotal,
           coalesce(nullif(restaurant_discount_promo,'')::numeric,0) promo,
           coalesce(nullif(restaurant_discount_flat,'')::numeric,0) fvc
    from landing.zomato_order_details z
    where z.zomato_order_id = pp.ono and z.superseded_at is null
    order by z.id desc limit 1
  ) od on true
  left join lateral (
    select promo_code from landing.zomato_business_order b
    where b.zomato_order_id = pp.ono and b.superseded_at is null
    order by b.id desc limit 1
  ) bo on true;

  select count(*), count(*) filter (where matched), count(*) filter (where is_coupon) into zn, zm, zc
  from coupons.order_share where business_date = d and platform = 'zomato';

  -- Swiggy: Swiggy coupon row + Petpooja order (our share arrives in Petpooja's outlet discount)
  insert into coupons.order_share (platform, order_no, business_date, outlet_code, city, code, construct, bill, burn, ours, theirs, extras, share_pct, is_coupon, matched)
  select 'swiggy', s.order_id, d, pp.outlet_name, o.city, nullif(s.coupon_code,''), null,
         s.gmv,
         s.cd,
         coalesce(pp.od, 0) - s.rtd,
         s.cd - (coalesce(pp.od, 0) - s.rtd),
         s.rtd,
         case when s.cd > 0 then round(100 * (coalesce(pp.od,0) - s.rtd) / s.cd, 2) end,
         (s.cd > 0 and nullif(s.coupon_code,'') is not null),
         (pp.ono is not null)
  from (
    select distinct on (order_id) order_id, coupon_code,
           coalesce(nullif(coupon_discount,'')::numeric,0) cd,
           coalesce(nullif(restaurant_trade_discount,'')::numeric,0) rtd,
           nullif(gmv_total,'')::numeric gmv
    from landing.swiggy_coupon_orders
    where business_date = d and superseded_at is null and coalesce(order_id,'') <> ''
    order by order_id, dup_seq, id desc
  ) s
  left join lateral (
    select aggregator_order_no ono, outlet_name, coalesce(nullif(outlet_discount,'')::numeric,0) od
    from landing.petpooja_online_orders p
    where p.aggregator_order_no = s.order_id and p.business_date between d - 1 and d + 1
      and lower(p.order_from) = 'swiggy' and p.status not ilike '%cancel%' and p.voided_at is null
    order by p.id desc limit 1
  ) pp on true
  left join public.outlets o on o.internal_code = pp.outlet_name
  where pp.ono is not null;   -- an unmatched Swiggy row has no outlet and no share; it is counted in day_status below

  select count(*) into sn from (select distinct order_id from landing.swiggy_coupon_orders where business_date = d and superseded_at is null) x;
  select count(*), count(*) filter (where is_coupon) into sm, sc from coupons.order_share where business_date = d and platform = 'swiggy';

  insert into coupons.day_status (business_date, platform, orders, matched, coupon_orders, computed_at)
  values (d, 'zomato', coalesce(zn,0), coalesce(zm,0), coalesce(zc,0), now()), (d, 'swiggy', coalesce(sn,0), coalesce(sm,0), coalesce(sc,0), now())
  on conflict (business_date, platform) do update set orders = excluded.orders, matched = excluded.matched, coupon_orders = excluded.coupon_orders, computed_at = now();

  -- the glossary learns every name it sees
  insert into coupons.coupon (platform, code, kind, first_seen, last_seen, status)
  select platform, code,
         case when max(construct) ~ '^Flat Rs\.' then 'flat'
              when max(construct) ~ '^Flat \d+% off' then 'flat_percent'
              when max(construct) ~ '% off upto' then 'percent'
              when platform = 'swiggy' and code like 'FLAT%' then 'flat'
              when code in ('PAYTMUPI','AMZNPAY3','APAYCCFEST') then 'payment'
              when code like 'BUY1GET1%' then 'bogo' end,
         d, d, 'new'
  from coupons.order_share where business_date = d and code is not null
  group by platform, code
  on conflict (platform, code) do update
    set first_seen = least(coupons.coupon.first_seen, excluded.first_seen),
        last_seen  = greatest(coupons.coupon.last_seen, excluded.last_seen),
        kind = coalesce(coupons.coupon.kind, excluded.kind);
end $$;
