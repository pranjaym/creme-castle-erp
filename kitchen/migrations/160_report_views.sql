-- ============================================================
-- Creme Castle Spine, Migration 160: REPORT VIEWS (portal Phase 3 reports hub)
-- Target: the spine Supabase project. Additive; read-only views.
--
-- One public view per exportable dataset, service_role only (the portal's
-- server side reads them through PostgREST, same as the Petpooja report views
-- from migrations 041/050). Conventions:
--   - lineage columns (id, ingest_run_id, row_hash, superseded_*) are dropped
--   - superseded rows are filtered out
--   - business_date is a real date column, named business_date, on every
--     dated view (the portal's report fetcher filters on it)
--   - Zomato views carry the internal outlet code via public.outlets
--   - the segment view applies the F25 filter so exports never double-count
-- ============================================================

create or replace view public.v_rpt_zomato_quality as
select q.business_date::date as business_date, o.internal_code as store,
       o.locality, o.city, o.area_manager,
       q.restaurant_id, q.average_food_order_rating, q.poor_rated_orders_pct,
       q.rejected_orders_pct, q.total_rejected_orders, q.item_out_of_stock,
       q.kitchen_is_full, q.outlet_closed, q.timeout, q.device_issues,
       q.others_rejected_orders, q.complaints_pct, q.total_complaints,
       q.wrong_item_s_delivered, q.item_s_missing_or_not_delivered,
       q.poor_packaging_or_spillage, q.poor_taste_or_quality, q.kpt_delay,
       q.others_complaints, q.refunded_complaints,
       q.pct_restaurant_refunded_amount, q.customer_cancellation_pct,
       q.online_time_pct, q.offline_time,
       q.food_order_ready_accuracy_pct, q.for_marked_ratio,
       q.orders_with_3_plus_mins_handover_time_pct
from landing.zomato_outlet_day_quality q
left join public.outlets o on o.zomato_restaurant_id = q.restaurant_id
where q.superseded_by is null;

create or replace view public.v_rpt_zomato_segments as
select s.business_date::date as business_date, o.internal_code as store,
       o.area_manager, s.restaurant_id, s.nrl_segment, s.offer_sensitivity, s.mealtime,
       s.subtotal_value, s.net_sales, s.orders_received, s.delivered_orders,
       s.average_subtotal_value_asv, s.average_order_value_aov, s.items_per_order,
       s.packaging_charges, s.gross_sales_from_offers, s.impressions, s.menu_opens,
       s.cart_builds, s.orders_placed, s.impression_to_menu_i2m_pct,
       s.menu_to_order_m2o_pct, s.menu_to_cart_m2c_pct, s.cart_to_order_c2o_pct,
       s.orders_with_offers, s.pct_orders_with_offers, s.effective_discount_pct,
       s.discount_given_per_order, s.promo_discount, s.dish_discounts,
       s.bogo_discount, s.freebie, s.gold_discount,
       s.orders_from_dotd, s.total_dotd_discount, s.orders_from_flash_sale,
       s.total_flash_sale_discount, s.mx_refund_amount
from landing.zomato_outlet_day_segment s
left join public.outlets o on o.zomato_restaurant_id = s.restaurant_id
where s.superseded_by is null
  and s.nrl_segment <> 'all' and s.offer_sensitivity <> 'all' and s.mealtime <> 'all';

create or replace view public.v_rpt_zomato_ads_segment as
select a.business_date::date as business_date, o.internal_code as store,
       o.area_manager, a.restaurant_id, a.segment_type, a.segment_value,
       a.ad_impressions, a.ad_click_through_rate_pct, a.ad_menu_opens,
       a.ad_menu_to_order_pct, a.ad_menu_to_cart_pct, a.ad_cart_to_order_pct,
       a.ad_spends_per_order, a.net_sales_from_ads, a.pct_net_sales_from_ads,
       a.orders_from_ads, a.pct_orders_from_ads, a.ad_spends, a.ad_roi,
       a.ad_spends_as_a_percentage_of_cv
from landing.zomato_outlet_day_ads_segment a
left join public.outlets o on o.zomato_restaurant_id = a.restaurant_id
where a.superseded_by is null;

create or replace view public.v_rpt_zomato_campaigns as
select c.business_date::date as business_date, o.internal_code as store,
       c.restaurant_id, c.campaign_id, c.campaign_type, c.status, c.source,
       c.source_id, c.targeting, c.start_date, c.end_date, c.cpx, c.budget,
       c.roi, c.sales, c.spends, c.impressions, c.i2m, c.menu_opens, c.m2o, c.orders
from landing.zomato_ad_campaign_day c
left join public.outlets o on o.zomato_restaurant_id = c.restaurant_id
where c.superseded_by is null;

create or replace view public.v_rpt_zomato_orders as
select b.business_date::date as business_date, o.internal_code as store,
       o.area_manager, b.zomato_order_id, b.restaurant_id, b.subzone, b.city,
       b.placed_at_ist, b.mealtime, b.delivery_mode, b.order_state, b.line_count,
       b.placed_at, b.accepted_at, b.dp_assigned_at, b.food_ready_market_at,
       b.rider_reached_outlet_at, b.rider_arrived_at, b.picked_up_at, b.delivered_at,
       b.rejected_at, b.rejection_reason, b.order_rating, b.review,
       b.complaint_on_order, b.complaint_reason, b.refund_amount_agreed,
       b.customer_name, b.customer_order_count, b.customer_last_order_date,
       b.customer_locality, b.distance, b.order_subtotal, b.packaging_cost,
       b.net_order_value, b.res_discount_promo, b.promo_code,
       b.res_discount_item_level, b.service_fee, b.pg_fee,
       b.ads_campaign_order, b.campaign_id
from landing.zomato_business_order b
left join public.outlets o on o.zomato_restaurant_id = b.restaurant_id
where b.superseded_by is null;

create or replace view public.v_rpt_zomato_order_items as
select i.business_date::date as business_date, o.internal_code as store,
       i.zomato_order_id, i.restaurant_id, i.line_no, i.catalogue_id,
       i.pos_item_id, i.item_name, i.item_category, i.item_sub_category,
       i.item_quantity, i.item_unit_cost
from landing.zomato_business_order_item i
left join public.outlets o on o.zomato_restaurant_id = i.restaurant_id
where i.superseded_by is null;

create or replace view public.v_rpt_oms_orders as
select h.business_date::date as business_date, h.oms_order_id, h.source,
       h.shopify_name, h.outlet_code, h.status, h.placed_at, h.delivery_date,
       h.slot_text, h.area, h.city, h.pincode, h.customer_name, h.customer_mobile,
       h.item_count, h.total_amount, h.advance_amount, h.is_prepaid,
       h.discount_amount, h.refunded_amount, h.cancel_reason, h.attribution,
       h.is_complimentary, h.b2b_doc_type
from landing.oms_order_header h
where h.superseded_by is null;

create or replace view public.v_rpt_oms_order_items as
select h.business_date::date as business_date, i.oms_order_id, i.oms_item_id,
       i.sku, i.product_title, i.variant_title, i.flavour, i.weight_kg,
       i.egg_option, i.quantity, i.unit_price, i.line_total, i.cake_message,
       i.item_delivery_date, i.item_slot_text, i.item_area, i.item_pincode
from landing.oms_order_item i
join landing.oms_order_header h on h.oms_order_id = i.oms_order_id and h.superseded_by is null
where i.superseded_by is null;

create or replace view public.v_rpt_oms_customers as
select c.oms_customer_id, c.name, c.primary_mobile, c.email, c.first_source,
       c.created_at_oms, c.order_count, c.last_order_at, c.first_touch_channel,
       c.first_touch_source, c.first_touch_medium, c.first_touch_campaign
from landing.oms_customer c
where c.superseded_by is null;

create or replace view public.v_rpt_outlets as
select internal_code, zomato_restaurant_id, locality, city, area_manager,
       store_email, active, created_at
from public.outlets;

do $do$
declare v text;
begin
  foreach v in array array['v_rpt_zomato_quality','v_rpt_zomato_segments',
    'v_rpt_zomato_ads_segment','v_rpt_zomato_campaigns','v_rpt_zomato_orders',
    'v_rpt_zomato_order_items','v_rpt_oms_orders','v_rpt_oms_order_items',
    'v_rpt_oms_customers','v_rpt_outlets']
  loop
    execute format('revoke all on public.%I from public, anon, authenticated', v);
    execute format('grant select on public.%I to service_role', v);
  end loop;
end $do$;
