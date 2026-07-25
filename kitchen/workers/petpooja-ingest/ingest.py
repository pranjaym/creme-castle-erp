#!/usr/bin/env python3
"""
Petpooja ingest worker (ours). Pulls a report, keeps the raw file as an immutable
receipt, and loads it into the spine landing zone.

This is OUR OWN ingestion. Rishabh's petpooja_pipeline.py is reference only and is
never imported: it carries live secrets and Google Sheets as the destination. We
take from it only the knowledge of the login/session/download pattern and the
04:00 IST business-day rule. Every secret here comes from the environment.

Reports:
  oms_purchase         Material Purchase Report at the vendor-OMS location, the
                       Build 1a punch source (HTML saved as .xls, title block above
                       the header). CONFIRMED source; real punch volume begins at
                       OMS billing go-live (F13). The parser is structurally proven.
  order_summary_item   the item sales report; feeds the console (Build 2), not 1a
  online_orders        the aggregator order-count report; console (Build 2)

Run:
  python3 ingest.py --report oms_purchase --file /path/to/report.xls
  python3 ingest.py --report oms_purchase --file /path/to/report.xls --dry-run
  python3 ingest.py --report oms_purchase --scrape     # login + download, then load

--dry-run parses and reports what it WOULD load, with no database connection and no
receipt upload. It is the offline verification path (no spine creds needed).

Env (only for a real load, not for --dry-run):
  SPINE_DATABASE_URL, SPINE_SUPABASE_URL, SPINE_SUPABASE_SERVICE_ROLE_KEY,
  SPINE_STORAGE_BUCKET_PETPOOJA. Scrape adds the PETPOOJA_* vars (see scrape.py).
"""
import argparse
import csv
import datetime as dt
import hashlib
import os
import sys


def env(k, required=True):
    v = os.environ.get(k)
    if required and not v:
        sys.exit(f"{k} is not set")
    return v


def business_day(ts_str):
    """04:00 IST rule for sale timestamps. The report timestamps are IST local.
    order_summary_item exports dates as '22/07/26 7:21' (d/m/2-digit-year), the
    online report as '2026-07-23 00:00:00'; both are covered here. Formats are tried
    in order and the first match wins, so the unambiguous ISO form is checked first."""
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d/%m/%y %H:%M:%S",
                "%d/%m/%y %H:%M", "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d %b %Y"):
        try:
            ts = dt.datetime.strptime(ts_str.strip(), fmt)
            return (ts - dt.timedelta(hours=4)).date()
        except (ValueError, AttributeError):
            continue
    return None


def _invoice_date_to_business_day(s):
    """Transfer/purchase Invoice Date is a date already (the fulfillment day). No
    4:00 shift: that rule is for sale timestamps, not a booked-transfer date."""
    for fmt in ("%d %b %Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return dt.datetime.strptime(str(s).strip(), fmt).date()
        except (ValueError, AttributeError):
            continue
    return None


def row_hash(values):
    return hashlib.sha256(
        "\x1f".join("" if v is None else str(v) for v in values).encode()
    ).hexdigest()


# ---------------------------------------------------------------------------
# Report definitions. Each parser is PURE: it reads a file and returns a list of
# {"business_date", "values": [...], "row_hash"} records, in the fixed column
# order below. The DB loader and the dry-run reporter both consume that list, so
# what --dry-run shows is exactly what a real load would insert. The row_hash is
# computed over [business_date] + values in column order and must never change,
# or a re-load would duplicate rows already in the landing zone.
# ---------------------------------------------------------------------------

PURCHASE_COL_MAP = {
    "Supplier/Kitchen/Rest name": "supplier_name",
    "Invoice Date": "invoice_date",
    "Invoice Number": "invoice_number",
    "Raw Material": "raw_material",
    "Quantity Purchased": "quantity",
    "Unit": "unit",
    "Purchase Price (₹)": "price",
    "Subtotal (₹)": "subtotal",
    "Taxes (₹)": "taxes",
    "Discount (₹)": "discount",
    "Net Amount (₹)": "net_amount",
    "PO Reference Number": "po_reference",
    "Category": "category",
    "Sub Category": "sub_category",
    "Description": "description",
}
PURCHASE_COLS = list(PURCHASE_COL_MAP.values())

# Full order_summary_item column set (32), matching the raw CSV headers ('date' is
# stored as order_ts). Decision 24 Jul 2026: keep every column, PII included, so the
# spine reproduces the report verbatim. Must stay in the same order as the table and
# the parse_item_report value list below (migration 050).
ITEM_COLS = [
    "restaurant_name", "invoice_no", "order_ts", "payment_type", "order_type", "status",
    "area", "virtual_brand_name", "brand_grouping", "assign_to", "customer_phone",
    "customer_name", "customer_address", "persons", "order_cancel_reason", "my_amount",
    "total_tax", "discount", "delivery_charge", "container_charge", "service_charge",
    "additional_charge", "deduction_charge", "waived_off", "round_off", "total",
    "item_name", "category_name", "sap_code", "item_price", "item_quantity", "item_total",
]

# Online Order Report (online_orders_report_all): Zomato/Swiggy order-level, xlsx.
# FULL 27-column capture (24 Jul 2026): every column from the raw report, so the
# spine holds the delivery/packaging charges, discounts, times, and status the
# earlier 9-column version dropped. business_date uses the 04:00 IST rule on 'Date'.
ONLINE_COL_MAP = {
    "Date": "order_date",
    "Invoice Date": "invoice_date",
    "Aggregator Order No.": "aggregator_order_no",
    "PoS Invoice No.": "pos_invoice_no",
    "Order From": "order_from",
    "Outlet Name": "outlet_name",
    "Outlet Display Name": "outlet_display_name",
    "Petpooja Identifier": "petpooja_identifier",
    "Order Type": "order_type",
    "Customer Name": "customer_name",
    "Customer Phone": "customer_phone",
    "Payment Type": "payment_type",
    "Delivery Status": "delivery_status",
    "Status": "status",
    "My amount": "my_amount",
    "Aggregator Discount": "aggregator_discount",
    "Outlet Discount": "outlet_discount",
    "Delivery Charges": "delivery_charges",
    "Container Charges": "container_charges",
    "Additional Charge": "additional_charge",
    "Total": "total",
    "Order Acceptance Time": "order_acceptance_time",
    "Order Delivery Time": "order_delivery_time",
    "Cancelled By": "cancelled_by",
    "Reason": "reason",
    "Tip": "tip",
    "Complimentary": "complimentary",
}
ONLINE_COLS = ["order_date", "invoice_date", "aggregator_order_no", "pos_invoice_no",
               "order_from", "outlet_name", "outlet_display_name", "petpooja_identifier",
               "order_type", "customer_name", "customer_phone", "payment_type",
               "delivery_status", "status", "my_amount", "aggregator_discount",
               "outlet_discount", "delivery_charges", "container_charges",
               "additional_charge", "total", "order_acceptance_time",
               "order_delivery_time", "cancelled_by", "reason", "tip", "complimentary"]


def parse_oms_purchase(path):
    """Material Purchase Report (HTML saved as .xls, title block above the header).
    Returns (records, skipped). A row we cannot day-stamp is skipped and counted,
    never guessed."""
    import pandas as pd
    table = pd.read_html(path)[0]
    hdr_idx = table.index[table.apply(
        lambda r: r.astype(str).str.contains("Invoice Number").any(), axis=1)][0]
    header = list(table.iloc[hdr_idx])
    data = table.iloc[hdr_idx + 1:].copy()
    data.columns = header
    data = data.dropna(how="all")

    records, skipped = [], 0
    for _, row in data.iterrows():
        rec = {internal: (None if pd.isna(row.get(src)) else str(row.get(src)).strip())
               for src, internal in PURCHASE_COL_MAP.items() if src in data.columns}
        bd = _invoice_date_to_business_day(rec.get("invoice_date"))
        if bd is None:
            skipped += 1
            continue
        vals = [rec.get(c) for c in PURCHASE_COLS]
        records.append({"business_date": bd, "values": vals,
                        "row_hash": row_hash([bd] + vals)})
    return records, skipped


def parse_item_report(path):
    """order_summary_item CSV. Returns (records, skipped)."""
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        rows = list(csv.DictReader(f))
    records, skipped = [], 0
    for r in rows:
        ts = r.get("date")
        bd = business_day(ts) if ts else None
        if bd is None:
            skipped += 1
            continue
        vals = [
            r.get("restaurant_name"), r.get("invoice_no"), ts, r.get("payment_type"),
            r.get("order_type"), r.get("status"), r.get("area"), r.get("virtual_brand_name"),
            r.get("brand_grouping"), r.get("assign_to"), r.get("customer_phone"),
            r.get("customer_name"), r.get("customer_address"), r.get("persons"),
            r.get("order_cancel_reason"), r.get("my_amount"), r.get("total_tax"),
            r.get("discount"), r.get("delivery_charge"), r.get("container_charge"),
            r.get("service_charge"), r.get("additional_charge"), r.get("deduction_charge"),
            r.get("waived_off"), r.get("round_off"), r.get("total"), r.get("item_name"),
            r.get("category_name"), r.get("sap_code"), r.get("item_price"),
            r.get("item_quantity"), r.get("item_total"),
        ]
        records.append({"business_date": bd, "values": vals,
                        "row_hash": row_hash([bd] + vals)})
    return records, skipped


def parse_online_orders(path):
    """online_orders_report_all xlsx. Returns (records, skipped)."""
    import pandas as pd
    df = pd.read_excel(path)
    records, skipped = [], 0
    for _, row in df.iterrows():
        rec = {internal: (None if pd.isna(row.get(src)) else str(row.get(src)).strip())
               for src, internal in ONLINE_COL_MAP.items() if src in df.columns}
        bd = business_day(rec.get("order_date")) if rec.get("order_date") else None
        if bd is None:
            skipped += 1
            continue
        vals = [rec.get(c) for c in ONLINE_COLS]
        records.append({"business_date": bd, "values": vals,
                        "row_hash": row_hash([bd] + vals)})
    return records, skipped


REPORTS = {
    "oms_purchase": {
        "parse": parse_oms_purchase,
        "table": "landing.petpooja_oms_purchases",
        "cols": PURCHASE_COLS,
        "report_key": "oms_purchase",
        "key_col": "invoice_number",   # the recon key, for the dry-run summary
        "source_col": "supplier_name",
    },
    "order_summary_item": {
        "parse": parse_item_report,
        "table": "landing.petpooja_order_summary_item",
        "cols": ITEM_COLS,
        "report_key": "order_summary_item",
        "key_col": "invoice_no",
        "source_col": "restaurant_name",
        # Decision 24 Jul 2026: keep all columns, PII included. Nothing stripped.
        "pii_cols": [],
    },
    "online_orders": {
        "parse": parse_online_orders,
        "table": "landing.petpooja_online_orders",
        "cols": ONLINE_COLS,
        "report_key": "online_orders",
        "key_col": "aggregator_order_no",
        "source_col": "outlet_name",
        "pii_cols": [],   # this report's PII columns are not mapped in the first place
    },
}


def strip_pii(records, spec):
    """Null the report's known customer-PII columns, then recompute the row hash so
    the stored content and its idempotency key agree. Privacy-preserving default."""
    cols = spec["cols"]
    idxs = [cols.index(c) for c in spec.get("pii_cols", []) if c in cols]
    if not idxs:
        return records
    for r in records:
        for i in idxs:
            r["values"][i] = None
        r["row_hash"] = row_hash([r["business_date"]] + r["values"])
    return records


def _window(records):
    days = [r["business_date"] for r in records]
    return (min(days), max(days)) if days else (None, None)


def dry_run_report(report, records, skipped):
    """Offline verification: print exactly what a real load would insert. No DB."""
    spec = REPORTS[report]
    cols = spec["cols"]
    ki = cols.index(spec["key_col"]) if spec["key_col"] in cols else None
    si = cols.index(spec["source_col"]) if spec["source_col"] in cols else None
    keys = {r["values"][ki] for r in records if ki is not None and r["values"][ki]}
    sources = {r["values"][si] for r in records if si is not None and r["values"][si]}
    lo, hi = _window(records)
    print(f"[dry-run] report={report}")
    print(f"  rows parsed:      {len(records)}")
    print(f"  skipped (no date):{skipped}")
    print(f"  business days:    {lo} .. {hi}")
    print(f"  distinct sources: {len(sources)}  e.g. {sorted(sources)[:5]}")
    print(f"  distinct {spec['key_col']} (recon keys): {len(keys)}  e.g. {sorted(keys)[:5]}")
    blank_keys = sum(1 for r in records if ki is not None and not r["values"][ki])
    if ki is not None:
        print(f"  rows with blank {spec['key_col']}: {blank_keys} "
              f"(each becomes a 'missing order number' leak in the matcher)")
    print("  no database connection opened, nothing written.")


def load_records(report, records, skipped, conn, receipt):
    """Insert parsed records into landing, idempotently. Links the raw receipt
    (sha256, storage path) and the derived business-day window onto the run row."""
    spec = REPORTS[report]
    cols = spec["cols"]
    sha, storage_path = receipt if receipt else (None, None)
    lo, hi = _window(records)

    cur = conn.cursor()
    cur.execute(
        "insert into landing.ingest_runs "
        "(source_system, report_key, window_from, window_to, raw_file_path, sha256, status) "
        "values ('petpooja', %s, %s, %s, %s, %s, 'started') returning id",
        (spec["report_key"], lo, hi, storage_path, sha),
    )
    run_id = cur.fetchone()[0]

    # Batch insert (execute_values) so a 30-day backfill of ~150k rows loads in
    # seconds, not one network round-trip per row. `returning 1` with fetch=True gives
    # an accurate count of rows actually inserted (conflicts are skipped).
    from psycopg2.extras import execute_values
    insert = (
        f"insert into {spec['table']} "
        f"(ingest_run_id, business_date, {', '.join(cols)}, row_hash) values %s "
        f"on conflict (business_date, row_hash) do nothing returning 1"
    )
    payload = [[run_id, r["business_date"], *r["values"], r["row_hash"]] for r in records]
    inserted = execute_values(cur, insert, payload, page_size=1000, fetch=True) if payload else []
    loaded = len(inserted)

    cur.execute(
        "update landing.ingest_runs set status='loaded', row_count=%s, finished_at=now() "
        "where id=%s",
        (loaded, run_id),
    )
    conn.commit()
    print(f"{report}: {loaded} new rows loaded (of {len(records)} parsed, {skipped} skipped). "
          f"run_id={run_id}, receipt={sha[:12] + '…' if sha else 'none'}")


def store_receipt(path):
    """Upload the raw file to Storage as an immutable receipt (sha256 named).
    Returns (sha256, storage_path) so the ingest_run can point at the receipt."""
    import requests
    with open(path, "rb") as f:
        blob = f.read()
    sha = hashlib.sha256(blob).hexdigest()
    bucket = env("SPINE_STORAGE_BUCKET_PETPOOJA", required=False) or "petpooja-raw"
    storage_path = f"{dt.date.today()}/{sha}-{os.path.basename(path)}"
    url = f"{env('SPINE_SUPABASE_URL')}/storage/v1/object/{bucket}/{storage_path}"
    key = env("SPINE_SUPABASE_SERVICE_ROLE_KEY")
    resp = requests.post(url, data=blob, headers={
        "Authorization": f"Bearer {key}", "apikey": key,
        "Content-Type": "application/octet-stream", "x-upsert": "true",
    })
    resp.raise_for_status()
    print(f"receipt stored: {sha[:12]}… -> {bucket}/{storage_path}")
    return sha, f"{bucket}/{storage_path}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", choices=list(REPORTS))
    ap.add_argument("--file")
    ap.add_argument("--scrape", action="store_true")
    ap.add_argument("--dry-run", action="store_true",
                    help="parse and report only; no DB, no receipt upload")
    ap.add_argument("--days-back", type=int, default=0,
                    help="scrape a date range ending today and starting this many days back")
    ap.add_argument("--keep-pii", action="store_true",
                    help="keep customer name/phone (default strips them)")
    args = ap.parse_args()

    if args.scrape:
        from scrape import scrape_and_download  # local module; portal flow lives there
        args.report = args.report or "oms_purchase"
        args.file = scrape_and_download(args.report, days_back=args.days_back)

    if not args.file or not args.report:
        sys.exit("provide --report and --file, or --scrape")

    spec = REPORTS[args.report]
    records, skipped = spec["parse"](args.file)
    if not args.keep_pii:
        records = strip_pii(records, spec)

    if args.dry_run:
        dry_run_report(args.report, records, skipped)
        return

    receipt = store_receipt(args.file)
    import psycopg2
    conn = psycopg2.connect(env("SPINE_DATABASE_URL"))
    try:
        load_records(args.report, records, skipped, conn, receipt)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
