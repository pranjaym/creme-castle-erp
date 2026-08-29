-- 211: coupon_code is nullable. Found on the first real load (28 Aug 2026):
-- the Coupon data sheet carries orders with NO coupon code but nonzero trade
-- discount fields, so the 210 not-null constraint was wrong. The natural key
-- keeps its shape through coalesce, matching the loader's str(None) keying.
alter table landing.swiggy_coupon_orders alter column coupon_code drop not null;
drop index if exists landing.uq_swco_key;
create unique index if not exists uq_swco_key
  on landing.swiggy_coupon_orders (order_id, coalesce(coupon_code,'None'), dup_seq)
  where superseded_at is null;
