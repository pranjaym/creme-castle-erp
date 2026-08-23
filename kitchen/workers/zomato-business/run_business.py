"""Orchestrator for the Zomato enterprise business reports.

    python3 run_business.py --from 2026-08-12 --to 2026-08-13
    python3 run_business.py --harvest-only --since 2026-08-22T10:48:00Z

One cycle:
  1. request the five report shapes for the window (headless Firefox, the saved
     session the live zomato-ingest worker already keeps);
  2. wait for reports@zomato.com mail, auto-forwarded to CC_MAIL_USER;
  3. resolve each tracker to its download key, load the key in the session to get
     a presigned S3 url, fetch the CSV;
  4. identify each CSV by its own shape (the mails are all titled the same);
  5. parse and load with supersede lineage.

Exit codes follow the house contract used by zomato-ingest:
  0  everything loaded
 75  transport-class failure, a later slot should retry (network, timeout, 5xx,
     or reports simply not arrived yet)
  1  a fault more slots cannot fix (parse failure, unknown shape, bad data)
"""
from __future__ import annotations

import argparse
import os
import socket
import ssl
import sys
import time
import traceback
from datetime import date, datetime, timedelta, timezone

import requests as _rq

import harvest as H
import load as L
import parse as P
import request as R

HERE = os.path.dirname(os.path.abspath(__file__))
SESSION = os.path.expanduser(os.environ.get("ZOMATO_SESSION_FILE",
                                            "~/.creme-castle/zomato_session.json"))
SHAPES = ["quality", "segment", "ads_sp", "ads_nrl", "order"]
DEFER = 75

TRANSPORT = (socket.timeout, socket.gaierror, ssl.SSLError, ConnectionError,
             _rq.exceptions.Timeout, _rq.exceptions.ConnectionError)

# report_key recorded on landing.ingest_runs, per shape
RUN_KEY = {"quality": "business_quality", "segment": "business_segment",
           "ads_sp": "business_ads_sp", "ads_nrl": "business_ads_nrl",
           "order": "business_order", "campaign": "business_campaign"}


def log(msg):
    print(f"{datetime.now(H.IST):%Y-%m-%d %H:%M:%S} {msg}", flush=True)


def wait_for_reports(since_utc, expect, timeout_s=1800, poll_s=60, window=None):
    """Poll the forwarded mailbox until `expect` report mails for this window have
    arrived. Filtering on the window keeps concurrent pulls from stealing each
    other's reports."""
    deadline = time.time() + timeout_s
    seen = []
    while time.time() < deadline:
        seen = H.fetch_report_links(since_utc, window=window)
        log(f"  mailbox: {len(seen)}/{expect} report mails")
        if len(seen) >= expect:
            return seen
        time.sleep(poll_s)
    return seen


def load_csv(cur, shape, csv_text, run_window):
    """Parse one CSV by shape and load it. Returns (rows_loaded, counts)."""
    d1, d2 = run_window
    run = L.open_run(cur, RUN_KEY[shape], d1, d2)
    if shape == "order":
        orders, items = P.parse_order_file(csv_text)
        a = L.load_shape(cur, "order", orders, run)
        b = L.load_shape(cur, "order_item", items, run)
        L.upsert_outlets(cur, P.outlets_from(orders))
        L.close_run(cur, run, len(orders) + len(items))
        return len(orders) + len(items), {"order": a, "order_item": b}
    if shape == "segment":
        rows = P.parse_segment_cube(csv_text); tgt = "segment"
    elif shape in ("ads_sp", "ads_nrl"):
        rows = P.parse_ads_cube(csv_text,
                                "spending_potential" if shape == "ads_sp" else "nrl")
        tgt = "ads_segment"
    elif shape == "quality":
        rows = P.parse_quality_cube(csv_text); tgt = "quality"
    else:
        raise RuntimeError(f"no loader for shape {shape!r}")
    counts = L.load_shape(cur, tgt, rows, run)
    L.upsert_outlets(cur, P.outlets_from(rows))
    L.close_run(cur, run, len(rows))
    return len(rows), {tgt: counts}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="d_from")
    ap.add_argument("--to", dest="d_to")
    ap.add_argument("--shapes", default=",".join(SHAPES))
    ap.add_argument("--harvest-only", action="store_true")
    ap.add_argument("--since", help="ISO UTC cutoff for --harvest-only")
    ap.add_argument("--wait", type=int, default=1800)
    args = ap.parse_args()

    L.load_env_file(os.path.join(HERE, "..", "..", ".env.local"))
    shapes = [s for s in args.shapes.split(",") if s]

    if args.harvest_only:
        since = datetime.fromisoformat(args.since.replace("Z", "+00:00"))
        if not (args.d_from and args.d_to):
            log("FATAL: --harvest-only needs --from and --to, so the right reports "
                "are picked out of the mailbox")
            return 1
        window = (date.fromisoformat(args.d_from), date.fromisoformat(args.d_to))
    else:
        d1 = date.fromisoformat(args.d_from)
        d2 = date.fromisoformat(args.d_to)
        if (d2 - d1).days > 30:
            log("FATAL: window longer than 31 days, Zomato will refuse it")
            return 1
        window = (d1, d2)
        since = datetime.now(timezone.utc)
        log(f"requesting {len(shapes)} shapes for {d1} to {d2}")
        for r in R.request_reports(SESSION, shapes, d1, d2):
            log(f"  {r['shape']:9s} metrics={r['metrics']:3d} http={r['status']}")
            if r["status"] != 200:
                log("FATAL: Zomato refused the request"); return 1

    log("waiting for report mail")
    # Always filter on the window. Without it a concurrent or earlier pull's report
    # gets picked up and recorded against the wrong window in landing.ingest_runs,
    # which then makes the backfill's resume check skip a month it never loaded.
    links = wait_for_reports(since, len(shapes), timeout_s=args.wait, window=window)
    if len(links) < len(shapes):
        log(f"DEFER: only {len(links)}/{len(shapes)} reports arrived; a later slot retries")
        return DEFER

    csvs = []
    for item in links:
        key, rtype = H.resolve_tracker(item["tracker"])
        text = H.download_csv(H.presigned_for(key, rtype, SESSION))
        shape = P.detect_shape(text)
        log(f"  fetched {shape:9s} {len(text):>9,} bytes  key={key[:18]}...")
        csvs.append((shape, text))

    got = {s for s, _ in csvs}
    if got != set(shapes):
        log(f"FATAL: expected {sorted(shapes)}, mail delivered {sorted(got)}")
        return 1

    conn = L.connect(); conn.autocommit = False
    total = 0
    try:
        with conn.cursor() as cur:
            for shape, text in csvs:
                n, counts = load_csv(cur, shape, text, window)
                total += n
                log(f"  loaded  {shape:9s} {n:>7,} rows  {counts}")
        conn.commit()
        log(f"committed, {total:,} rows")
        return 0
    except TRANSPORT as e:
        conn.rollback(); log(f"DEFER, transport: {type(e).__name__}: {e}"); return DEFER
    except Exception:
        conn.rollback(); log("FATAL:\n" + traceback.format_exc()); return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
