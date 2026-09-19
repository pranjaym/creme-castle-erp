-- 233: a superseded deal still governs its own dates.
-- Found while testing 232 the same day: coupons.set_deal closes the previous
-- deal (effective_to = new from - 1, superseded_at set), but deal_for also
-- filtered on superseded_at is null, so an order from LAST month found no deal
-- once this month's deal was recorded. The date range alone decides which deal
-- applies; superseded_at only marks which row is the current version.

create or replace function coupons.deal_for(p_platform text, p_code text, p_outlet text, p_date date) returns numeric language sql stable as $$
  select max_our_share_pct from coupons.deal
  where platform = p_platform and code = p_code
    and effective_from <= p_date and (effective_to is null or effective_to >= p_date)
    and (outlet_code = p_outlet or outlet_code is null)
  order by outlet_code nulls last, effective_from desc limit 1
$$;

drop index if exists coupons.idx_deal_lookup;
create index if not exists idx_deal_lookup on coupons.deal (platform, code, coalesce(outlet_code,''), effective_from);
