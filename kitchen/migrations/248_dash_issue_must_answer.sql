-- 248: the must-answer flag on the issue table, and the low-rating row.
-- Pranjay, 15 Oct 2026, on the thresholds his other chat proposed: "Where the
-- numbers support the other chat: let's start with these." Measured on the
-- 30 days to 12 Oct 2026 before deciding (erp-plan/central-view-plan.md).
--
-- MUST ANSWER. Every row stays on the page; the flag says which ones central
-- expects an explanation for, and the page counts only those as "not asked".
--   Online visibility: must answer only from 30 minutes offline in a day
--     (Zomato) or 30 minutes short of ideal hours (Swiggy). Under that it is
--     nearly always the menu push, and the answer is the same every time.
--     132 of 281 rows in the 30 days fell under the floor.
--   Rejections: must answer, except Swiggy's "Unable to connect with the
--     restaurant" placed between midnight and 07:59, which is a standing rule
--     for the stores (who is at the tablet at close and at open), not a
--     question each time: 11 of 15 such rows sat in that window.
--   Complaints: must answer (wrong item, missing item, instruction not
--     followed), and the new low-rating row below.
--   Listed, not trading: never.
--
-- LOW RATING WITH A STORE FAULT IN THE WORDS. A 1 or 2 star order whose
-- written review names a wrong, missing or undelivered item, or an unwritten
-- message, candle or knife, and which is not already a complaint row. Zomato
-- gives these no complaint tag (or only "Non-refunded complaint"), so they
-- reached no page: 23 in the 30 days. Low ratings with no review, or about
-- taste, are not rows. Same word-list method as the instruction rule, never AI.

alter table public.dash_issue add column if not exists must_answer boolean not null default true;
create index if not exists dash_issue_must_idx on public.dash_issue (business_date) where must_answer;

create or replace function public.dash_issue_refresh(p_from date, p_to date)
returns integer
language plpgsql security definer set search_path = public, landing, core as $fn$
declare n integer;
begin
  delete from public.dash_issue where business_date between p_from and p_to;

  insert into public.dash_issue (anchor_key, outlet_code, business_date, platform, issue_type, issue_kind,
    detail, order_id, order_time, basket, value, refund, customer_words, customer_asked, must_answer)
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
      b.rejection_reason, b.rejected_at, b.rejected_by, b.complaint_on_order, b.order_rating,
      coalesce(nullif(b.complaint_reason, ''), ev.ev_tag, 'reason not tagged by Zomato') as tag,
      nullif(b.refund_amount_agreed,'NA')::numeric as refund,
      b.order_subtotal::numeric as subtotal,
      coalesce(it.basket, ev.basket) as basket, ev.review, ev.asked,
      (b.order_state <> 'Delivered' and coalesce(b.rejected_by, '') = 'Mx rejected') as rejected
    from landing.zomato_business_order b
    join o on o.rid = b.restaurant_id
    left join items it on it.zomato_order_id = b.zomato_order_id
    left join ev on ev.zomato_order_id = b.zomato_order_id
    where b.superseded_by is null and b.business_date::date between p_from and p_to
  ),
  delivered as (
    select code, d, count(*) as n from ord where order_state = 'Delivered' group by 1, 2
  ),
  z_online as (
    select 'D:' || o.code || ':' || q.business_date::date || ':Z' as anchor_key,
      o.code, q.business_date::date as d, 'Z' as platform, 'Online visibility' as issue_type,
      case when q.online_time_pct::numeric = 0 and coalesce(dv.n, 0) = 0 then 'Listed, not trading'
           else 'Below 100% online' end as issue_kind,
      case when q.online_time_pct::numeric = 0 and coalesce(dv.n, 0) = 0
           then '0% online all day, no orders (Zomato listing switched off)'
           else round(q.online_time_pct::numeric, 1) || '% online, '
                || round(q.offline_time::numeric / 60) || ' min offline' end as detail,
      (not (q.online_time_pct::numeric = 0 and coalesce(dv.n, 0) = 0)) and round(q.offline_time::numeric / 60) >= 30 as must_answer
    from landing.zomato_outlet_day_quality q
    join o on o.rid = q.restaurant_id
    left join delivered dv on dv.code = o.code and dv.d = q.business_date::date
    where q.superseded_by is null and q.business_date::date between p_from and p_to
      and q.online_time_pct::numeric < 100
  ),
  s_hours as (
    select 'D:' || oc.code || ':' || s.business_date || ':S' as anchor_key,
      oc.code, s.business_date as d, 'S' as platform, 'Online visibility' as issue_type,
      'Hours short' as issue_kind,
      round((s.ideal_open_hrs::numeric - s.actual_open_hrs::numeric), 1) || ' hours not open on the day ('
        || round(100 * s.actual_open_hrs::numeric / nullif(s.ideal_open_hrs::numeric, 0), 1) || '% of ideal hours)' as detail,
      (s.ideal_open_hrs::numeric - s.actual_open_hrs::numeric) >= 0.5 as must_answer
    from landing.swiggy_serviceability_daily s
    join core.v_swiggy_outlet_codes oc on oc.restaurant_id = s.restaurant_id
    join o on o.code = oc.code
    where s.superseded_at is null and s.business_date between p_from and p_to
      and s.actual_open_hrs::numeric < s.ideal_open_hrs::numeric
  ),
  comp as (
    select 'Z:' || oid as anchor_key, code, d, 'Z' as platform, 'Complaint' as issue_type,
      case when tag like 'Wrong item%' then 'Wrong item delivered'
           when tag like 'Item(s) missing%' then 'Item missing'
           else 'Instruction not followed' end as issue_kind,
      tag as detail, oid, tm, basket, subtotal, coalesce(refund, 0) as refund, review, asked
    from ord
    where complaint_on_order = 'Yes'
      and not rejected
      and (tag like 'Wrong item%' or tag like 'Item(s) missing%'
           or (review ~* '(instruction|written|write|wrote|writing|name on|message|note\y|candle|knife|spell|spelt|plates|spoon|tag\y)'
               and review ~* '(\ynot\y|\yno\y|missing|didn|never|wrong|forgot|without|skipped|ignored|\ybad\y|mess|partially|instead|incorrect|broken)'))
  ),
  -- a 1 or 2 star order whose words name a store fault, not already a complaint row
  lowrate as (
    select 'Z:' || r.oid as anchor_key, r.code, r.d, 'Z' as platform, 'Complaint' as issue_type,
      'Low rating, store fault in words' as issue_kind,
      r.order_rating || ' star' || case when r.complaint_on_order = 'Yes' then ', ' || r.tag else ', no complaint filed' end as detail,
      r.oid, r.tm, r.basket, r.subtotal, coalesce(r.refund, 0) as refund, r.review, r.asked
    from ord r
    where r.order_rating in ('1', '2') and not r.rejected and r.review is not null
      and r.review ~* '(wrong|incorrect|missing|not (received|delivered|written|sent|followed)|different (item|order|cake)|instruction|name on|message|candle|knife|spell|forgot)'
      and not exists (select 1 from comp c where c.oid = r.oid)
  ),
  z_rej as (
    select 'Z:' || oid as anchor_key, code, d, 'Z' as platform, 'Rejection' as issue_type,
      case when rejection_reason = 'Restaurant is closed' then 'Shop shut, order rejected'
           else 'Store rejected the order' end as issue_kind,
      coalesce(nullif(nullif(rejection_reason, ''), 'NA'), 'no reason given') as detail,
      oid, tm, basket, subtotal
    from ord
    where rejected
      and (nullif(nullif(rejection_reason,''),'NA') is not null or nullif(nullif(rejected_at,''),'NA') is not null)
      and coalesce(rejection_reason, '') <> 'Wrong restaurant address'
  ),
  s_rej as (
    select 'S:' || c.oid as anchor_key, c.code, c.d, 'S' as platform, 'Rejection' as issue_type,
      case when c.why ~* '(closed|not accepting)' then 'Shop shut, cancelled' else 'Cancelled on store' end as issue_kind,
      c.why as detail, c.oid, to_char(c.t, 'HH12:MI am') as tm, c.basket, c.val,
      -- "unable to connect" between midnight and 07:59 is the tablet rule, not a question
      not (c.why ilike 'unable to connect%' and extract(hour from c.t) < 8) as must_answer
    from public.swiggy_cancels(p_from, p_to) c
    join o on o.code = c.code
    where c.oid is not null
  )
  select anchor_key, code, d, platform, issue_type, issue_kind, detail, null::text, null::text, null::text, null::numeric, null::numeric, null::text, null::text, must_answer from z_online
  union all
  select anchor_key, code, d, platform, issue_type, issue_kind, detail, null::text, null::text, null::text, null::numeric, null::numeric, null::text, null::text, must_answer from s_hours
  union all
  select anchor_key, code, d, platform, issue_type, issue_kind, detail, oid, tm, basket, subtotal, refund, review, asked, true from comp
  union all
  select anchor_key, code, d, platform, issue_type, issue_kind, detail, oid, tm, basket, subtotal, refund, review, asked, true from lowrate
  union all
  select anchor_key, code, d, platform, issue_type, issue_kind, detail, oid, tm, basket, subtotal, null::numeric, null::text, null::text, true from z_rej
  union all
  select anchor_key, code, d, platform, issue_type, issue_kind, detail, oid, tm, basket, val, null::numeric, null::text, null::text, must_answer from s_rej
  on conflict (anchor_key) do update set
    outlet_code = excluded.outlet_code, business_date = excluded.business_date, platform = excluded.platform,
    issue_type = excluded.issue_type, issue_kind = excluded.issue_kind, detail = excluded.detail,
    order_id = excluded.order_id, order_time = excluded.order_time, basket = excluded.basket,
    value = excluded.value, refund = excluded.refund, customer_words = excluded.customer_words,
    customer_asked = excluded.customer_asked, must_answer = excluded.must_answer, refreshed_at = now();

  get diagnostics n = row_count;
  return n;
end $fn$;
