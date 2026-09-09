-- ============================================================
-- Migration 224: the three Petpooja witness logs as downloadable reports
-- (9 September 2026, Pranjay: "Is it downloadable in ERP?")
-- Same pattern as 160: one public view per report over the private landing
-- table, current rows only, store code joined from the outlet map, readable
-- by service_role only (the portal's own connection). Additive only.
-- ============================================================
create or replace view public.v_rpt_petpooja_store_status as
select l.business_date, l.petpooja_rest_id, m.internal_code as store, l.client_hash,
       l.logged_at, l.app, l.event_kind, l.request_type, l.current_status, l.http_status,
       l.user_details, l.request_json, l.response_json, l.loaded_at, l.id
from landing.petpooja_store_status_log l
left join landing.petpooja_outlet_map m on m.petpooja_rest_id = l.petpooja_rest_id
where l.superseded_at is null;

create or replace view public.v_rpt_petpooja_item_toggle as
select l.business_date, l.petpooja_rest_id, coalesce(m.internal_code, l.outlet_name) as store,
       l.app, l.logged_at, l.action, l.object_type, l.trigger, l.actor_name, l.actor,
       l.window_from, l.window_to, l.item_ids, l.item_names, l.reason, l.stock_item,
       l.stock_realtime, l.stock_par, l.http_status, l.loaded_at, l.id
from landing.petpooja_item_toggle_log l
left join landing.petpooja_outlet_map m on m.petpooja_rest_id = l.petpooja_rest_id
where l.superseded_at is null;

create or replace view public.v_rpt_petpooja_order_activity as
select a.business_date, a.petpooja_rest_id, m.internal_code as store, a.client_hash,
       a.order_id, a.app_guess, a.order_status, a.received_at, a.accepted_at, a.mark_ready_at,
       a.rider_arrival_at, a.picked_up_at, a.delivered_at, a.cancelled_at, a.returned_at,
       round(extract(epoch from (a.mark_ready_at - a.accepted_at))/60.0, 2) as accept_to_ready_min,
       round(extract(epoch from (a.picked_up_at - a.rider_arrival_at))/60.0, 2) as rider_wait_min,
       round(extract(epoch from (a.delivered_at - a.received_at))/60.0, 2) as received_to_delivered_min,
       a.loaded_at, a.id
from landing.petpooja_order_activity a
left join landing.petpooja_outlet_map m on m.petpooja_rest_id = a.petpooja_rest_id
where a.superseded_at is null;

do $$ declare v text; begin
  foreach v in array array['v_rpt_petpooja_store_status','v_rpt_petpooja_item_toggle','v_rpt_petpooja_order_activity'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', v);
    execute format('grant select on public.%I to service_role', v);
  end loop;
end $$;
