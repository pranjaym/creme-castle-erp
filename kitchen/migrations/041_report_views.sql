-- ============================================================
-- Migration 041: PORTAL REPORT VIEWS
-- Target: the spine Supabase project. Additive and safe on a live DB.
--
-- The ERP portal downloads the order and item reports. The raw data is in the
-- private `landing` schema, which is NOT exposed to the Supabase REST API. These
-- two public views expose ONLY the non-PII report columns, so the portal can read
-- them over the same REST endpoint it already uses for login and dashboards (no
-- direct database connection needed).
--
-- Security: a normal (non security_invoker) view reads its underlying tables with
-- the VIEW OWNER's rights, so the private landing tables stay private. The views
-- are granted to service_role ONLY; anon and authenticated are revoked, so the
-- public anon key can never read them.
-- ============================================================

create or replace view public.v_report_online_orders as
  select id, business_date, order_ts, aggregator_order_no, pos_invoice_no,
         order_from, outlet_name, order_type, status, my_amount, total
  from landing.petpooja_online_orders;

-- customer_name and customer_phone are deliberately NOT selected: never export PII.
create or replace view public.v_report_order_summary_item as
  select id, business_date, restaurant_name, invoice_no, order_ts, payment_type,
         order_type, status, area, virtual_brand_name, my_amount, total_tax,
         discount, delivery_charge, container_charge, total, item_name,
         category_name, sap_code, item_price, item_quantity, item_total
  from landing.petpooja_order_summary_item;

-- Lock down: only the service role (used server-side by the portal) may read.
revoke all on public.v_report_online_orders from anon, authenticated;
revoke all on public.v_report_order_summary_item from anon, authenticated;
grant select on public.v_report_online_orders to service_role;
grant select on public.v_report_order_summary_item to service_role;

-- Make PostgREST pick up the new views immediately.
notify pgrst, 'reload schema';
