#!/usr/bin/env python3
"""
Re-load the last N days of BOTH Petpooja sales reports into the spine, using the
FULL-column parsers (migration 050: order = 27 cols, item = 32 cols, PII included).

Petpooja caps a single export's date range, so this loops in safe windows (order
report <= 5 days, item report <= 7 days), scraping and loading each window. It is
idempotent: re-running never duplicates (unique on business_date, row_hash), so a
window that overlaps a previous run just adds nothing.

Run on a TRUSTED IP (your Mac) from this folder. Needs the same env the daily
dashboard uses:
  SPINE_DATABASE_URL              (the spine Postgres URI; direct connection is fine
                                   from your Mac over IPv6)
  SPINE_SUPABASE_URL              (for the raw-receipt upload)
  SPINE_SUPABASE_SERVICE_ROLE_KEY (same)
The scraper reuses the saved Petpooja session in Supabase Storage (bucket
petpooja-session); if it says the session is stale, run `python3 scrape.py bootstrap`
once and log in by hand, then re-run this.

  python3 backfill.py --days 30            # both reports, last 30 days
  python3 backfill.py --days 30 --report online_orders
  python3 backfill.py --days 2             # the daily "last two days" catch-up
"""
import argparse
import datetime as dt

import psycopg2

import ingest
from scrape import scrape_and_download

# Petpooja's single-export range caps, verified live (23 Jul 2026).
WINDOW_DAYS = {"online_orders": 5, "order_summary_item": 7}


def windows(days, size):
    """Yield (from, to) ISO date strings covering the last `days` days in `size`-day
    chunks, oldest first, inclusive of today."""
    today = dt.date.today()
    cur = today - dt.timedelta(days=days)
    while cur <= today:
        end = min(cur + dt.timedelta(days=size - 1), today)
        yield cur.isoformat(), end.isoformat()
        cur = end + dt.timedelta(days=1)


def run_report(report, days, conn):
    size = WINDOW_DAYS[report]
    parsed_total = 0
    for frm, to in windows(days, size):
        print(f"\n[{report}] window {frm} .. {to}")
        path = scrape_and_download(report, from_date=frm, to_date=to, max_retries=1)
        records, skipped = ingest.REPORTS[report]["parse"](path)
        receipt = ingest.store_receipt(path)
        ingest.load_records(report, records, skipped, conn, receipt)
        parsed_total += len(records)
    print(f"[{report}] all windows done ({parsed_total} rows parsed across windows).")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30, help="how many days back to re-load")
    ap.add_argument("--report", default="both",
                    choices=["both", "online_orders", "order_summary_item"])
    args = ap.parse_args()

    reports = (["online_orders", "order_summary_item"]
               if args.report == "both" else [args.report])
    conn = psycopg2.connect(ingest.env("SPINE_DATABASE_URL"))
    try:
        for rep in reports:
            run_report(rep, args.days, conn)
    finally:
        conn.close()
    print("\nbackfill complete.")


if __name__ == "__main__":
    main()
