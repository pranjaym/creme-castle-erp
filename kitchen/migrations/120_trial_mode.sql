-- ============================================================
-- Migration 120: TRIAL MODE and the CLEAN SLATE
-- Decision: Pranjay 20 Aug 2026. The module goes live for a TRIAL with the real
-- team on the real spine; when the trial is judged successful we "start clean"
-- and real operations begin.
--
-- Canonical rule 6 forbids hard deletes, so the clean slate is a SWITCH, not a
-- deletion: every operational row records the mode it was entered under, and
-- every consumer view shows only rows of the CURRENT mode. Flipping the mode
-- from 'trial' to 'live' empties every screen, level and report in one instant,
-- while every trial row stays on the record forever and can still be read by
-- setting the mode back or querying the tables directly.
--
-- This also means a trial can be run again later (for example when Breads,
-- Cakes and Desserts join) without ever contaminating the live books.
-- ============================================================

-- ---------- the mode register ----------
create table if not exists spine_modes (
  key        text primary key,
  mode       text not null check (mode in ('trial', 'live')),
  changed_by text,
  changed_at timestamptz not null default now(),
  note       text
);
comment on table spine_modes is
  'Which mode a module is operating in. Consumer views show only rows whose data_mode matches. trial to live is the clean slate: a switch, never a delete.';

insert into spine_modes (key, mode, changed_by, note)
values ('kitchen', 'trial', 'migration 120', 'department module trial with the real team begins')
on conflict (key) do nothing;

create or replace function kitchen_mode() returns text
language sql stable as $$ select mode from spine_modes where key = 'kitchen' $$;
comment on function kitchen_mode() is
  'The kitchen module''s current mode. Used as the DEFAULT on operational tables (stamped at insert) and as the filter in every consumer view.';

-- The go-live switch. Audited; call it instead of updating the table by hand:
--   select set_kitchen_mode('live', 'pranjay', 'trial signed off, real operations start');
create or replace function set_kitchen_mode(new_mode text, actor text, why text default null)
returns text language plpgsql as $$
begin
  if new_mode not in ('trial', 'live') then
    raise exception 'mode must be trial or live, got %', new_mode;
  end if;
  update spine_modes
     set mode = new_mode, changed_by = actor, changed_at = now(), note = coalesce(why, note)
   where key = 'kitchen';
  insert into spine_events (entity, entity_ref, action, actor, data)
  values ('spine_modes', 'kitchen', 'mode_changed', actor,
          jsonb_build_object('mode', new_mode, 'note', why));
  return new_mode;
end $$;

-- ---------- stamp the mode on every operational row ----------
-- Existing rows (the July trial entries and the August build tests) take the
-- value at ALTER time, which is 'trial': exactly right, they are not real
-- operational data and they disappear from every screen at go-live.
alter table production_log    add column if not exists data_mode text not null default kitchen_mode();
alter table closing_counts    add column if not exists data_mode text not null default kitchen_mode();
alter table transfer_receipts add column if not exists data_mode text not null default kitchen_mode();
alter table dept_requests     add column if not exists data_mode text not null default kitchen_mode();
alter table production_plans  add column if not exists data_mode text not null default kitchen_mode();

create index if not exists idx_prodlog_mode on production_log (data_mode, business_date);

-- ---------- every consumer view filters to the current mode ----------
-- CREATE OR REPLACE throughout (column lists unchanged), so nothing is dropped
-- and no dependent view is disturbed.

create or replace view v_production_movements as
select id, business_date, sku_id, action,
       case when action = 'made' then qty else -qty end as signed_qty,
       uom, from_location_id, to_location_id, via_location_id, reason_code,
       entered_by, entered_at, corrects_id
from production_log
where data_mode = kitchen_mode();
-- v_frozen_buffer reads v_production_movements, so it inherits the filter.

create or replace view v_today_entries as
select pl.id, pl.entered_at, s.code as sku_code, s.name as sku_name,
       pl.action, pl.qty, pl.uom, pl.reason_code,
       tl.code as to_code, tl.name as to_name, vl.code as via_code,
       pl.entered_by, pl.note
from production_log pl
join skus s on s.id = pl.sku_id
left join locations tl on tl.id = pl.to_location_id
left join locations vl on vl.id = pl.via_location_id
where pl.business_date = business_day(now())
  and pl.data_mode = kitchen_mode()
order by pl.entered_at desc;

-- The department screens' entry list reads this instead of the table, so the
-- app needs no knowledge of modes.
create or replace view v_production_log_current as
select * from production_log where data_mode = kitchen_mode();

create or replace view v_receipt_effective as
select distinct on (production_log_id)
  production_log_id, id as receipt_id, received_qty, received_by, received_at, note
from transfer_receipts
where data_mode = kitchen_mode()
order by production_log_id, id desc;

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
  and pl.data_mode = kitchen_mode()
  and tl.type in ('kitchen_department', 'assembly_spoke')
  and not exists (select 1 from transfer_receipts r where r.production_log_id = pl.id);

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
where re.received_qty <> pl.qty
  and pl.data_mode = kitchen_mode();

create or replace view v_closing_effective as
select c.*
from closing_counts c
where c.data_mode = kitchen_mode()
  and not exists (select 1 from closing_counts x where x.corrects_id = c.id);
-- v_closing_totals reads v_closing_effective, so it inherits the filter.

create or replace view v_request_status as
select r.id, r.qty as requested_qty, r.uom, r.needed_by, r.note,
       r.status, r.cancel_reason, r.cancelled_by, r.cancelled_at,
       r.entered_by, r.entered_at,
       rb.code as requester_code, rb.name as requester_name,
       rf.code as maker_code,    rf.name as maker_name,
       s.code as sku_code, s.name as sku_name,
       coalesce(f.sent_qty, 0) as sent_qty,
       greatest(r.qty - coalesce(f.sent_qty, 0), 0) as remaining_qty,
       case
         when r.status = 'cancelled' then 'cancelled'
         when coalesce(f.sent_qty, 0) >= r.qty then 'fulfilled'
         when coalesce(f.sent_qty, 0) > 0 then 'partial'
         else 'open'
       end as state
from dept_requests r
join locations rb on rb.id = r.requested_by_location_id
join locations rf on rf.id = r.requested_from_location_id
join skus s       on s.id  = r.sku_id
left join (
  select request_id, sum(qty) as sent_qty
  from production_log
  where action = 'issued' and request_id is not null and data_mode = kitchen_mode()
  group by request_id
) f on f.request_id = r.id
where r.data_mode = kitchen_mode();

create or replace view v_plan_effective as
select distinct on (location_id, business_date, sku_id)
  id, location_id, business_date, sku_id,
  par_qty, par_type, on_hand_qty, requested_qty, suggested_qty, planned_qty,
  uom, entered_by, entered_at
from production_plans
where data_mode = kitchen_mode()
order by location_id, business_date, sku_id, id desc;

create or replace view v_dept_day_ledger as
with mv as (
  select from_location_id as dept_id, business_date, sku_id,
         sum(qty) filter (where action = 'made')   as made,
         sum(qty) filter (where action = 'issued') as sent,
         sum(qty) filter (where action = 'wasted') as wasted
  from production_log
  where data_mode = kitchen_mode()
  group by from_location_id, business_date, sku_id
),
rcv as (
  select pl.to_location_id as dept_id, pl.business_date, pl.sku_id,
         sum(coalesce(re.received_qty, pl.qty)) as received,
         count(*) filter (where re.production_log_id is null) as receipts_pending
  from production_log pl
  left join v_receipt_effective re on re.production_log_id = pl.id
  where pl.action = 'issued' and pl.data_mode = kitchen_mode()
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
