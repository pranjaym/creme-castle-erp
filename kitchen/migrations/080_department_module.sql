-- ============================================================
-- Migration 080: DEPARTMENT MODULE (Sponges + Liquids first)
-- Decisions: erp-plan/department-module-plan.md (19 Aug 2026).
-- Additive only. No re-baseline, ever. production_log already has live rows.
--
-- What this adds:
--   1. The Liquids department (the old single Sponge and Ganache dept splits
--      into Sponges and Liquids; Breads/Cakes/Desserts screens come later).
--   2. department_settings: per-department production-day start time. Each
--      department closes just before its own day starts; there is NO
--      company-wide day end (paper registers: sponges close 20:30 for a
--      21:00 start, liquids close 06:30 for a 07:00 start).
--   3. skus.made_by_location_id: which department makes each item.
--   4. transfer_receipts: the receiver's side of an issued movement.
--      Append-only; a re-confirmation is a NEW row, latest wins by (id).
--   5. closing_counts: the physical end-of-day count, a fourth entry type,
--      separate from the three movement verbs. Age-bucketed like the paper
--      registers (3/2/1 days old). Corrections supersede via corrects_id.
--   6. Views: pending receipts, effective receipts/closings, and the
--      department day ledger where consumption is DERIVED, never entered:
--        gap = opening + made + received - sent - wasted - closing
-- ============================================================

-- ---------- 1. the Liquids department ----------
insert into locations (code, name, type, region)
select 'CK-LIQUID', 'Liquids Dept', 'kitchen_department'::location_type, 'Delhi NCR'
where not exists (select 1 from locations where code = 'CK-LIQUID');

update locations set parent_id = (select id from locations where code = 'CK')
where code = 'CK-LIQUID' and parent_id is null;

-- The old combined department becomes the Sponge Dept (display rename only;
-- the canonical code CK-SPONGE and every existing row keep working; the old
-- display name is preserved in notes).
update locations
set name = 'Sponge Dept',
    notes = coalesce(notes || ' | ', '') || 'renamed from "Sponge and Ganache Dept" 2026-08-19 (dept split, see erp-plan/department-module-plan.md)'
where code = 'CK-SPONGE' and name = 'Sponge and Ganache Dept';

-- ---------- 2. per-department settings ----------
create table if not exists department_settings (
  location_id    bigint primary key references locations(id),
  day_start_time time not null,          -- IST; the production day runs start to start
  closing_before time not null,          -- IST; when the physical count is done (display/reminder only)
  sort_order     int,
  active         boolean not null default true,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table department_settings is
  'Per-department production day. No company-wide day end: each department closes just before its own day starts. Times are IST.';

insert into department_settings (location_id, day_start_time, closing_before, sort_order, note)
select l.id, v.day_start, v.closing, v.sort, v.note
from (values
  ('CK-SPONGE', time '21:00', time '20:30', 1, 'sponge production runs overnight from 21:00'),
  ('CK-LIQUID', time '07:00', time '06:30', 2, 'mise en place / ganache day starts 07:00')
) as v(code, day_start, closing, sort, note)
join locations l on l.code = v.code
where not exists (select 1 from department_settings d where d.location_id = l.id);

-- ---------- 3. which department makes each item ----------
alter table skus add column if not exists made_by_location_id bigint references locations(id);
comment on column skus.made_by_location_id is
  'The department that produces this item. Sponge category -> Sponge Dept; Ganache and Sub-component -> Liquids Dept (dept split 19 Aug 2026).';

update skus set made_by_location_id = (select id from locations where code = 'CK-SPONGE')
where sku_type = 'intermediate' and category = 'Sponge' and made_by_location_id is null;

update skus set made_by_location_id = (select id from locations where code = 'CK-LIQUID')
where sku_type = 'intermediate' and category in ('Ganache', 'Sub-component') and made_by_location_id is null;

-- ---------- 4. the receiver's side of a transfer ----------
create table if not exists transfer_receipts (
  id                bigint generated always as identity primary key,
  production_log_id bigint not null references production_log(id),
  received_qty      numeric(12,2) not null check (received_qty >= 0),
  received_by       text not null,
  received_at       timestamptz not null default now(),
  note              text
);
comment on table transfer_receipts is
  'Receiver confirmation of an issued production_log row. Append-only: a re-confirmation is a new row and the latest (highest id) is effective. received_qty may be 0 (nothing arrived).';
create index if not exists idx_transfer_receipts_log on transfer_receipts (production_log_id, id desc);

-- ---------- 5. the closing count (fourth entry type) ----------
create table if not exists closing_counts (
  id            bigint generated always as identity primary key,
  location_id   bigint not null references locations(id),   -- the department
  business_date date not null,                              -- the department day being closed (IST calendar date the day STARTED on)
  sku_id        bigint not null references skus(id),
  qty           numeric(12,2) not null check (qty >= 0),
  age_days      int check (age_days between 0 and 14),      -- 0 = made today, 1 = yesterday...; null = unsplit total
  uom           text not null,
  entered_by    text not null,
  entered_at    timestamptz not null default now(),
  note          text,
  corrects_id   bigint references closing_counts(id)        -- a correction supersedes the row it points at
);
comment on table closing_counts is
  'Physical end-of-day count per department, age-bucketed like the paper registers (3/2/1 days old). Append-only; a correction is a new row whose corrects_id points at the superseded row.';
create index if not exists idx_closing_counts_day on closing_counts (location_id, business_date, sku_id);

-- ---------- 6. views ----------

-- Effective receipt per issued row: the latest confirmation wins, all rows kept.
create or replace view v_receipt_effective as
select distinct on (production_log_id)
  production_log_id, id as receipt_id, received_qty, received_by, received_at, note
from transfer_receipts
order by production_log_id, id desc;

-- Transfers waiting for the receiver to confirm (issued to a department or spoke,
-- no receipt yet). This is the receiving screen's inbox.
create or replace view v_pending_receipts as
select pl.id as production_log_id,
       pl.business_date, pl.entered_at as sent_at, pl.entered_by as sent_by,
       pl.qty as sent_qty, pl.uom,
       s.code as sku_code, s.name as sku_name,
       fl.code as from_code, fl.name as from_name,
       tl.code as to_code, tl.name as to_name
from production_log pl
join skus s        on s.id  = pl.sku_id
join locations fl  on fl.id = pl.from_location_id
join locations tl  on tl.id = pl.to_location_id
where pl.action = 'issued'
  and tl.type in ('kitchen_department', 'assembly_spoke')
  and not exists (select 1 from transfer_receipts r where r.production_log_id = pl.id);

-- Confirmed transfers whose received quantity differs from the sent quantity:
-- the discrepancy register, by route, both names attached.
create or replace view v_transfer_mismatches as
select pl.id as production_log_id, pl.business_date,
       s.code as sku_code, s.name as sku_name,
       fl.name as from_name, tl.name as to_name,
       pl.qty as sent_qty, re.received_qty, pl.uom,
       (re.received_qty - pl.qty) as difference,
       pl.entered_by as sent_by, re.received_by, re.received_at
from production_log pl
join v_receipt_effective re on re.production_log_id = pl.id
join skus s       on s.id  = pl.sku_id
join locations fl on fl.id = pl.from_location_id
join locations tl on tl.id = pl.to_location_id
where re.received_qty <> pl.qty;

-- Effective closing rows: every row not superseded by a correction.
create or replace view v_closing_effective as
select c.*
from closing_counts c
where not exists (select 1 from closing_counts x where x.corrects_id = c.id);

-- Closing total per department, day, item (age buckets summed).
create or replace view v_closing_totals as
select location_id, business_date, sku_id, sum(qty) as closing_qty, max(uom) as uom
from v_closing_effective
group by location_id, business_date, sku_id;

-- The department day ledger. One row per department, item, day that had any
-- activity or a count. Consumption/gap is DERIVED, never entered:
--   gap = opening + made + received - sent - wasted - closing
-- opening = the previous day's closing count (null until a count exists, in
-- which case gap is null too: no invented numbers).
create or replace view v_dept_day_ledger as
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
)
select k.dept_id, dl.code as dept_code, k.business_date, k.sku_id,
       s.code as sku_code, s.name as sku_name, s.uom,
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
left join v_closing_totals op on op.location_id = k.dept_id and op.business_date = k.business_date - 1 and op.sku_id = k.sku_id;
comment on view v_dept_day_ledger is
  'Per department, item, day: opening (prev closing), made, received (confirmed or sent), sent, wasted, closing, and the derived gap. gap is null until both opening and closing counts exist: no invented numbers.';
