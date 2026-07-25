-- ============================================================
-- Migration 051: ADDITIONAL PETPOOJA REPORT LANDING TABLES
-- Target: the spine Supabase project. Additive; only CREATE, no drops.
--
-- Three more Petpooja reports landed verbatim into the spine (25 Jul 2026), so it
-- holds them as the single source of truth and the portal can download them:
--   1. Sub-Order Wise      -> landing.petpooja_sub_order_wise   (sales summary by
--                             outlet + channel; business day from the report range)
--   2. Invoice Wise Sales  -> landing.petpooja_invoice_wise_sales (B2B/GST invoice
--                             lines; business day from each row's Date)
--   3. Daily Report        -> landing.petpooja_daily_stock       (per-item stock
--                             ledger: opening/consumed/wastage/closing, per location
--                             per day; business day + location from the title block)
--
-- All columns kept as text (raw fidelity). Idempotent load via (business_date,
-- row_hash). Report views expose everything to the portal (service_role only).
-- ============================================================

-- ---------- 1. SUB-ORDER WISE (18 columns) ----------
create table if not exists landing.petpooja_sub_order_wise (
  id                    bigint generated always as identity primary key,
  ingest_run_id         bigint references landing.ingest_runs(id),
  business_date         date not null,
  restaurants           text,
  order_type            text,
  sub_order_type        text,
  total_no_of_bills     text,
  my_amount             text,
  total_discount        text,
  net_sales             text,
  delivery_charge       text,
  container_charge      text,
  service_charge        text,
  additional_charge     text,
  total_tax             text,
  round_off             text,
  waived_off            text,
  total_sales           text,
  online_tax_calculated text,
  gst_paid_by_merchant  text,
  gst_paid_by_ecommerce text,
  row_hash              text not null,
  loaded_at             timestamptz not null default now()
);
create unique index if not exists uq_pp_suborder_hash
  on landing.petpooja_sub_order_wise (business_date, row_hash);

-- ---------- 2. INVOICE WISE SALES (43 columns) ----------
create table if not exists landing.petpooja_invoice_wise_sales (
  id                     bigint generated always as identity primary key,
  ingest_run_id          bigint references landing.ingest_runs(id),
  business_date          date not null,
  s_no                   text,
  location               text,
  inv_date               text,
  seller_invoice_no      text,
  invoice_no             text,
  challan_no             text,
  from_location          text,
  pickup_gstin           text,
  pickup_pincode         text,
  deliver_gstin          text,
  buyer_billing_name     text,
  buyer_billing_state    text,
  buyer_billing_address  text,
  buyer_billing_gstin    text,
  buyer_billing_pincode  text,
  buyer_name             text,
  buyer_gstin            text,
  item_name              text,
  hsn_code               text,
  sku_code               text,
  brand                  text,
  mrp                    text,
  category               text,
  price                  text,
  so_qty                 text,
  gr_qty                 text,
  uom                    text,
  discount_pct           text,
  discount_amt           text,
  subtotal               text,
  tax                    text,
  cess                   text,
  tax_amt                text,
  cess_amt               text,
  sgst_tax               text,
  sgst_tax_amount        text,
  cgst_tax               text,
  cgst_tax_amount        text,
  igst_tax               text,
  igst_tax_amount        text,
  additional_charges     text,
  delivery_charges       text,
  total                  text,
  row_hash               text not null,
  loaded_at              timestamptz not null default now()
);
create unique index if not exists uq_pp_invoicewise_hash
  on landing.petpooja_invoice_wise_sales (business_date, row_hash);
create index if not exists idx_pp_invoicewise_loc
  on landing.petpooja_invoice_wise_sales (location, business_date);

-- ---------- 3. DAILY REPORT / STOCK LEDGER (location + 22 columns) ----------
create table if not exists landing.petpooja_daily_stock (
  id                        bigint generated always as identity primary key,
  ingest_run_id             bigint references landing.ingest_runs(id),
  business_date             date not null,
  report_location           text,     -- from the title block (Restaurant Name)
  raw_material              text,
  category                  text,
  sub_category              text,
  hsn_code                  text,
  sap_code                  text,
  unit                      text,
  opening_a                 text,
  purchase_sales_return_b   text,
  excess_c                  text,
  total_stock               text,
  consumed_d                text,
  wastage_e                 text,
  normal_loss_f             text,
  sales_transfer_purchase_g text,
  shortage_h                text,
  production_i              text,
  total_consumed            text,
  closing_stock             text,
  closing_summary           text,
  difference                text,
  reconciliation_price      text,
  reconciliation_amount     text,
  row_hash                  text not null,
  loaded_at                 timestamptz not null default now()
);
create unique index if not exists uq_pp_dailystock_hash
  on landing.petpooja_daily_stock (business_date, row_hash);
create index if not exists idx_pp_dailystock_loc
  on landing.petpooja_daily_stock (report_location, business_date);

-- ---------- PORTAL REPORT VIEWS (service_role only) ----------
create or replace view public.v_report_sub_order_wise as
  select id, business_date, restaurants, order_type, sub_order_type, total_no_of_bills,
         my_amount, total_discount, net_sales, delivery_charge, container_charge,
         service_charge, additional_charge, total_tax, round_off, waived_off, total_sales,
         online_tax_calculated, gst_paid_by_merchant, gst_paid_by_ecommerce
  from landing.petpooja_sub_order_wise;

create or replace view public.v_report_invoice_wise_sales as
  select id, business_date, s_no, location, inv_date, seller_invoice_no, invoice_no,
         challan_no, from_location, pickup_gstin, pickup_pincode, deliver_gstin,
         buyer_billing_name, buyer_billing_state, buyer_billing_address, buyer_billing_gstin,
         buyer_billing_pincode, buyer_name, buyer_gstin, item_name, hsn_code, sku_code,
         brand, mrp, category, price, so_qty, gr_qty, uom, discount_pct, discount_amt,
         subtotal, tax, cess, tax_amt, cess_amt, sgst_tax, sgst_tax_amount, cgst_tax,
         cgst_tax_amount, igst_tax, igst_tax_amount, additional_charges, delivery_charges, total
  from landing.petpooja_invoice_wise_sales;

create or replace view public.v_report_daily_stock as
  select id, business_date, report_location, raw_material, category, sub_category, hsn_code,
         sap_code, unit, opening_a, purchase_sales_return_b, excess_c, total_stock, consumed_d,
         wastage_e, normal_loss_f, sales_transfer_purchase_g, shortage_h, production_i,
         total_consumed, closing_stock, closing_summary, difference, reconciliation_price,
         reconciliation_amount
  from landing.petpooja_daily_stock;

revoke all on public.v_report_sub_order_wise from anon, authenticated;
revoke all on public.v_report_invoice_wise_sales from anon, authenticated;
revoke all on public.v_report_daily_stock from anon, authenticated;
grant select on public.v_report_sub_order_wise to service_role;
grant select on public.v_report_invoice_wise_sales to service_role;
grant select on public.v_report_daily_stock to service_role;

notify pgrst, 'reload schema';
