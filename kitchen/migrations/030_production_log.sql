-- ============================================================
-- Migration 030: BUILD 3a, the intermediates logbook (schema v2)
-- Depends on: 000_foundation.sql
-- Three movement verbs, destinations come from the location master, so adding a
-- department or a spoke later needs NO code change:
--   made    -> into the frozen buffer (qty +)
--   issued  -> to a destination: Cake Dept, Dessert Dept, or a spoke (qty -)
--   wasted  -> reason-coded (qty -)
-- Append-only: a correction is a NEW reversing row, never an edit or delete.
-- ============================================================

do $$ begin
  create type production_action as enum ('made','issued','wasted');
exception when duplicate_object then null; end $$;

create table if not exists waste_reasons (
  code     text primary key,
  label_en text not null,
  label_hi text,
  active   boolean not null default true
);

-- NOTE: this is the KITCHEN (back-of-house) ledger, which runs 24 hours. Its day is
-- the plain IST calendar date, NOT the 04:00 sales business_day(). business_date is
-- the production day the chef chooses (today or yesterday); entered_at is the honest
-- wall clock, so a catch-up entry is always visible as entered_at <> business_date.
create table if not exists production_log (
  id                bigint generated always as identity primary key,
  business_date     date not null,                  -- IST calendar production day (chef-chosen)
  sku_id            bigint not null references skus(id),
  action            production_action not null,
  qty               numeric(12,2) not null check (qty > 0),  -- positive; sign is by action
  uom               text not null,                  -- entry unit snapshot at entry time
  from_location_id  bigint references locations(id), -- the making department (default the sponge dept)
  to_location_id    bigint references locations(id), -- destination for made (freezer) and issued
  via_location_id   bigint references locations(id), -- e.g. Central Dispatch cross-dock on a spoke send
  reason_code       text references waste_reasons(code),
  note              text,
  entered_by        text not null,
  entered_at        timestamptz not null default now(),
  corrects_id       bigint references production_log(id),
  constraint wasted_needs_reason
    check (action <> 'wasted' or reason_code is not null),
  constraint made_issued_need_destination
    check (action = 'wasted' or to_location_id is not null)
);
create index if not exists idx_prodlog_day on production_log (business_date);
create index if not exists idx_prodlog_sku on production_log (sku_id, business_date);
create index if not exists idx_prodlog_to  on production_log (to_location_id, business_date);

-- Signed movements: made adds to the buffer, issued and wasted subtract.
create or replace view v_production_movements as
select id, business_date, sku_id, action,
       case when action = 'made' then qty else -qty end as signed_qty,
       uom, from_location_id, to_location_id, via_location_id, reason_code,
       entered_by, entered_at, corrects_id
from production_log;

-- Current frozen-buffer level per intermediate, par + derived buffer behaviour,
-- in the chef's sort order, every intermediate shown (0 until logged).
create or replace view v_frozen_buffer as
with level as (
  select sku_id, sum(signed_qty) as on_hand
  from v_production_movements group by sku_id
),
current_par as (
  select distinct on (sku_id, location_id) sku_id, par_qty, par_type
  from par_stocks
  where effective_from <= (now() at time zone 'Asia/Kolkata')::date   -- IST calendar day (24h kitchen)
  order by sku_id, location_id, effective_from desc
)
select
  s.code as sku_code, s.name as sku_name, s.category_canonical as category, s.uom,
  s.base_unit, s.sort_order, s.to_spokes, s.typical_qty_per_day,
  coalesce(lv.on_hand, 0) as on_hand,
  cp.par_qty, coalesce(cp.par_type, 'fixed') as par_type,
  case when cp.par_qty is not null then coalesce(lv.on_hand,0) - cp.par_qty end as vs_par,
  case
    when cp.par_type is not null and cp.par_type <> 'fixed'
      then initcap(replace(cp.par_type, '_', ' '))
    when cp.par_qty is null or s.typical_qty_per_day is null then null
    when cp.par_qty > s.typical_qty_per_day then 'Buffer'
    else 'Daily fresh'
  end as buffer_behaviour
from skus s
left join level lv       on lv.sku_id = s.id
left join current_par cp on cp.sku_id = s.id
where s.sku_type = 'intermediate' and s.active
order by s.sort_order;

-- Today's entries for the read-back screen. "Today" is the IST calendar date, since
-- the kitchen is 24h and does not use the 04:00 sales business_day().
create or replace view v_today_entries as
select pl.id, pl.entered_at, s.code as sku_code, s.name as sku_name,
       pl.action, pl.qty, pl.uom, pl.reason_code,
       tl.code as to_code, tl.name as to_name, vl.code as via_code, pl.entered_by, pl.note
from production_log pl
join skus s on s.id = pl.sku_id
left join locations tl on tl.id = pl.to_location_id
left join locations vl on vl.id = pl.via_location_id
where pl.business_date = (now() at time zone 'Asia/Kolkata')::date
order by pl.entered_at desc;

-- ---------- SEED: waste reasons ----------
insert into waste_reasons (code, label_en, label_hi) values
  ('failed_batch','Failed batch','Kharab batch'),
  ('trim_loss','Trim loss','Katai nuksan'),
  ('expired','Expired in freezer','Freezer mein expire'),
  ('spillage','Spillage or handling','Gira / handling'),
  ('other','Other (see note)','Anya (note dekhein)')
on conflict (code) do nothing;
