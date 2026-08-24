// The report exports. Each report reads one public view (over the private landing
// tables) through the Supabase REST client, the SAME connection the portal already
// uses for login and dashboards. The CSV reproduces the raw Petpooja report
// verbatim: `columns` are the database column names (used to query and to pull each
// value), `headers` are the exact template header names written to the CSV, in the
// same order. Decision 24 Jul 2026: full columns, customer PII included.
import 'server-only';
import { spine } from '@/lib/supabase/service';

export interface ReportDef {
  key: string;         // url token
  label: string;       // shown in the picker
  group: string;       // hub section (Phase 3: cards grouped like the OMS reports hub)
  desc: string;        // one line under the card title
  view: string;        // public view name (migrations 041/050/160)
  columns: string[];   // db column names, in template order
  headers: string[];   // header names written to the CSV, 1:1 with columns
  filenameStem: string;
  dateless?: boolean;  // no business_date: exports the whole table
  orderBy?: string[];  // stable ordering; default ['business_date', 'id']
}

// Hub section order.
export const REPORT_GROUPS = [
  'Zomato, per store per day',
  'Zomato, per order',
  'Petpooja',
  'D2C (OMS)',
  'Masters',
] as const;

export const REPORTS: Record<string, ReportDef> = {
  order: {
    key: 'order',
    group: 'Petpooja',
    desc: 'The raw Petpooja online-orders report, all 27 columns.',
    label: 'Order report (Petpooja online orders)',
    view: 'v_report_online_orders',
    columns: [
      'order_date', 'invoice_date', 'aggregator_order_no', 'pos_invoice_no', 'order_from',
      'outlet_name', 'outlet_display_name', 'petpooja_identifier', 'order_type',
      'customer_name', 'customer_phone', 'payment_type', 'delivery_status', 'status',
      'my_amount', 'aggregator_discount', 'outlet_discount', 'delivery_charges',
      'container_charges', 'additional_charge', 'total', 'order_acceptance_time',
      'order_delivery_time', 'cancelled_by', 'reason', 'tip', 'complimentary',
    ],
    headers: [
      'Date', 'Invoice Date', 'Aggregator Order No.', 'PoS Invoice No.', 'Order From',
      'Outlet Name', 'Outlet Display Name', 'Petpooja Identifier', 'Order Type',
      'Customer Name', 'Customer Phone', 'Payment Type', 'Delivery Status', 'Status',
      'My amount', 'Aggregator Discount', 'Outlet Discount', 'Delivery Charges',
      'Container Charges', 'Additional Charge', 'Total', 'Order Acceptance Time',
      'Order Delivery Time', 'Cancelled By', 'Reason', 'Tip', 'Complimentary',
    ],
    filenameStem: 'cc_order_report',
  },
  item: {
    key: 'item',
    group: 'Petpooja',
    desc: 'The raw Petpooja item report, one row per item line, all 32 columns.',
    label: 'Item report (Petpooja order summary item)',
    view: 'v_report_order_summary_item',
    columns: [
      'restaurant_name', 'invoice_no', 'order_ts', 'payment_type', 'order_type', 'status',
      'area', 'virtual_brand_name', 'brand_grouping', 'assign_to', 'customer_phone',
      'customer_name', 'customer_address', 'persons', 'order_cancel_reason', 'my_amount',
      'total_tax', 'discount', 'delivery_charge', 'container_charge', 'service_charge',
      'additional_charge', 'deduction_charge', 'waived_off', 'round_off', 'total',
      'item_name', 'category_name', 'sap_code', 'item_price', 'item_quantity', 'item_total',
    ],
    headers: [
      'restaurant_name', 'invoice_no', 'date', 'payment_type', 'order_type', 'status',
      'area', 'virtual_brand_name', 'brand_grouping', 'assign_to', 'customer_phone',
      'customer_name', 'customer_address', 'persons', 'order_cancel_reason', 'my_amount',
      'total_tax', 'discount', 'delivery_charge', 'container_charge', 'service_charge',
      'additional_charge', 'deduction_charge', 'waived_off', 'round_off', 'total',
      'item_name', 'category_name', 'sap_code', 'item_price', 'item_quantity', 'item_total',
    ],
    filenameStem: 'cc_item_report',
  },
  sub_order: {
    key: 'sub_order',
    group: 'Petpooja',
    desc: 'Per-outlet, per-channel daily sales summary (calendar-day grain).',
    label: 'Sub-Order Wise (sales summary by outlet + channel)',
    view: 'v_report_sub_order_wise',
    columns: [
      'restaurants', 'order_type', 'sub_order_type', 'total_no_of_bills', 'my_amount',
      'total_discount', 'net_sales', 'delivery_charge', 'container_charge', 'service_charge',
      'additional_charge', 'total_tax', 'round_off', 'waived_off', 'total_sales',
      'online_tax_calculated', 'gst_paid_by_merchant', 'gst_paid_by_ecommerce',
    ],
    headers: [
      'Restaurants', 'Order Type', 'Sub Order Type', 'Total no. of bills', 'My Amount',
      'Total Discount', 'Net Sales(M.A - T.D)', 'Delivery Charge', 'Container Charge',
      'Service Charge', 'Additional Charge', 'Total Tax', 'Round Off', 'Waived off',
      'Total Sales', 'Online Tax Calculated', 'GST Paid by Merchant', 'GST Paid by Ecommerce',
    ],
    filenameStem: 'cc_sub_order_wise',
  },
  invoice_wise: {
    key: 'invoice_wise',
    group: 'Petpooja',
    desc: 'B2B / GST invoice lines from Petpooja.',
    label: 'Invoice Wise Sales (B2B / GST invoice lines)',
    view: 'v_report_invoice_wise_sales',
    columns: [
      's_no', 'location', 'inv_date', 'seller_invoice_no', 'invoice_no', 'challan_no',
      'from_location', 'pickup_gstin', 'pickup_pincode', 'deliver_gstin', 'buyer_billing_name',
      'buyer_billing_state', 'buyer_billing_address', 'buyer_billing_gstin',
      'buyer_billing_pincode', 'buyer_name', 'buyer_gstin', 'item_name', 'hsn_code', 'sku_code',
      'brand', 'mrp', 'category', 'price', 'so_qty', 'gr_qty', 'uom', 'discount_pct',
      'discount_amt', 'subtotal', 'tax', 'cess', 'tax_amt', 'cess_amt', 'sgst_tax',
      'sgst_tax_amount', 'cgst_tax', 'cgst_tax_amount', 'igst_tax', 'igst_tax_amount',
      'additional_charges', 'delivery_charges', 'total',
    ],
    headers: [
      'S.No.', 'Location', 'Date', 'Seller_Invoice_No', 'Invoice No', 'Challan No',
      'From Location', 'Pickup Address GSTIN', 'Pickup Address PinCode', 'Deliver Address GSTIN',
      'Buyer Billing Name', 'Buyer Billing State', 'Buyer Billing Address', 'Buyer Billing GSTIN',
      'Buyer Billing PinCode', 'Buyer Name', 'Buyer GSTIN', 'Item Name', 'HSN Code', 'Sku Code',
      'Brand', 'MRP', 'Category', 'Price', 'So Qty', 'GR Qty', 'UOM', 'Discount %',
      'Discount Amt', 'Subtotal', 'Tax', 'Cess', 'Tax Amt', 'Cess Amt', 'SGST Tax',
      'SGST Tax Amount', 'CGST Tax', 'CGST Tax Amount', 'IGST Tax', 'IGST Tax Amount',
      'Additional Charges', 'Delivery Charges', 'Total',
    ],
    filenameStem: 'cc_invoice_wise_sales',
  },
  daily_stock: {
    key: 'daily_stock',
    group: 'Petpooja',
    desc: 'Per-item stock ledger by location (raw history; stock accuracy is known-poor).',
    label: 'Daily Report (per-item stock ledger by location)',
    view: 'v_report_daily_stock',
    columns: [
      'report_location', 'raw_material', 'category', 'sub_category', 'hsn_code', 'sap_code',
      'unit', 'opening_a', 'purchase_sales_return_b', 'excess_c', 'total_stock', 'consumed_d',
      'wastage_e', 'normal_loss_f', 'sales_transfer_purchase_g', 'shortage_h', 'production_i',
      'total_consumed', 'closing_stock', 'closing_summary', 'difference', 'reconciliation_price',
      'reconciliation_amount',
    ],
    headers: [
      'Restaurant', 'Raw Material', 'Category', 'Sub Category', 'HSN Code', 'Sap Code', 'Unit',
      'Opening (A)', 'Purchase / Sales Return (B)', 'Excess (C)', 'Total Stock (A+B+C)',
      'Consumed (D)', 'Wastage (E)', 'Normal Loss (F)', 'Sales / Transfer / Purchase (G)',
      'Shortage (H)', 'Production (I)', 'Total Consumed (D+E+F+G+H)', 'Closing Stock',
      'Closing Summary (A+B-D-E-F-G-H)', 'Difference', 'Reconciliation Price',
      'Reconciliation Amount',
    ],
    filenameStem: 'cc_daily_stock',
  },
  zomato_quality: {
    key: 'zomato_quality',
    label: 'Zomato service quality, per store per day',
    group: 'Zomato, per store per day',
    desc: 'Ratings, complaints with reasons, rejections with reasons, online time, ready accuracy, handover. From Jan 2025.',
    view: 'v_rpt_zomato_quality',
    columns: ['business_date','store','locality','city','area_manager','restaurant_id','average_food_order_rating','poor_rated_orders_pct','rejected_orders_pct','total_rejected_orders','item_out_of_stock','kitchen_is_full','outlet_closed','timeout','device_issues','others_rejected_orders','complaints_pct','total_complaints','wrong_item_s_delivered','item_s_missing_or_not_delivered','poor_packaging_or_spillage','poor_taste_or_quality','kpt_delay','others_complaints','refunded_complaints','pct_restaurant_refunded_amount','customer_cancellation_pct','online_time_pct','offline_time','food_order_ready_accuracy_pct','for_marked_ratio','orders_with_3_plus_mins_handover_time_pct'],
    headers: ['business_date','store','locality','city','area_manager','restaurant_id','average_food_order_rating','poor_rated_orders_pct','rejected_orders_pct','total_rejected_orders','item_out_of_stock','kitchen_is_full','outlet_closed','timeout','device_issues','others_rejected_orders','complaints_pct','total_complaints','wrong_item_s_delivered','item_s_missing_or_not_delivered','poor_packaging_or_spillage','poor_taste_or_quality','kpt_delay','others_complaints','refunded_complaints','pct_restaurant_refunded_amount','customer_cancellation_pct','online_time_pct','offline_time','food_order_ready_accuracy_pct','for_marked_ratio','orders_with_3_plus_mins_handover_time_pct'],
    filenameStem: 'zomato_quality',
    orderBy: ['business_date', 'store'],
  },
  zomato_segments: {
    key: 'zomato_segments',
    label: 'Zomato sales by customer type and mealtime',
    group: 'Zomato, per store per day',
    desc: 'The segment cube: store x day x new/repeat/lapsed x offer sensitivity x mealtime. Sales, funnel, offers. From Jan 2025.',
    view: 'v_rpt_zomato_segments',
    columns: ['business_date','store','area_manager','restaurant_id','nrl_segment','offer_sensitivity','mealtime','subtotal_value','net_sales','orders_received','delivered_orders','average_subtotal_value_asv','average_order_value_aov','items_per_order','packaging_charges','gross_sales_from_offers','impressions','menu_opens','cart_builds','orders_placed','impression_to_menu_i2m_pct','menu_to_order_m2o_pct','menu_to_cart_m2c_pct','cart_to_order_c2o_pct','orders_with_offers','pct_orders_with_offers','effective_discount_pct','discount_given_per_order','promo_discount','dish_discounts','bogo_discount','freebie','gold_discount','orders_from_dotd','total_dotd_discount','orders_from_flash_sale','total_flash_sale_discount','mx_refund_amount'],
    headers: ['business_date','store','area_manager','restaurant_id','nrl_segment','offer_sensitivity','mealtime','subtotal_value','net_sales','orders_received','delivered_orders','average_subtotal_value_asv','average_order_value_aov','items_per_order','packaging_charges','gross_sales_from_offers','impressions','menu_opens','cart_builds','orders_placed','impression_to_menu_i2m_pct','menu_to_order_m2o_pct','menu_to_cart_m2c_pct','cart_to_order_c2o_pct','orders_with_offers','pct_orders_with_offers','effective_discount_pct','discount_given_per_order','promo_discount','dish_discounts','bogo_discount','freebie','gold_discount','orders_from_dotd','total_dotd_discount','orders_from_flash_sale','total_flash_sale_discount','mx_refund_amount'],
    filenameStem: 'zomato_segments',
    orderBy: ['business_date', 'store', 'mealtime'],
  },
  zomato_ads: {
    key: 'zomato_ads',
    label: 'Zomato ads by customer segment',
    group: 'Zomato, per store per day',
    desc: 'Ad spend, attributed sales and funnel, split by spending potential and by new/repeat/lapsed. Restates for days.',
    view: 'v_rpt_zomato_ads_segment',
    columns: ['business_date','store','area_manager','restaurant_id','segment_type','segment_value','ad_impressions','ad_click_through_rate_pct','ad_menu_opens','ad_menu_to_order_pct','ad_menu_to_cart_pct','ad_cart_to_order_pct','ad_spends_per_order','net_sales_from_ads','pct_net_sales_from_ads','orders_from_ads','pct_orders_from_ads','ad_spends','ad_roi','ad_spends_as_a_percentage_of_cv'],
    headers: ['business_date','store','area_manager','restaurant_id','segment_type','segment_value','ad_impressions','ad_click_through_rate_pct','ad_menu_opens','ad_menu_to_order_pct','ad_menu_to_cart_pct','ad_cart_to_order_pct','ad_spends_per_order','net_sales_from_ads','pct_net_sales_from_ads','orders_from_ads','pct_orders_from_ads','ad_spends','ad_roi','ad_spends_as_a_percentage_of_cv'],
    filenameStem: 'zomato_ads_segment',
    orderBy: ['business_date', 'store'],
  },
  zomato_campaigns: {
    key: 'zomato_campaigns',
    label: 'Zomato ad campaigns',
    group: 'Zomato, per store per day',
    desc: 'Campaign-level table (type, targeting, budget, ROI). Empty until the Track-ads loader goes live.',
    view: 'v_rpt_zomato_campaigns',
    columns: ['business_date','store','restaurant_id','campaign_id','campaign_type','status','source','source_id','targeting','start_date','end_date','cpx','budget','roi','sales','spends','impressions','i2m','menu_opens','m2o','orders'],
    headers: ['business_date','store','restaurant_id','campaign_id','campaign_type','status','source','source_id','targeting','start_date','end_date','cpx','budget','roi','sales','spends','impressions','i2m','menu_opens','m2o','orders'],
    filenameStem: 'zomato_campaigns',
    orderBy: ['business_date', 'campaign_id'],
  },
  zomato_orders: {
    key: 'zomato_orders',
    label: 'Zomato orders (one row per order)',
    group: 'Zomato, per order',
    desc: 'Full order timeline, rejection reason, rating, complaint, fees, discounts, customer history. From Aug 2026.',
    view: 'v_rpt_zomato_orders',
    columns: ['business_date','store','area_manager','zomato_order_id','restaurant_id','subzone','city','placed_at_ist','mealtime','delivery_mode','order_state','line_count','placed_at','accepted_at','dp_assigned_at','food_ready_market_at','rider_reached_outlet_at','rider_arrived_at','picked_up_at','delivered_at','rejected_at','rejection_reason','order_rating','review','complaint_on_order','complaint_reason','refund_amount_agreed','customer_name','customer_order_count','customer_last_order_date','customer_locality','distance','order_subtotal','packaging_cost','net_order_value','res_discount_promo','promo_code','res_discount_item_level','service_fee','pg_fee','ads_campaign_order','campaign_id'],
    headers: ['business_date','store','area_manager','zomato_order_id','restaurant_id','subzone','city','placed_at_ist','mealtime','delivery_mode','order_state','line_count','placed_at','accepted_at','dp_assigned_at','food_ready_market_at','rider_reached_outlet_at','rider_arrived_at','picked_up_at','delivered_at','rejected_at','rejection_reason','order_rating','review','complaint_on_order','complaint_reason','refund_amount_agreed','customer_name','customer_order_count','customer_last_order_date','customer_locality','distance','order_subtotal','packaging_cost','net_order_value','res_discount_promo','promo_code','res_discount_item_level','service_fee','pg_fee','ads_campaign_order','campaign_id'],
    filenameStem: 'zomato_orders',
    orderBy: ['business_date', 'zomato_order_id'],
  },
  zomato_order_items: {
    key: 'zomato_order_items',
    label: 'Zomato order items (one row per item line)',
    group: 'Zomato, per order',
    desc: 'Every item in every Zomato order, with the Petpooja item id. From Aug 2026.',
    view: 'v_rpt_zomato_order_items',
    columns: ['business_date','store','zomato_order_id','restaurant_id','line_no','catalogue_id','pos_item_id','item_name','item_category','item_sub_category','item_quantity','item_unit_cost'],
    headers: ['business_date','store','zomato_order_id','restaurant_id','line_no','catalogue_id','pos_item_id','item_name','item_category','item_sub_category','item_quantity','item_unit_cost'],
    filenameStem: 'zomato_order_items',
    orderBy: ['business_date', 'zomato_order_id', 'line_no'],
  },
  oms_orders: {
    key: 'oms_orders',
    label: 'D2C orders (OMS)',
    group: 'D2C (OMS)',
    desc: 'Website and OMS orders: status, delivery slot, amounts, attribution.',
    view: 'v_rpt_oms_orders',
    columns: ['business_date','oms_order_id','source','shopify_name','outlet_code','status','placed_at','delivery_date','slot_text','area','city','pincode','customer_name','customer_mobile','item_count','total_amount','advance_amount','is_prepaid','discount_amount','refunded_amount','cancel_reason','attribution','is_complimentary','b2b_doc_type'],
    headers: ['business_date','oms_order_id','source','shopify_name','outlet_code','status','placed_at','delivery_date','slot_text','area','city','pincode','customer_name','customer_mobile','item_count','total_amount','advance_amount','is_prepaid','discount_amount','refunded_amount','cancel_reason','attribution','is_complimentary','b2b_doc_type'],
    filenameStem: 'oms_orders',
    orderBy: ['business_date', 'oms_order_id'],
  },
  oms_order_items: {
    key: 'oms_order_items',
    label: 'D2C order items (OMS)',
    group: 'D2C (OMS)',
    desc: 'Item lines of every D2C order: product, flavour, weight, price, cake message.',
    view: 'v_rpt_oms_order_items',
    columns: ['business_date','oms_order_id','oms_item_id','sku','product_title','variant_title','flavour','weight_kg','egg_option','quantity','unit_price','line_total','cake_message','item_delivery_date','item_slot_text','item_area','item_pincode'],
    headers: ['business_date','oms_order_id','oms_item_id','sku','product_title','variant_title','flavour','weight_kg','egg_option','quantity','unit_price','line_total','cake_message','item_delivery_date','item_slot_text','item_area','item_pincode'],
    filenameStem: 'oms_order_items',
    orderBy: ['business_date', 'oms_order_id', 'oms_item_id'],
  },
  oms_customers: {
    key: 'oms_customers',
    label: 'D2C customers (OMS)',
    group: 'D2C (OMS)',
    desc: 'The customer list with order counts and first-touch attribution. Whole table, no date range.',
    view: 'v_rpt_oms_customers',
    columns: ['oms_customer_id','name','primary_mobile','email','first_source','created_at_oms','order_count','last_order_at','first_touch_channel','first_touch_source','first_touch_medium','first_touch_campaign'],
    headers: ['oms_customer_id','name','primary_mobile','email','first_source','created_at_oms','order_count','last_order_at','first_touch_channel','first_touch_source','first_touch_medium','first_touch_campaign'],
    filenameStem: 'oms_customers',
    dateless: true,
    orderBy: ['oms_customer_id'],
  },
  outlets: {
    key: 'outlets',
    label: 'Outlet master',
    group: 'Masters',
    desc: 'The canonical outlet list: internal code, Zomato id, locality, area manager, store email.',
    view: 'v_rpt_outlets',
    columns: ['internal_code','zomato_restaurant_id','locality','city','area_manager','store_email','active','created_at'],
    headers: ['internal_code','zomato_restaurant_id','locality','city','area_manager','store_email','active','created_at'],
    filenameStem: 'outlets',
    dateless: true,
    orderBy: ['internal_code'],
  },
};


// A generous but bounded window for a single download. The 2-year bulk history is a
// separate importer/exporter task, not this on-demand button.
export const MAX_RANGE_DAYS = 92;
const PAGE = 1000; // REST page size; we loop until a short page.

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from + 'T00:00:00Z');
  const b = Date.parse(to + 'T00:00:00Z');
  return Math.round((b - a) / 86_400_000);
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (v instanceof Date) s = v.toISOString().slice(0, 10);
  else s = String(v);
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Fetch the report for [from, to] (inclusive, by business_date). Pages through the
// REST API and THROWS on any error, so the caller returns a clean message instead
// of a half-written file. Rows come back ordered (business_date, id) so the file is
// stable and re-downloadable identically.
export async function fetchReportRows(def: ReportDef, from: string, to: string): Promise<unknown[][]> {
  const client = spine();
  const rows: unknown[][] = [];
  const orderCols = def.orderBy ?? ['business_date', 'id'];
  let offset = 0;
  for (;;) {
    let q = client.from(def.view).select(def.columns.join(','));
    if (!def.dateless) q = q.gte('business_date', from).lte('business_date', to);
    for (const c of orderCols) q = q.order(c, { ascending: true });
    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as Record<string, unknown>[];
    if (batch.length === 0) break;
    for (const obj of batch) rows.push(def.columns.map((c) => obj[c]));
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

// Turn already-fetched rows into a CSV stream, with the raw report header names.
// No I/O happens here, so this stream cannot fail midway.
export function rowsToCsvStream(def: ReportDef, rows: unknown[][]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const header = def.headers.map(csvCell).join(',') + '\n';
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(header));
      for (const row of rows) {
        controller.enqueue(encoder.encode(row.map(csvCell).join(',') + '\n'));
      }
      controller.close();
    },
  });
}
