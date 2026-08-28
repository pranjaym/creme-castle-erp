-- 200_intraday_pulse.sql
-- The intraday pulse: hourly snapshots of the two live Petpooja sales reports.
--
-- Why a separate schema and not the landing tables:
--   landing.petpooja_* is the settled record of a business day, written once each
--   morning by the 08:00 job and verified against a fresh pull. The intraday feed is
--   a DIFFERENT thing: a part-day picture taken every hour while the day is still
--   running, where the same order legitimately appears again and again as its status
--   walks from Placed to Food Is Ready to Dispatched to Delivered. Mixing the two
--   would make the morning verification argue with itself. So the pulse lands here,
--   the morning job is untouched, and tomorrow the settled rows arrive in landing as
--   they always have.
--
-- Append only, in line with the project rule: nothing is ever updated in place and
-- nothing is ever deleted. Every hourly run inserts what it saw, tagged with its run.
-- A row already seen (same business_date + row_hash) is not inserted twice; it only
-- has its last_seen_run_id and seen_count moved forward, which is the audit trail of
-- "this order looked exactly like this at 11:00 and still at 12:00".
--
-- Built 28 August 2026 (Raksha Bandhan) on Pranjay's instruction to watch the day
-- hour by hour. Deliberately NOT special cased to one date: business_date and
-- occasion are columns, so Diwali, Valentine's and New Year use the same machinery.

create schema if not exists intraday;
revoke all on schema intraday from anon, authenticated;

-- ---------------------------------------------------------------- run register --

create table if not exists intraday.pulse_run (
  id             bigserial primary key,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  -- The clock a human reads. Petpooja's timestamps are already IST (migration 194),
  -- so this is stamped in IST too and the two are directly comparable.
  run_ist        timestamp   not null,
  business_date  date        not null,
  occasion       text,
  report         text        not null
                 check (report in ('online_orders', 'order_summary_item')),
  rows_parsed    integer     not null default 0,
  rows_skipped   integer     not null default 0,
  rows_new       integer     not null default 0,
  -- The newest order timestamp inside the downloaded file. This is the honest
  -- freshness marker: if it stops moving, Petpooja is serving a stale export and
  -- the numbers are not current, however recently the job ran.
  source_max_ts  text,
  receipt_sha    text,
  status         text        not null default 'running'
                 check (status in ('running', 'ok', 'failed')),
  note           text
);

create index if not exists idx_pulse_run_day on intraday.pulse_run (business_date, id desc);

-- ------------------------------------------------------------ order level feed --

create table if not exists intraday.pp_online_orders (
  id                    bigserial primary key,
  first_seen_run_id     bigint not null references intraday.pulse_run(id),
  last_seen_run_id      bigint not null references intraday.pulse_run(id),
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  seen_count            integer not null default 1,
  business_date         date not null,
  order_date            text,
  invoice_date          text,
  aggregator_order_no   text,
  pos_invoice_no        text,
  order_from            text,
  outlet_name           text,
  outlet_display_name   text,
  petpooja_identifier   text,
  order_type            text,
  customer_name         text,
  customer_phone        text,
  payment_type          text,
  delivery_status       text,
  status                text,
  my_amount             text,
  aggregator_discount   text,
  outlet_discount       text,
  delivery_charges      text,
  container_charges     text,
  additional_charge     text,
  total                 text,
  order_acceptance_time text,
  order_delivery_time   text,
  cancelled_by          text,
  reason                text,
  tip                   text,
  complimentary         text,
  row_hash              text not null,
  unique (business_date, row_hash)
);

create index if not exists idx_pulse_orders_day  on intraday.pp_online_orders (business_date);
create index if not exists idx_pulse_orders_key  on intraday.pp_online_orders (business_date, aggregator_order_no);

-- ------------------------------------------------------------- item level feed --

create table if not exists intraday.pp_order_items (
  id                  bigserial primary key,
  first_seen_run_id   bigint not null references intraday.pulse_run(id),
  last_seen_run_id    bigint not null references intraday.pulse_run(id),
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  seen_count          integer not null default 1,
  business_date       date not null,
  restaurant_name     text,
  invoice_no          text,
  order_ts            text,
  payment_type        text,
  order_type          text,
  status              text,
  area                text,
  virtual_brand_name  text,
  brand_grouping      text,
  assign_to           text,
  customer_phone      text,
  customer_name       text,
  customer_address    text,
  persons             text,
  order_cancel_reason text,
  my_amount           text,
  total_tax           text,
  discount            text,
  delivery_charge     text,
  container_charge    text,
  service_charge      text,
  additional_charge   text,
  deduction_charge    text,
  waived_off          text,
  round_off           text,
  total               text,
  item_name           text,
  category_name       text,
  sap_code            text,
  item_price          text,
  item_quantity       text,
  item_total          text,
  row_hash            text not null,
  unique (business_date, row_hash)
);

create index if not exists idx_pulse_items_day  on intraday.pp_order_items (business_date);
create index if not exists idx_pulse_items_item on intraday.pp_order_items (business_date, item_name);

-- -------------------------------------------------------------------- helpers --

-- Petpooja writes money as text WITH thousands separators once it passes 999
-- ("1,384.14"). A bare ::numeric cast on that raises, and because a part day rarely
-- has a four figure order it will pass every test and then fail in the evening when
-- the day is big. Every money read in this schema goes through here.
create or replace function intraday.money(t text) returns numeric
  language sql immutable as
$$ select nullif(replace(replace(coalesce(t, ''), ',', ''), ' ', ''), '')::numeric $$;

-- One malformed timestamp in 1.2 million landing rows must not take a whole view
-- down, so the cast is guarded rather than trusted.
create or replace function intraday.ts(t text) returns timestamp
  language plpgsql immutable as
$$ begin return t::timestamp; exception when others then return null; end $$;

-- The identity of an order. aggregator_order_no is the real key and is populated on
-- every row seen so far, but a null would make DISTINCT ON fold unrelated orders
-- into one, so it falls back to the POS invoice and finally to the row itself.
create or replace function intraday.order_key(agg text, pos text, id bigint)
  returns text language sql immutable as
$$ select coalesce(nullif(agg, ''), 'pos:' || nullif(pos, ''), 'row:' || id) $$;

-- ---------------------------------------------------------------------- views --

-- The current picture. One row per order: the LATEST version of it that any run has
-- seen. Needed because an order that moved Placed -> Delivered during the day is
-- present several times over, once per state, and summing all of them would count
-- the same sale four times.
create or replace view intraday.v_orders_now as
select distinct on (business_date, intraday.order_key(aggregator_order_no, pos_invoice_no, id))
       business_date,
       intraday.order_key(aggregator_order_no, pos_invoice_no, id) as order_key,
       aggregator_order_no, pos_invoice_no, order_from,
       outlet_name, outlet_display_name, order_type, status, delivery_status,
       order_date, intraday.ts(order_date) as placed_at,
       intraday.money(total)             as order_value,
       intraday.money(my_amount)         as my_amount_num,
       intraday.money(aggregator_discount) as agg_discount,
       intraday.money(outlet_discount)   as outlet_discount_num,
       cancelled_by, reason,
       first_seen_run_id, last_seen_run_id, seen_count
from intraday.pp_online_orders
order by business_date, intraday.order_key(aggregator_order_no, pos_invoice_no, id),
         last_seen_run_id desc, id desc;

-- Sales by the hour the order was PLACED. "live" excludes cancellations, which is
-- the number to read as the day's sales; cancelled is shown beside it, never netted
-- away silently.
create or replace view intraday.v_pulse_hourly as
select business_date,
       date_trunc('hour', placed_at)                                as hour,
       count(*) filter (where status <> 'Cancelled')                as orders,
       round(coalesce(sum(order_value) filter (where status <> 'Cancelled'), 0)) as sales,
       count(*) filter (where status = 'Cancelled')                 as cancelled_orders,
       round(coalesce(sum(order_value) filter (where status = 'Cancelled'), 0))  as cancelled_value,
       round(coalesce(avg(order_value) filter (where status <> 'Cancelled'), 0)) as aov
from intraday.v_orders_now
where placed_at is not null
group by 1, 2;

-- The same shape, read from the settled landing table, so any past day can be laid
-- against today hour for hour with identical arithmetic. Same filters, same money
-- parser, one definition of sales for both sides of every comparison.
create or replace view intraday.v_settled_hourly as
select business_date,
       date_trunc('hour', intraday.ts(order_date))                  as hour,
       count(*) filter (where status <> 'Cancelled')                as orders,
       round(coalesce(sum(intraday.money(total)) filter (where status <> 'Cancelled'), 0)) as sales,
       count(*) filter (where status = 'Cancelled')                 as cancelled_orders,
       round(coalesce(avg(intraday.money(total)) filter (where status <> 'Cancelled'), 0)) as aov
from landing.petpooja_online_orders
where voided_at is null and intraday.ts(order_date) is not null
group by 1, 2;

-- The item side, deduplicated the same way. An item line reappears in every snapshot
-- its order survives into, and once its order's status changes the row hash changes
-- with it, so the raw table holds the line several times over. The natural key is
-- (restaurant, invoice, item), which is the same key the dashboard history has used
-- since it was seeded.
create or replace view intraday.v_items_now as
select distinct on (business_date, restaurant_name, invoice_no, item_name)
       business_date, restaurant_name, invoice_no, item_name, category_name,
       status, order_type, area,
       intraday.ts(order_ts)               as placed_at,
       intraday.money(item_quantity)       as qty,
       intraday.money(item_total)          as item_value,
       intraday.money(total)               as order_total,
       last_seen_run_id
from intraday.pp_order_items
order by business_date, restaurant_name, invoice_no, item_name,
         last_seen_run_id desc, id desc;
