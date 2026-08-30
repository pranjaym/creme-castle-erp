-- 214: the indexes the merged pages need. Every Swiggy-to-Petpooja match
-- runs through core.orders.aggregator_order_no, and the outlet-code bridge
-- picks the latest order per location; neither had an index, so the 213
-- functions ran into PostgREST's statement timeout on first render.
create index if not exists idx_core_orders_aggno
  on core.orders (aggregator_order_no) where superseded_at is null;
create index if not exists idx_core_orders_loc_latest
  on core.orders (location_id, id desc);
