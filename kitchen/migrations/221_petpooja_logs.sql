-- ============================================================
-- Migration 221: PETPOOJA LOGS AS SECOND WITNESSES (9 September 2026, Pranjay's go)
-- Target: the spine Supabase project. Additive only (CREATE ... IF NOT EXISTS).
-- Design record: erp-plan/integration-notes.md section 14 and 14a, flag F49.
--
-- Why. When an area manager disputes a Zomato or Swiggy figure, the tie-breaker
-- is the POS's own event log. Three Petpooja screens hold it:
--   /logs/online_log_status/1   Online Store Logs: every poll of the outlet's
--                               online status on both apps, plus manual ON/OFF
--                               events with the person who did it.
--   /logs/online_log_status/2   Online Item On/Off Logs: every item switched
--                               off or on, per app, with the window and whether a
--                               PERSON at the till did it ("biller") or Petpooja's
--                               automatic stock rule did it ("System").
--   /reports/online_rider_report  the "Online Order Activity Report": per order,
--                               both apps, Received / Accepted / Mark Ready /
--                               Rider Arrival / Picked up / Delivered / Cancelled /
--                               Returned To Store times.
--
-- Pranjay's rule for the item log (9 Sep 2026): manual and automatic switches
-- are recorded SEPARATELY and it must always be possible to see what happened.
-- Hence the trigger column, the actor kept verbatim, and the raw request and
-- response JSON kept on every row so the rule can be refined without re-pulling.
--
-- Conventions inherited from 060, 130 and 210, unchanged:
--   * landing schema, source values stored as TEXT where the source is text;
--   * ingest_run_id references landing.ingest_runs (source_system 'petpooja');
--   * re-loads SUPERSEDE, never update; nothing is deleted (CLAUDE.md rule 6);
--   * unique partial index on the natural key where superseded_at is null,
--     with dup_seq because the source can repeat a natural key.
--
-- Time convention: Petpooja prints IST wall clock with no zone. Stored as
-- timestamp without time zone, as shown. business_date is the calendar date
-- of the event as Petpooja files it (the log search is by calendar day).
-- ============================================================

-- ------------------------------------------------------------
-- T0. Outlet map: Petpooja's numeric outlet id, its label in the log page's
-- dropdown ("317707 - CC-DL-Janakpuri"), the client hash the store log and
-- the activity report use (4ef6rc1m), and our internal code.
-- ------------------------------------------------------------
create table if not exists landing.petpooja_outlet_map (
  petpooja_rest_id text primary key,
  outlet_label     text,
  internal_code    text,
  client_hash      text,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now()
);
comment on table landing.petpooja_outlet_map is
  'Petpooja outlet id to label, client hash and internal code. Filled by the petpooja-logs worker from the log page dropdown and the hashes it observes.';

-- ------------------------------------------------------------
-- T1. Store status log. One row per poll or manual event, per app.
-- event_kind: poll (Petpooja asked the app for the status) or manual (a person
-- switched the store from Petpooja) or other (anything else, kept verbatim).
-- ------------------------------------------------------------
create table if not exists landing.petpooja_store_status_log (
  id               bigserial primary key,
  ingest_run_id    bigint references landing.ingest_runs(id),
  business_date    date not null,
  petpooja_rest_id text not null,
  client_hash      text,
  logged_at        timestamp not null,
  app              text,
  event_kind       text not null,
  request_type     text,
  current_status   text,
  http_status      text,
  user_details     text,
  request_json     text,
  response_json    text,
  dup_seq          integer not null default 1,
  row_hash         text not null,
  superseded_by    bigint,
  superseded_at    timestamptz,
  loaded_at        timestamptz not null default now()
);
create unique index if not exists petpooja_store_status_log_key
  on landing.petpooja_store_status_log (petpooja_rest_id, logged_at, app, request_type, dup_seq)
  where superseded_at is null;
create index if not exists petpooja_store_status_log_day
  on landing.petpooja_store_status_log (business_date, petpooja_rest_id)
  where superseded_at is null;
comment on table landing.petpooja_store_status_log is
  'Petpooja Online Store Logs: a POLL of each app''s outlet status (median 12 min apart, gaps of hours) plus manual ON/OFF events with the user. Never present as a continuous timeline.';

-- ------------------------------------------------------------
-- T2. Item toggle log. One row per item switch per app.
-- trigger: manual (a named POS user such as "biller"), automatic (user "System",
-- Petpooja''s real time inventory switching the item off when stock hits zero),
-- unknown (anything else; the actor is kept verbatim so it can be classified later).
-- ------------------------------------------------------------
create table if not exists landing.petpooja_item_toggle_log (
  id               bigserial primary key,
  ingest_run_id    bigint references landing.ingest_runs(id),
  business_date    date not null,
  petpooja_rest_id text not null,
  outlet_name      text,
  app              text,
  logged_at        timestamp not null,
  action           text not null,
  object_type      text,
  trigger          text not null,
  actor_name       text,
  actor            text,
  window_from      timestamp,
  window_to        timestamp,
  item_ids         text,
  item_names       text,
  http_status      text,
  request_json     text,
  response_json    text,
  dup_seq          integer not null default 1,
  row_hash         text not null,
  superseded_by    bigint,
  superseded_at    timestamptz,
  loaded_at        timestamptz not null default now()
);
create unique index if not exists petpooja_item_toggle_log_key
  on landing.petpooja_item_toggle_log (petpooja_rest_id, logged_at, app, action, item_ids, dup_seq)
  where superseded_at is null;
create index if not exists petpooja_item_toggle_log_day
  on landing.petpooja_item_toggle_log (business_date, petpooja_rest_id)
  where superseded_at is null;
create index if not exists petpooja_item_toggle_log_trigger
  on landing.petpooja_item_toggle_log (trigger, action, business_date)
  where superseded_at is null;
comment on table landing.petpooja_item_toggle_log is
  'Petpooja Online Item On/Off Logs. trigger = manual (a person at the POS) or automatic (Petpooja''s stock rule, user "System"). item_ids is comma separated when one switch covered several items.';
comment on column landing.petpooja_item_toggle_log.trigger is
  'manual | automatic | unknown. Pranjay''s rule, 9 Sep 2026: record the two separately, always be able to see what happened.';

-- ------------------------------------------------------------
-- T3. Order activity. One row per order per outlet, both apps, the full journey.
-- Re-pulls supersede the row when a later timestamp appears (an order still in
-- flight at pull time gains its delivered time the next day).
-- ------------------------------------------------------------
create table if not exists landing.petpooja_order_activity (
  id               bigserial primary key,
  ingest_run_id    bigint references landing.ingest_runs(id),
  business_date    date not null,
  petpooja_rest_id text not null,
  client_hash      text,
  identifier       text,
  order_id         text not null,
  app_guess        text,
  order_status     text,
  received_at      timestamp,
  accepted_at      timestamp,
  mark_ready_at    timestamp,
  rider_arrival_at timestamp,
  picked_up_at     timestamp,
  delivered_at     timestamp,
  cancelled_at     timestamp,
  returned_at      timestamp,
  raw_json         text,
  row_hash         text not null,
  superseded_by    bigint,
  superseded_at    timestamptz,
  loaded_at        timestamptz not null default now()
);
create unique index if not exists petpooja_order_activity_key
  on landing.petpooja_order_activity (petpooja_rest_id, order_id)
  where superseded_at is null;
create index if not exists petpooja_order_activity_day
  on landing.petpooja_order_activity (business_date, petpooja_rest_id)
  where superseded_at is null;
create index if not exists petpooja_order_activity_order
  on landing.petpooja_order_activity (order_id)
  where superseded_at is null;
comment on table landing.petpooja_order_activity is
  'Petpooja Online Order Activity Report: the order journey on both apps from the POS''s own event log. app_guess is derived from the order id shape (10 digits Zomato, 15 digits Swiggy); join landing.petpooja_online_orders.order_from for the source''s own word.';

alter table landing.petpooja_outlet_map         enable row level security;
alter table landing.petpooja_store_status_log   enable row level security;
alter table landing.petpooja_item_toggle_log    enable row level security;
alter table landing.petpooja_order_activity     enable row level security;
