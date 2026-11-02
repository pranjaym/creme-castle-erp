-- ============================================================
-- Migration 250: PETPOOJA PUSH RECEIVERS (2 November 2026, Pranjay's go)
-- Target: the spine Supabase project. Additive only.
-- Design record: erp-plan/petpooja-webhooks-plan.md, integration-notes.md
-- section 16, flag F78.
--
-- Why. Petpooja's trial pushes two feeds to the kitchen app:
--   /api/petpooja/orders           Global API: one JSON per bill on "Save and
--                                  Print" (CC-ND-Sector 68 only in the trial).
--   /api/petpooja/purchase-orders  Inventory API 8: one JSON per purchase order
--                                  saved (Sector 68, Central Dispatch Noida,
--                                  Central Kitchen-Noida).
-- Every Petpooja feed lands once in the spine; apps read it from here.
--
-- Layers, both in landing (source shaped, Petpooja's own words):
--   T1 landing.petpooja_push_events   every delivery, append only, kept even
--                                     when the key is wrong. The body is stored
--                                     as received except that the values of
--                                     token, Token, app_key, app_secret and
--                                     access_token are blanked by the route
--                                     (secrets live in env vars only); the
--                                     SHA-256 of the ORIGINAL body is kept.
--   T2 landing.petpooja_push_orders   one row per bill (rest_id, order_id).
--   T3 landing.petpooja_push_purchase_orders  one row per PO (menu_sharing_code, po_id).
-- Folding pushed bills into core.orders is the later canonical step, after the
-- trial proves the push matches the report export bill for bill.
--
-- Rules carried:
--   * nothing is deleted; a delivery that repeats an earlier one is kept and
--     marked repeat_of; the keyed rows are upserted, so a repeat adds nothing;
--   * a Cancelled bill never returns to Success on a later copy: that copy is
--     kept, the bill keeps Cancelled and status_conflict is set;
--   * customer name, phone and address live only here; RLS on, no policies,
--     so only the service role reads them (no view, no portal page);
--   * phone cleaned to the last 10 digits when they start 6 to 9 (a leading
--     91 is dropped by taking the last 10); otherwise customer_phone is null;
--   * Petpooja prints IST wall clock with no zone: created_on is stored as
--     timestamp without time zone, as given (convention of 221 and 194);
--   * every create and status change writes public.spine_events.
--
-- One entry point: public.petpooja_push_receive(...) inserts the event and
-- applies it in one call (one round trip from Vercel). If applying fails the
-- event is still saved with apply_error, and public.petpooja_push_apply(id)
-- re-applies it later (the nightly sweep will call it for applied_at is null).
-- No begin/commit here: the caller owns the transaction (F41).
-- ============================================================

-- ------------------------------------------------------------
-- Helpers
-- ------------------------------------------------------------
create or replace function landing.pp_num(v text)
returns numeric language sql immutable as $fn$
  select case when btrim(v) ~ '^[-+]?[0-9]*\.?[0-9]+$' then btrim(v)::numeric end
$fn$;

create or replace function landing.pp_date(v text)
returns date language sql immutable as $fn$
  select case when btrim(v) ~ '^\d{4}-\d{2}-\d{2}$' then btrim(v)::date end
$fn$;

create or replace function landing.pp_ts(v text)
returns timestamp language sql immutable as $fn$
  select case when btrim(v) ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$' then btrim(v)::timestamp end
$fn$;

-- The CC mobile rule: digits only, the last 10, valid when they start 6 to 9.
create or replace function landing.pp_clean_mobile(raw text)
returns text language sql immutable as $fn$
  select case
    when length(regexp_replace(coalesce(raw, ''), '\D', '', 'g')) >= 10
     and right(regexp_replace(raw, '\D', '', 'g'), 10) ~ '^[6-9]'
    then right(regexp_replace(raw, '\D', '', 'g'), 10)
  end
$fn$;

-- ------------------------------------------------------------
-- T1. Every delivery, both feeds.
-- ------------------------------------------------------------
create table if not exists landing.petpooja_push_events (
  id            bigserial primary key,
  feed          text not null check (feed in ('orders', 'purchase_orders')),
  received_at   timestamptz not null default now(),
  source_ip     text,
  user_agent    text,
  content_type  text,
  body_bytes    integer not null,
  body_sha256   text not null,          -- of the body exactly as it arrived
  body_text     text not null,          -- as arrived, secret values blanked
  body_json     jsonb,                  -- body_text parsed; null when not JSON
  parse_error   text,
  verified      boolean not null,
  verify_reason text not null,
  event_name    text,                   -- "orderdetails" on bills
  key_outlet    text,                   -- bill: Restaurant.restID; PO: menuSharingCode
  key_doc       text,                   -- bill: Order.orderID; PO: data.id
  doc_status    text,                   -- bill: Order.status; PO: data.status
  repeat_of     bigint references landing.petpooja_push_events(id),
  applied_at    timestamptz,
  apply_result  text,
  apply_error   text,
  is_test       boolean not null default false,
  test_note     text
);
create index if not exists petpooja_push_events_sha
  on landing.petpooja_push_events (feed, body_sha256);
create index if not exists petpooja_push_events_key
  on landing.petpooja_push_events (feed, key_outlet, key_doc);
create index if not exists petpooja_push_events_unapplied
  on landing.petpooja_push_events (id) where applied_at is null and verified;
alter table landing.petpooja_push_events enable row level security;
comment on table landing.petpooja_push_events is
  'Every Petpooja push delivery (bills and POs), append only, kept even when unverified. Secret values blanked, SHA-256 of the original kept. Holds customer PII: service role only. Migration 250.';

-- ------------------------------------------------------------
-- T2. One row per pushed bill.
-- ------------------------------------------------------------
create table if not exists landing.petpooja_push_orders (
  id                  bigserial primary key,
  rest_id             text not null,
  order_id            text not null,
  res_name            text,
  customer_invoice_id text,
  order_type          text,
  sub_order_type      text,
  order_from          text,
  order_from_id       text,
  payment_type        text,
  created_on          timestamp,        -- IST wall clock as Petpooja prints it
  business_date       date,             -- 04:00 to 03:59 IST sales day
  status              text not null,
  cancelled_at        timestamptz,      -- when the first Cancelled copy arrived
  status_conflict     boolean not null default false,
  core_total          numeric,
  discount_total      numeric,
  tax_total           numeric,
  delivery_charges    numeric,
  packaging_charge    numeric,
  service_charge      numeric,
  round_off           numeric,
  total               numeric,
  biller              text,
  assignee            text,
  table_no            text,
  token_no            text,
  comment             text,
  items               jsonb,
  taxes               jsonb,
  discounts           jsonb,
  part_payments       jsonb,
  item_count          integer,
  customer_name       text,
  customer_address    text,
  customer_gstin      text,
  customer_phone_raw  text,
  customer_phone      text,             -- pp_clean_mobile(customer_phone_raw)
  content_md5         text,             -- md5 of properties, to see a changed copy
  first_event_id      bigint not null references landing.petpooja_push_events(id),
  last_event_id       bigint not null references landing.petpooja_push_events(id),
  push_count          integer not null default 1,
  first_received_at   timestamptz not null,
  last_received_at    timestamptz not null,
  is_test             boolean not null default false,
  unique (rest_id, order_id)
);
create index if not exists petpooja_push_orders_day
  on landing.petpooja_push_orders (business_date, rest_id);
alter table landing.petpooja_push_orders enable row level security;
comment on table landing.petpooja_push_orders is
  'One row per bill pushed by the Petpooja Global API, keyed (rest_id, order_id). Latest copy wins except Cancelled never reverts. History is in petpooja_push_events. Holds customer PII: service role only. Migration 250.';

-- ------------------------------------------------------------
-- T3. One row per pushed purchase order.
-- ------------------------------------------------------------
create table if not exists landing.petpooja_push_purchase_orders (
  id                 bigserial primary key,
  menu_sharing_code  text not null,
  po_id              text not null,
  po_number          text,
  delivery_date      date,
  receiver_type      text,
  status             text,
  total              numeric,
  total_tax          numeric,
  round_off          numeric,
  sender_name        text,
  sender_gst         text,
  receiver_name      text,
  receiver_gst       text,
  from_department    text,
  to_department      text,
  item_count         integer,
  item_details       jsonb,
  rest_details       jsonb,
  charge_details     jsonb,
  content_md5        text,              -- md5 of data, to see a changed copy
  first_event_id     bigint not null references landing.petpooja_push_events(id),
  last_event_id      bigint not null references landing.petpooja_push_events(id),
  push_count         integer not null default 1,
  first_received_at  timestamptz not null,
  last_received_at   timestamptz not null,
  is_test            boolean not null default false,
  unique (menu_sharing_code, po_id)
);
alter table landing.petpooja_push_purchase_orders enable row level security;
comment on table landing.petpooja_push_purchase_orders is
  'One row per purchase order pushed by Petpooja Inventory API 8, keyed (menu_sharing_code, po_id). Latest copy wins. History is in petpooja_push_events. Migration 250.';

-- ------------------------------------------------------------
-- Apply one saved event to its keyed row. Returns the result word:
-- created, updated, unchanged, status_conflict, or skipped: <why>.
-- ------------------------------------------------------------
create or replace function public.petpooja_push_apply(p_event_id bigint)
returns text language plpgsql security definer set search_path = landing, public as $fn$
declare
  e        landing.petpooja_push_events;
  p        jsonb;
  o        jsonb;
  c        jsonb;
  d        jsonb;
  v_md5    text;
  v_status text;
  r_ord    landing.petpooja_push_orders;
  r_po     landing.petpooja_push_purchase_orders;
  v_result text;
  v_ref    text;
begin
  select * into e from landing.petpooja_push_events where id = p_event_id for update;
  if not found then raise exception 'No push event %', p_event_id; end if;
  if e.applied_at is not null then return e.apply_result; end if;

  if not e.verified then
    v_result := 'skipped: not verified';
  elsif e.body_json is null then
    v_result := 'skipped: not JSON';
  elsif coalesce(e.key_outlet, '') = '' or coalesce(e.key_doc, '') = '' then
    v_result := 'skipped: no key';

  elsif e.feed = 'orders' then
    p := e.body_json -> 'properties';
    o := p -> 'Order';
    c := p -> 'Customer';
    v_md5 := md5(p::text);
    v_status := coalesce(nullif(o ->> 'status', ''), 'Unknown');
    v_ref := e.key_outlet || '/' || e.key_doc;

    select * into r_ord from landing.petpooja_push_orders
     where rest_id = e.key_outlet and order_id = e.key_doc for update;

    if not found then
      insert into landing.petpooja_push_orders (
        rest_id, order_id, res_name, customer_invoice_id, order_type, sub_order_type,
        order_from, order_from_id, payment_type, created_on, business_date, status,
        cancelled_at, core_total, discount_total, tax_total, delivery_charges,
        packaging_charge, service_charge, round_off, total, biller, assignee, table_no,
        token_no, comment, items, taxes, discounts, part_payments, item_count,
        customer_name, customer_address, customer_gstin, customer_phone_raw, customer_phone,
        content_md5, first_event_id, last_event_id, first_received_at, last_received_at, is_test)
      values (
        e.key_outlet, e.key_doc, p #>> '{Restaurant,res_name}', o ->> 'customer_invoice_id',
        o ->> 'order_type', o ->> 'sub_order_type', o ->> 'order_from', nullif(o ->> 'order_from_id', ''),
        o ->> 'payment_type', pp_ts(o ->> 'created_on'),
        business_day(pp_ts(o ->> 'created_on') at time zone 'Asia/Kolkata'), v_status,
        case when v_status = 'Cancelled' then e.received_at end,
        pp_num(o ->> 'core_total'), pp_num(o ->> 'discount_total'), pp_num(o ->> 'tax_total'),
        pp_num(o ->> 'delivery_charges'), pp_num(o ->> 'packaging_charge'), pp_num(o ->> 'service_charge'),
        pp_num(o ->> 'round_off'), pp_num(o ->> 'total'), o ->> 'biller', nullif(o ->> 'assignee', ''),
        nullif(o ->> 'table_no', ''), nullif(o ->> 'token_no', ''), nullif(o ->> 'comment', ''),
        p -> 'OrderItem', p -> 'Tax', p -> 'Discount', o -> 'part_payments',
        case when jsonb_typeof(p -> 'OrderItem') = 'array' then jsonb_array_length(p -> 'OrderItem') end,
        nullif(c ->> 'name', ''), nullif(c ->> 'address', ''), nullif(c ->> 'gstin', ''),
        nullif(c ->> 'phone', ''), pp_clean_mobile(c ->> 'phone'),
        v_md5, e.id, e.id, e.received_at, e.received_at, e.is_test)
      on conflict (rest_id, order_id) do nothing;
      if found then
        v_result := 'created';
        insert into public.spine_events (entity, entity_ref, action, actor, data)
        values ('petpooja_push_order', v_ref, 'created', 'petpooja-push',
                jsonb_build_object('event_id', e.id, 'status', v_status, 'total', o ->> 'total'));
      else
        -- a concurrent copy created it a moment ago: apply this one as an update
        select * into r_ord from landing.petpooja_push_orders
         where rest_id = e.key_outlet and order_id = e.key_doc for update;
      end if;
    end if;

    if v_result is null then
      if r_ord.content_md5 = v_md5 then
        v_result := 'unchanged';
        update landing.petpooja_push_orders
           set push_count = push_count + 1, last_event_id = e.id, last_received_at = e.received_at
         where id = r_ord.id;
      elsif r_ord.status = 'Cancelled' and v_status <> 'Cancelled' then
        v_result := 'status_conflict';
        update landing.petpooja_push_orders
           set status_conflict = true, push_count = push_count + 1,
               last_event_id = e.id, last_received_at = e.received_at
         where id = r_ord.id;
        insert into public.spine_events (entity, entity_ref, action, actor, data)
        values ('petpooja_push_order', v_ref, 'status_conflict', 'petpooja-push',
                jsonb_build_object('event_id', e.id, 'kept', 'Cancelled', 'arrived', v_status));
      else
        v_result := 'updated';
        update landing.petpooja_push_orders set
          res_name = p #>> '{Restaurant,res_name}', customer_invoice_id = o ->> 'customer_invoice_id',
          order_type = o ->> 'order_type', sub_order_type = o ->> 'sub_order_type',
          order_from = o ->> 'order_from', order_from_id = nullif(o ->> 'order_from_id', ''),
          payment_type = o ->> 'payment_type', created_on = pp_ts(o ->> 'created_on'),
          business_date = business_day(pp_ts(o ->> 'created_on') at time zone 'Asia/Kolkata'),
          status = v_status,
          cancelled_at = coalesce(cancelled_at, case when v_status = 'Cancelled' then e.received_at end),
          core_total = pp_num(o ->> 'core_total'), discount_total = pp_num(o ->> 'discount_total'),
          tax_total = pp_num(o ->> 'tax_total'), delivery_charges = pp_num(o ->> 'delivery_charges'),
          packaging_charge = pp_num(o ->> 'packaging_charge'), service_charge = pp_num(o ->> 'service_charge'),
          round_off = pp_num(o ->> 'round_off'), total = pp_num(o ->> 'total'),
          biller = o ->> 'biller', assignee = nullif(o ->> 'assignee', ''),
          table_no = nullif(o ->> 'table_no', ''), token_no = nullif(o ->> 'token_no', ''),
          comment = nullif(o ->> 'comment', ''),
          items = p -> 'OrderItem', taxes = p -> 'Tax', discounts = p -> 'Discount',
          part_payments = o -> 'part_payments',
          item_count = case when jsonb_typeof(p -> 'OrderItem') = 'array' then jsonb_array_length(p -> 'OrderItem') end,
          customer_name = nullif(c ->> 'name', ''), customer_address = nullif(c ->> 'address', ''),
          customer_gstin = nullif(c ->> 'gstin', ''), customer_phone_raw = nullif(c ->> 'phone', ''),
          customer_phone = pp_clean_mobile(c ->> 'phone'),
          content_md5 = v_md5, push_count = push_count + 1,
          last_event_id = e.id, last_received_at = e.received_at
        where id = r_ord.id;
        insert into public.spine_events (entity, entity_ref, action, actor, data)
        values ('petpooja_push_order', v_ref,
                case when v_status = 'Cancelled' and r_ord.status <> 'Cancelled' then 'cancelled' else 'updated' end,
                'petpooja-push',
                jsonb_build_object('event_id', e.id, 'status_before', r_ord.status, 'status', v_status,
                                   'total_before', r_ord.total, 'total', o ->> 'total'));
      end if;
    end if;

  else  -- purchase_orders
    d := e.body_json -> 'data';
    v_md5 := md5(d::text);
    v_ref := e.key_outlet || '/' || e.key_doc;

    select * into r_po from landing.petpooja_push_purchase_orders
     where menu_sharing_code = e.key_outlet and po_id = e.key_doc for update;

    if not found then
      insert into landing.petpooja_push_purchase_orders (
        menu_sharing_code, po_id, po_number, delivery_date, receiver_type, status, total,
        total_tax, round_off, sender_name, sender_gst, receiver_name, receiver_gst,
        from_department, to_department, item_count, item_details, rest_details, charge_details,
        content_md5, first_event_id, last_event_id, first_received_at, last_received_at, is_test)
      values (
        e.key_outlet, e.key_doc, d ->> 'poNumber', pp_date(d ->> 'deliveryDate'), d ->> 'receiverType',
        d ->> 'status', pp_num(d ->> 'total'), pp_num(d ->> 'totalTax'), pp_num(d ->> 'roundOff'),
        d #>> '{restDetails,sender,sender_name}', nullif(d #>> '{restDetails,sender,sender_gst}', ''),
        d #>> '{restDetails,receiver,receiver_name}', nullif(d #>> '{restDetails,receiver,receiver_gst}', ''),
        nullif(d ->> 'from_department_name', ''), nullif(d ->> 'to_department_name', ''),
        case when jsonb_typeof(d -> 'itemDetails') = 'array' then jsonb_array_length(d -> 'itemDetails') end,
        d -> 'itemDetails', d -> 'restDetails', d -> 'chargeDetails',
        v_md5, e.id, e.id, e.received_at, e.received_at, e.is_test)
      on conflict (menu_sharing_code, po_id) do nothing;
      if found then
        v_result := 'created';
        insert into public.spine_events (entity, entity_ref, action, actor, data)
        values ('petpooja_push_po', v_ref, 'created', 'petpooja-push',
                jsonb_build_object('event_id', e.id, 'status', d ->> 'status', 'total', d ->> 'total'));
      else
        select * into r_po from landing.petpooja_push_purchase_orders
         where menu_sharing_code = e.key_outlet and po_id = e.key_doc for update;
      end if;
    end if;

    if v_result is null then
      if r_po.content_md5 = v_md5 then
        v_result := 'unchanged';
        update landing.petpooja_push_purchase_orders
           set push_count = push_count + 1, last_event_id = e.id, last_received_at = e.received_at
         where id = r_po.id;
      else
        v_result := 'updated';
        update landing.petpooja_push_purchase_orders set
          po_number = d ->> 'poNumber', delivery_date = pp_date(d ->> 'deliveryDate'),
          receiver_type = d ->> 'receiverType', status = d ->> 'status',
          total = pp_num(d ->> 'total'), total_tax = pp_num(d ->> 'totalTax'), round_off = pp_num(d ->> 'roundOff'),
          sender_name = d #>> '{restDetails,sender,sender_name}',
          sender_gst = nullif(d #>> '{restDetails,sender,sender_gst}', ''),
          receiver_name = d #>> '{restDetails,receiver,receiver_name}',
          receiver_gst = nullif(d #>> '{restDetails,receiver,receiver_gst}', ''),
          from_department = nullif(d ->> 'from_department_name', ''),
          to_department = nullif(d ->> 'to_department_name', ''),
          item_count = case when jsonb_typeof(d -> 'itemDetails') = 'array' then jsonb_array_length(d -> 'itemDetails') end,
          item_details = d -> 'itemDetails', rest_details = d -> 'restDetails', charge_details = d -> 'chargeDetails',
          content_md5 = v_md5, push_count = push_count + 1,
          last_event_id = e.id, last_received_at = e.received_at
        where id = r_po.id;
        insert into public.spine_events (entity, entity_ref, action, actor, data)
        values ('petpooja_push_po', v_ref, 'updated', 'petpooja-push',
                jsonb_build_object('event_id', e.id, 'status_before', r_po.status, 'status', d ->> 'status',
                                   'total_before', r_po.total, 'total', d ->> 'total'));
      end if;
    end if;
  end if;

  update landing.petpooja_push_events
     set applied_at = now(), apply_result = v_result, apply_error = null
   where id = e.id;
  return v_result;
end
$fn$;

-- ------------------------------------------------------------
-- The one call the routes make: save the delivery, then apply it. The save is
-- never undone by a failed apply (the apply runs in its own sub-transaction).
-- ------------------------------------------------------------
create or replace function public.petpooja_push_receive(
  p_feed text, p_source_ip text, p_user_agent text, p_content_type text,
  p_body_bytes integer, p_body_sha256 text, p_body_text text,
  p_verified boolean, p_verify_reason text)
returns jsonb language plpgsql security definer set search_path = landing, public as $fn$
declare
  v_json   jsonb;
  v_perr   text;
  v_outlet text;
  v_doc    text;
  v_status text;
  v_event  text;
  v_repeat bigint;
  v_id     bigint;
  v_result text;
  v_err    text;
begin
  begin
    v_json := p_body_text::jsonb;
  exception when others then
    v_perr := sqlerrm;
  end;

  if jsonb_typeof(v_json) = 'object' then
    if p_feed = 'orders' then
      v_outlet := v_json #>> '{properties,Restaurant,restID}';
      v_doc    := v_json #>> '{properties,Order,orderID}';
      v_status := v_json #>> '{properties,Order,status}';
      v_event  := v_json ->> 'event';
    else
      v_outlet := coalesce(nullif(v_json ->> 'menuSharingCode', ''), v_json #>> '{data,menuSharingCode}');
      v_doc    := v_json #>> '{data,id}';
      v_status := v_json #>> '{data,status}';
    end if;
  end if;

  select min(id) into v_repeat from landing.petpooja_push_events
   where feed = p_feed and body_sha256 = p_body_sha256;

  insert into landing.petpooja_push_events (
    feed, source_ip, user_agent, content_type, body_bytes, body_sha256, body_text,
    body_json, parse_error, verified, verify_reason, event_name, key_outlet, key_doc,
    doc_status, repeat_of)
  values (
    p_feed, p_source_ip, p_user_agent, p_content_type, p_body_bytes, p_body_sha256, p_body_text,
    v_json, v_perr, p_verified, p_verify_reason, v_event, nullif(v_outlet, ''), nullif(v_doc, ''),
    v_status, v_repeat)
  returning id into v_id;

  begin
    v_result := public.petpooja_push_apply(v_id);
  exception when others then
    v_err := sqlerrm;
    update landing.petpooja_push_events set apply_error = v_err where id = v_id;
  end;

  return jsonb_build_object('event_id', v_id, 'repeat_of', v_repeat,
                            'result', coalesce(v_result, 'apply failed'), 'error', v_err);
end
$fn$;

revoke all on function public.petpooja_push_apply(bigint) from public, anon, authenticated;
revoke all on function public.petpooja_push_receive(text, text, text, text, integer, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.petpooja_push_apply(bigint) to service_role;
grant execute on function public.petpooja_push_receive(text, text, text, text, integer, text, text, boolean, text)
  to service_role;
