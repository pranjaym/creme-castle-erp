# Petpooja report portal map (live session, 25 July 2026)

Captured with Pranjay on his logged-in Petpooja, read only. This is the wiring
reference for automating the remaining reports into the spine.

## The big structural finding: Petpooja is TWO applications

| | Billing / POS | Inventory |
|---|---|---|
| Host | `billing.petpooja.com` | `inventory.petpooja.com` |
| Outlet scope | works with **All Outlets** | **requires ONE outlet** |
| Holds | sales, orders, items, sub-order | stock, purchase, transfer, wastage, production |

Selecting "All Outlet" while inside the inventory module **redirects straight back
to the billing dashboard**. Inventory is hard gated to a single outlet; there is no
all-outlets view. Verified twice (via the outlet picker, and by navigating to an
inventory report URL with All Outlets active).

## Pranjay's all-outlets question, answered

He asked whether we were wrongly downloading per location and collating. Answer:

- **Sales reports: he is right, and it is already done that way.** One download
  returns every outlet. Confirmed in the spine data: 40 distinct outlets per day in
  the order report, 43 in the item report. The "Choose restaurant" box is left
  EMPTY, which Petpooja treats as all restaurants.
- **Stock report: not possible.** The Opening-Closing (daily stock) report lives in
  the inventory app, which cannot run across outlets at all.
- **But the cost is far smaller than feared.** Inventory is only enabled at about
  eight locations, not the 45+ sales outlets. Observed in the inventory outlet
  picker: CC-ND-Sector 45 (336921), CC-ND-Sector 68 (60462), CC-ND-Sector141
  (336922), Central Dispatch Noida (403416), Central Kitchen-Noida (338961),
  Sk-DL-Janakpuri (338552), SK-GGN-Sikanderpur (338551), SK-ND-Sector 67 (338550).
  So a daily stock pull is ~8 scrapes, not ~45.

## Report wiring reference

### 1. Order Report: Sub-Order Wise  (billing, all outlets)
- URL: `https://billing.petpooja.com/custom_reports/view_report/67`
- Reached via: Reports (left nav) > All Restaurant Report > Order Report: Sub-Order Wise
- Controls: Order Date from/to, Order Status (defaults to `Success`), Restaurants
  (leave **empty** = all), then **Search**.
- Export: renders in page, then a blue **Excel** button (top right) downloads it.
  There is also a Print button. Strategy is therefore: set dates, Search, click Excel.
- Matches the sample `Order_Report_Sub-Order_Wise_*.xlsx` (18 columns, outlet rows
  plus Sub Total rows and a grand Total row).

### 2. Opening - Closing Stock Report  (inventory, ONE outlet at a time)
- URL: `https://inventory.petpooja.com/inventories/daily_stock_report_new/`
- Reached via: pick an outlet > Inventory > Reports > Other Reports >
  "Closing Stock Tracking" tab > Opening - Closing Report.
- Controls: Raw Material, Category, From Date, To Date, **Search**, Clear.
- Export: an **Export** button (top right) with a dropdown for the format.
- This IS the report behind the `Daily_Report_*.xls` sample: it returned **134
  records** for Central Kitchen-Noida, exactly matching the sample's 134 rows.
- The on-screen table is a reduced view (Raw Material, Opening, Closing, Avg, Total);
  the full 22-column set (Consumed, Wastage, Normal Loss, Production, Shortage,
  Reconciliation) comes from the export.
- The current outlet id is visible in the sidebar as "Settings (RestId - NNNNNN)",
  which is a reliable way for a scraper to confirm which outlet it is scoped to.

### 3. Invoice Wise Sales  (NOT Petpooja)
Not present anywhere in the Petpooja report catalogue. The evidence says the sample
`Invoice Wise Sales Report.xlsx` is a **SupplyNote** export:
- its title block matches the SupplyNote `...--Products.xlsx` export style
  ("Cremetech Tailored Food Pvt Ltd" + date range + report name);
- its columns are procurement shaped (SKU Code, Buyer/Pickup GSTIN, From Location,
  So Qty, GR Qty, UOM), not POS shaped;
- the companion `locations_List.csv` carries a "PetPooja ID" column, i.e. that system
  maps TO Petpooja and therefore is not Petpooja.

So it belongs to the SupplyNote wave, which is file upload only (one way boundary,
no scraper) per `build-order.md`.

## Data quality warning found in passing (matters for the kitchen module)

The inventory dashboard for Central Kitchen-Noida reports **"34% Update Accuracy,
stock records are not up to date: closing stock updated on 8 days this month, 16 days
missed."** The Opening-Closing report also showed a **negative opening balance**
(Eggless Cheesecake Slice, -240 Piece).

Consequence: Petpooja's stock ledger is NOT currently trustworthy as a source of
truth for stock on hand. It can be landed in the spine as raw history, but any
valuation or consumption logic built on it must treat it as unverified until the
closing-stock discipline improves. This supports the existing plan that our own
logbook becomes the reliable record.
