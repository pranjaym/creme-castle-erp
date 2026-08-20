-- ============================================================
-- Migration 110: PRODUCTION PLANS (the paper "PRODUCTION PLAN" column, digital)
-- Decisions (Pranjay 19-20 Aug 2026): the department chef's number is final and
-- may differ from the formula; v1 plans from par stock only (no demand feed).
-- Industry pattern followed (Fourth, Apicbase, Cybake; and SupplyNote's prep
-- planning): the plan is its OWN document generated from the latest count,
-- editable by the planner, with actuals recorded against it. Our closing flow
-- hands off straight into the plan screen so the chef's one motion on paper
-- (count, then write the plan) stays one motion here.
--
-- Reproducibility (canonical rule 4): the suggestion is pure arithmetic,
--   suggested = max(0, par - on hand + open requests)   [fixed par]
--   suggested = open requests                            [on_demand]
--   ready_made items are not planned
-- and every input (par, on hand, requests) is SNAPSHOTTED on the row, so the
-- suggestion can be re-derived forever even after masters change.
-- Append-only: re-planning an item inserts a new row; the latest row per
-- (department, day, item) is effective; nothing is edited or deleted.
-- ============================================================

create table if not exists production_plans (
  id            bigint generated always as identity primary key,
  location_id   bigint not null references locations(id),   -- the department
  business_date date not null,                              -- the production day being planned
  sku_id        bigint not null references skus(id),
  par_qty       numeric(12,2),                              -- snapshot at planning time
  par_type      text,                                       -- snapshot (fixed | on_demand | ready_made)
  on_hand_qty   numeric(12,2),                              -- snapshot: closing total of (business_date - 1); null = no count existed
  requested_qty numeric(12,2) not null default 0,           -- snapshot: open requests on this department
  suggested_qty numeric(12,2) not null,                     -- the formula's number (server-computed)
  planned_qty   numeric(12,2) not null check (planned_qty >= 0),  -- the chef's number (final)
  uom           text not null,
  entered_by    text not null,
  entered_at    timestamptz not null default now()
);
create index if not exists idx_production_plans_day
  on production_plans (location_id, business_date, sku_id, id desc);
comment on table production_plans is
  'The chef''s production plan per department, day, item. Suggestion inputs are snapshotted for reproducibility; the chef''s planned_qty is final (may differ from the suggestion). Append-only: latest row per (dept, day, item) is effective.';

-- Effective plan: the latest row per (department, day, item).
create or replace view v_plan_effective as
select distinct on (location_id, business_date, sku_id)
  id, location_id, business_date, sku_id,
  par_qty, par_type, on_hand_qty, requested_qty, suggested_qty, planned_qty,
  uom, entered_by, entered_at
from production_plans
order by location_id, business_date, sku_id, id desc;

-- The day ledger gains the plan: planned vs made side by side. Postgres cannot
-- insert a column mid-view with CREATE OR REPLACE, so drop and recreate (a view
-- holds no data; the underlying tables are untouched).
drop view if exists v_dept_day_ledger;
create view v_dept_day_ledger as
with mv as (
  select from_location_id as dept_id, business_date, sku_id,
         sum(qty) filter (where action = 'made')   as made,
         sum(qty) filter (where action = 'issued') as sent,
         sum(qty) filter (where action = 'wasted') as wasted
  from production_log
  group by from_location_id, business_date, sku_id
),
rcv as (
  select pl.to_location_id as dept_id, pl.business_date, pl.sku_id,
         sum(coalesce(re.received_qty, pl.qty)) as received,
         count(*) filter (where re.production_log_id is null) as receipts_pending
  from production_log pl
  left join v_receipt_effective re on re.production_log_id = pl.id
  where pl.action = 'issued'
  group by pl.to_location_id, pl.business_date, pl.sku_id
),
keys as (
  select dept_id, business_date, sku_id from mv
  union select dept_id, business_date, sku_id from rcv
  union select location_id, business_date, sku_id from v_closing_totals
  union select location_id, business_date, sku_id from v_plan_effective
)
select k.dept_id, dl.code as dept_code, k.business_date, k.sku_id,
       s.code as sku_code, s.name as sku_name, s.uom,
       pp.planned_qty                       as planned,
       op.closing_qty                       as opening,
       coalesce(mv.made, 0)                 as made,
       coalesce(rcv.received, 0)            as received,
       coalesce(rcv.receipts_pending, 0)    as receipts_pending,
       coalesce(mv.sent, 0)                 as sent,
       coalesce(mv.wasted, 0)               as wasted,
       ct.closing_qty                       as closing,
       case when ct.closing_qty is not null and op.closing_qty is not null then
         op.closing_qty + coalesce(mv.made, 0) + coalesce(rcv.received, 0)
           - coalesce(mv.sent, 0) - coalesce(mv.wasted, 0) - ct.closing_qty
       end                                  as gap
from keys k
join locations dl on dl.id = k.dept_id
join skus s       on s.id  = k.sku_id
left join mv  on mv.dept_id  = k.dept_id and mv.business_date  = k.business_date and mv.sku_id  = k.sku_id
left join rcv on rcv.dept_id = k.dept_id and rcv.business_date = k.business_date and rcv.sku_id = k.sku_id
left join v_closing_totals ct on ct.location_id = k.dept_id and ct.business_date = k.business_date and ct.sku_id = k.sku_id
left join v_closing_totals op on op.location_id = k.dept_id and op.business_date = k.business_date - 1 and op.sku_id = k.sku_id
left join v_plan_effective pp on pp.location_id = k.dept_id and pp.business_date = k.business_date and pp.sku_id = k.sku_id;
comment on view v_dept_day_ledger is
  'Per department, item, day: plan (chef''s number), opening (prev closing), made, received, sent, wasted, closing, derived gap. gap is null until both opening and closing counts exist: no invented numbers.';
