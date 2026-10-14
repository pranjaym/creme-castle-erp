-- 247: the issue table behind "Issues to Ask" (plan: erp-plan/central-view-plan.md,
-- approved by Pranjay 14 Oct 2026, "yes to all four").
--
-- WHY A TABLE. The daily pages rebuild their answer from the landing tables on
-- every request. Reading the rows this page needs straight from landing costs
-- 5 s for a 7-day range and 77 s for 30 days (measured 14 Oct 2026), so the
-- central work queue reads this derived table instead: one row per issue,
-- keyed exactly as the Questions module keys its rows (Z:<order>, S:<order>,
-- D:<outlet>:<day>:<app>), so the join to ops.v_question is on anchor_key.
--
-- WHAT A ROW IS. The same rules the page functions use, written once:
--   Online visibility: Zomato online_time_pct below 100 (a day at 0% with no
--     delivered orders is "Listed, not trading": Lucknow's switched-off
--     listings, F61, counted but never asked about); Swiggy actual open hours
--     short of ideal ("Hours short").
--   Complaint: Zomato's own tags "Wrong item(s) delivered" and "Item(s)
--     missing or not delivered"; and "Instruction not followed", which has no
--     Zomato tag and is the complained order whose written review contains an
--     instruction word and a failure word (the word lists below, Pranjay's yes
--     14 Oct 2026; a rule, never AI, widened by editing this function).
--   Rejection: Zomato order not Delivered, Mx rejected, with a reason or a
--     rejection time (243), not "Wrong restaurant address" (244); "Restaurant
--     is closed" is the kind "Shop shut, order rejected". Swiggy store-charged
--     cancellations from public.swiggy_cancels (213), shut-shop ones marked.
--
-- THIS IS A CACHE OF THE LANDING TABLES, NOT HISTORY. Canonical rule 6 (no
-- hard deletes) protects the landing rows and the question records; this
-- table is rebuilt from them for a window on every refresh, so a refresh
-- deletes and rewrites that window. Nothing anyone typed lives here.
--
-- REFRESH. dash_issue_refresh(p_from, p_to) is called by the workers after the
-- morning Zomato business pull, after the Swiggy loader, and after the evening
-- order-details pull (reviews and instructions arrive there), for the last ten
-- days each time, because Zomato restates to T-3 (F55) and the evening feed
-- lags a day. Keep a call to ten days or so: the statement reads the order
-- tables for the window and a 30-day window runs over a minute.

create table if not exists public.dash_issue (
  anchor_key      text primary key,                 -- Z:<order> | S:<order> | D:<outlet>:<date>:<Z|S>
  outlet_code     text not null references public.outlets(internal_code),
  business_date   date not null,
  platform        text not null check (platform in ('Z','S')),
  issue_type      text not null check (issue_type in ('Online visibility','Complaint','Rejection')),
  issue_kind      text not null,
  detail          text,                             -- what the page shows: reason, online % and minutes, hours short
  order_id        text,
  order_time      text,                             -- clock time as the pages print it, HH:MI am
  basket          text,
  value           numeric,                          -- order subtotal (rejections) or bill (complaints), Rs.
  refund          numeric,                          -- refund Zomato agreed (complaints)
  customer_words  text,                             -- the review the customer wrote
  customer_asked  text,                             -- the instruction the customer gave on the order
  refreshed_at    timestamptz not null default now()
);
create index if not exists dash_issue_day_idx    on public.dash_issue (business_date, outlet_code);
create index if not exists dash_issue_outlet_idx on public.dash_issue (outlet_code, business_date);

create or replace function public.dash_issue_refresh(p_from date, p_to date)
returns integer
language plpgsql security definer set search_path = public, landing, core as $fn$
declare n integer;
begin
  delete from public.dash_issue where business_date between p_from and p_to;

  insert into public.dash_issue (anchor_key, outlet_code, business_date, platform, issue_type, issue_kind,
    detail, order_id, order_time, basket, value, refund, customer_words, customer_asked)
  with o as (
    select internal_code as code, zomato_restaurant_id as rid from public.outlets where active
  ),
  items as (
    select i.zomato_order_id,
      string_agg(i.item_quantity || ' x ' || i.item_name, ', ' order by i.line_no::int) as basket
    from landing.zomato_business_order_item i
    where i.superseded_by is null and i.business_date between p_from and p_to
    group by 1
  ),
  ev as (
    -- the evening order feed: clean item text (F31 fallback), the review, Zomato's
    -- complaint tag, and the customer's instruction; a day wider either side
    select t.zomato_order_id,
      case when nullif(t.items_in_order, '') is not null and t.items_in_order not like '[0x%'
           then t.items_in_order end as basket,
      nullif(t.review, '') as review,
      nullif(t.customer_complaint_tag, '') as ev_tag,
      case when nullif(t.instructions, '') is not null and t.instructions <> 'NA' then t.instructions end as asked
    from landing.zomato_order_details t
    where t.superseded_by is null and t.order_date between (p_from - 1) and (p_to + 1)
  ),
  ord as (
    select o.code, b.business_date::date as d, b.zomato_order_id as oid, b.order_state,
      to_char(left(nullif(b.placed_at,'NA'),19)::timestamp, 'HH12:MI am') as tm,
      b.rejection_reason, b.rejected_at, b.rejected_by, b.complaint_on_order,
      coalesce(nullif(b.complaint_reason, ''), ev.ev_tag, 'reason not tagged by Zomato') as tag,
      nullif(b.refund_amount_agreed,'NA')::numeric as refund,
      b.order_subtotal::numeric as subtotal,
      coalesce(it.basket, ev.basket) as basket, ev.review, ev.asked
    from landing.zomato_business_order b
    join o on o.rid = b.restaurant_id
    left join items it on it.zomato_order_id = b.zomato_order_id
    left join ev on ev.zomato_order_id = b.zomato_order_id
    where b.superseded_by is null and b.business_date::date between p_from and p_to
  ),
  delivered as (
    select code, d, count(*) as n from ord where order_state = 'Delivered' group by 1, 2
  ),
  -- 1. Online visibility, Zomato
  z_online as (
    select 'D:' || o.code || ':' || q.business_date::date || ':Z' as anchor_key,
      o.code, q.business_date::date as d, 'Z' as platform, 'Online visibility' as issue_type,
      case when q.online_time_pct::numeric = 0 and coalesce(dv.n, 0) = 0 then 'Listed, not trading'
           else 'Below 100% online' end as issue_kind,
      case when q.online_time_pct::numeric = 0 and coalesce(dv.n, 0) = 0
           then '0% online all day, no orders (Zomato listing switched off)'
           else round(q.online_time_pct::numeric, 1) || '% online, '
                || round(q.offline_time::numeric / 60) || ' min offline' end as detail
    from landing.zomato_outlet_day_quality q
    join o on o.rid = q.restaurant_id
    left join delivered dv on dv.code = o.code and dv.d = q.business_date::date
    where q.superseded_by is null and q.business_date::date between p_from and p_to
      and q.online_time_pct::numeric < 100
  ),
  -- 1b. Online visibility, Swiggy (hours short of the ideal open hours)
  s_hours as (
    select 'D:' || oc.code || ':' || s.business_date || ':S' as anchor_key,
      oc.code, s.business_date as d, 'S' as platform, 'Online visibility' as issue_type,
      'Hours short' as issue_kind,
      round((s.ideal_open_hrs::numeric - s.actual_open_hrs::numeric), 1) || ' hours not open on the day ('
        || round(100 * s.actual_open_hrs::numeric / nullif(s.ideal_open_hrs::numeric, 0), 1) || '% of ideal hours)' as detail
    from landing.swiggy_serviceability_daily s
    join core.v_swiggy_outlet_codes oc on oc.restaurant_id = s.restaurant_id
    join o on o.code = oc.code
    where s.superseded_at is null and s.business_date between p_from and p_to
      and s.actual_open_hrs::numeric < s.ideal_open_hrs::numeric
  ),
  -- 2. Complaints of the three kinds
  comp as (
    select 'Z:' || oid as anchor_key, code, d, 'Z' as platform, 'Complaint' as issue_type,
      case when tag like 'Wrong item%' then 'Wrong item delivered'
           when tag like 'Item(s) missing%' then 'Item missing'
           else 'Instruction not followed' end as issue_kind,
      tag as detail, oid, tm, basket, subtotal, coalesce(refund, 0) as refund, review, asked
    from ord
    where complaint_on_order = 'Yes'
      -- a rejected order that also complained is listed once, as the rejection
      and not (order_state <> 'Delivered' and coalesce(rejected_by, '') = 'Mx rejected')
      and (tag like 'Wrong item%' or tag like 'Item(s) missing%'
           or (review ~* '(instruction|written|write|wrote|writing|name on|message|note\y|candle|knife|spell|spelt|plates|spoon|tag\y)'
               and review ~* '(\ynot\y|\yno\y|missing|didn|never|wrong|forgot|without|skipped|ignored|\ybad\y|mess|partially|instead|incorrect|broken)'))
  ),
  -- 3. Rejections, Zomato (the page rule, 243 + 244)
  z_rej as (
    select 'Z:' || oid as anchor_key, code, d, 'Z' as platform, 'Rejection' as issue_type,
      case when rejection_reason = 'Restaurant is closed' then 'Shop shut, order rejected'
           else 'Store rejected the order' end as issue_kind,
      coalesce(nullif(nullif(rejection_reason, ''), 'NA'), 'no reason given') as detail,
      oid, tm, basket, subtotal
    from ord
    where order_state <> 'Delivered' and rejected_by = 'Mx rejected'
      and (nullif(nullif(rejection_reason,''),'NA') is not null or nullif(nullif(rejected_at,''),'NA') is not null)
      and coalesce(rejection_reason, '') <> 'Wrong restaurant address'
  ),
  -- 3b. Rejections, Swiggy (store-charged cancellations, 213)
  s_rej as (
    select 'S:' || c.oid as anchor_key, c.code, c.d, 'S' as platform, 'Rejection' as issue_type,
      case when c.why ~* '(closed|not accepting)' then 'Shop shut, cancelled' else 'Cancelled on store' end as issue_kind,
      c.why as detail, c.oid, to_char(c.t, 'HH12:MI am') as tm, c.basket, c.val
    from public.swiggy_cancels(p_from, p_to) c
    join o on o.code = c.code
    where c.oid is not null
  )
  select anchor_key, code, d, platform, issue_type, issue_kind, detail, null::text, null::text, null::text, null::numeric, null::numeric, null::text, null::text from z_online
  union all
  select anchor_key, code, d, platform, issue_type, issue_kind, detail, null::text, null::text, null::text, null::numeric, null::numeric, null::text, null::text from s_hours
  union all
  select anchor_key, code, d, platform, issue_type, issue_kind, detail, oid, tm, basket, subtotal, refund, review, asked from comp
  union all
  select anchor_key, code, d, platform, issue_type, issue_kind, detail, oid, tm, basket, subtotal, null::numeric, null::text, null::text from z_rej
  union all
  select anchor_key, code, d, platform, issue_type, issue_kind, detail, oid, tm, basket, val, null::numeric, null::text, null::text from s_rej
  on conflict (anchor_key) do update set
    outlet_code = excluded.outlet_code, business_date = excluded.business_date, platform = excluded.platform,
    issue_type = excluded.issue_type, issue_kind = excluded.issue_kind, detail = excluded.detail,
    order_id = excluded.order_id, order_time = excluded.order_time, basket = excluded.basket,
    value = excluded.value, refund = excluded.refund, customer_words = excluded.customer_words,
    customer_asked = excluded.customer_asked, refreshed_at = now();

  get diagnostics n = row_count;
  return n;
end $fn$;

comment on table public.dash_issue is
  'Derived cache for the Issues to Ask page: one row per issue the daily pages highlight, keyed as the Questions module keys rows. Rebuilt per window by dash_issue_refresh; never edited by hand.';
