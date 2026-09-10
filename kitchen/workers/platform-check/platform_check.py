#!/usr/bin/env python3
"""
Platform check: freeze the Zomato and Swiggy funnel figures for a date window,
then prove whether the platforms restated them later.

Zomato and Swiggy both revise numbers after the fact. The spine keeps every
version (supersede loads), so the live answer can move under us. This script
takes a timestamped snapshot of the figures a conclusion was based on, and
diffs a later snapshot against it.

Usage:
  python3 platform_check.py --snapshot                  freeze today's numbers
  python3 platform_check.py --check                     freeze, then diff vs the previous freeze
  python3 platform_check.py --diff OLD.json NEW.json    diff two saved freezes
  ...optionally --from YYYY-MM-DD --to YYYY-MM-DD       (default 2026-08-22 to 2026-08-30)

Read only. It never writes to the spine.
"""
import argparse
import datetime as dt
import json
import os
import pathlib
import re
import sys
import time

import psycopg2

HERE = pathlib.Path(__file__).resolve().parent
SNAPDIR = HERE / "snapshots"
ENV = HERE.parents[1] / ".env.local"          # kitchen/.env.local

DEFAULT_FROM = "2026-08-22"
DEFAULT_TO = "2026-08-30"

# A landing column is text and may carry thousands separators or blanks.
NUM = "coalesce(nullif(replace({c},',',''),''),'0')::numeric"


def dsn():
    txt = ENV.read_text()
    m = re.search(r"^SPINE_DATABASE_URL=(.+)$", txt, re.M)
    if not m:
        sys.exit("SPINE_DATABASE_URL not found in %s" % ENV)
    return m.group(1).strip().strip('"').strip("'")


def connect():
    """The spine is reached over a NAT64 network (F22); retry a dropped socket."""
    last = None
    for attempt in range(4):
        try:
            # F47: keepalives on every connect site, so a stalled socket is
            # killed in about a minute instead of hanging the run for hours.
            return psycopg2.connect(dsn(), connect_timeout=20,
                                    keepalives=1, keepalives_idle=30,
                                    keepalives_interval=10, keepalives_count=5)
        except Exception as exc:                # noqa: BLE001
            last = exc
            time.sleep(3 * (attempt + 1))
    sys.exit("could not reach the spine after 4 tries: %s" % last)


def q_zomato_funnel(a, b):
    cols = ["impressions", "menu_opens", "cart_builds", "orders_placed",
            "net_sales", "delivered_orders", "subtotal_value",
            "brand_search", "dish_or_cuisine_search", "homepage_listing",
            "recommended_for_you", "offers_page", "campaign_page"]
    sel = ", ".join("sum(%s) as %s" % (NUM.format(c=c), c) for c in cols)
    return ("select business_date::text, restaurant_id, %s "
            "from landing.zomato_outlet_day_segment "
            "where superseded_by is null and business_date between %%s and %%s "
            "group by 1,2" % sel), cols


def q_zomato_ads(a, b):
    cols = ["ad_impressions", "ad_menu_opens", "orders_from_ads",
            "ad_spends", "net_sales_from_ads"]
    sel = ", ".join("sum(%s) as %s" % (NUM.format(c=c), c) for c in cols)
    return ("select business_date::text, restaurant_id, %s "
            "from landing.zomato_outlet_day_ads_segment "
            "where superseded_by is null and segment_type='nrl' "
            "and business_date between %%s and %%s group by 1,2" % sel), cols


def q_zomato_quality(a, b):
    cols = ["online_time_pct", "rejected_orders_pct",
            "customer_cancellation_pct", "offline_time"]
    sel = ", ".join("max(%s) as %s" % (NUM.format(c=c), c) for c in cols)
    return ("select business_date::text, restaurant_id, %s "
            "from landing.zomato_outlet_day_quality "
            "where superseded_by is null and business_date between %%s and %%s "
            "group by 1,2" % sel), cols


def q_swiggy_funnel(a, b):
    cols = ["menu_sessions", "cart_session", "payment_session", "order_session"]
    sel = ", ".join("sum(%s) as %s" % (NUM.format(c=c), c) for c in cols)
    return ("select business_date::text, restaurant_id, %s "
            "from landing.swiggy_funnel_daily "
            "where superseded_by is null and business_date between %%s and %%s "
            "group by 1,2" % sel), cols


def q_swiggy_sales(a, b):
    cols = ["orders", "gmv"]
    sel = ", ".join("sum(%s) as %s" % (NUM.format(c=c), c) for c in cols)
    return ("select business_date::text, restaurant_id, %s "
            "from landing.swiggy_sales_daily "
            "where superseded_by is null and business_date between %%s and %%s "
            "group by 1,2" % sel), cols


SOURCES = {
    "zomato_funnel": q_zomato_funnel,
    "zomato_ads": q_zomato_ads,
    "zomato_quality": q_zomato_quality,
    "swiggy_funnel": q_swiggy_funnel,
    "swiggy_sales": q_swiggy_sales,
}


def take(a, b):
    out = {"taken_at": dt.datetime.now().astimezone().isoformat(),
           "window": {"from": a, "to": b}, "cells": {}, "coverage": {}}
    conn = connect()
    try:
        with conn.cursor() as cur:
            for name, builder in SOURCES.items():
                sql, cols = builder(a, b)
                cur.execute(sql, (a, b))
                rows = cur.fetchall()
                days = set()
                for r in rows:
                    day, rid = r[0], r[1]
                    days.add(day)
                    key = "%s|%s|%s" % (name, day, rid)
                    out["cells"][key] = {c: float(v) if v is not None else None
                                         for c, v in zip(cols, r[2:])}
                out["coverage"][name] = {"rows": len(rows),
                                         "days": sorted(days),
                                         "max_day": max(days) if days else None}
    finally:
        conn.close()
    return out


def save(snap):
    SNAPDIR.mkdir(exist_ok=True)
    stamp = dt.datetime.now().strftime("%Y-%m-%dT%H%M%S")
    path = SNAPDIR / ("%s.json" % stamp)
    path.write_text(json.dumps(snap, indent=1, sort_keys=True))
    return path


def previous(before):
    files = sorted(p for p in SNAPDIR.glob("*.json") if p != before)
    return files[-1] if files else None


def diff(old, new, tol=0.5):
    o, n = old["cells"], new["cells"]
    moved, added, gone = [], [], []
    for k in sorted(set(o) | set(n)):
        if k not in o:
            added.append(k)
            continue
        if k not in n:
            gone.append(k)
            continue
        for metric, ov in o[k].items():
            nv = n[k].get(metric)
            if ov is None and nv is None:
                continue
            if ov is None or nv is None or abs(nv - ov) > tol:
                moved.append((k, metric, ov, nv))
    return moved, added, gone


def report(old, new, oldname, newname):
    print("=" * 72)
    print("PLATFORM CHECK")
    print("  baseline : %s   taken %s" % (oldname, old["taken_at"]))
    print("  now      : %s   taken %s" % (newname, new["taken_at"]))
    print("  window   : %s to %s" % (new["window"]["from"], new["window"]["to"]))
    print("=" * 72)

    print("\n-- COVERAGE (has a platform caught up?) --")
    for src in sorted(new["coverage"]):
        was = old["coverage"].get(src, {}).get("max_day")
        now = new["coverage"][src]["max_day"]
        flag = "  <== NEW DAYS" if was != now else ""
        print("  %-16s last day was %s, now %s%s" % (src, was, now, flag))

    moved, added, gone = diff(old, new)

    print("\n-- RESTATEMENTS --")
    if not moved and not added and not gone:
        print("  nothing moved. Every figure the conclusion rested on still holds.")
    else:
        print("  %d figures changed, %d cells appeared, %d disappeared"
              % (len(moved), len(added), len(gone)))

    if moved:
        by_src = {}
        for key, metric, ov, nv in moved:
            src = key.split("|")[0]
            by_src.setdefault(src, []).append((key, metric, ov, nv))
        for src in sorted(by_src):
            items = by_src[src]
            print("\n  [%s] %d changed" % (src, len(items)))
            for key, metric, ov, nv in sorted(
                    items,
                    key=lambda t: -abs((t[3] or 0) - (t[2] or 0)))[:15]:
                _, day, rid = key.split("|")
                delta = (nv or 0) - (ov or 0)
                pct = ("%+.1f%%" % (100 * delta / ov)) if ov else "n/a"
                print("    %s  rest %-10s %-22s %12s -> %12s  (%s)"
                      % (day, rid, metric, _fmt(ov), _fmt(nv), pct))
            if len(items) > 15:
                print("    ... and %d more" % (len(items) - 15))

    if added:
        print("\n  NEW cells (a platform delivered data it had not sent before):")
        for k in added[:20]:
            print("    %s" % k)
        if len(added) > 20:
            print("    ... and %d more" % (len(added) - 20))
    if gone:
        print("\n  cells that VANISHED (investigate, this should be rare):")
        for k in gone[:20]:
            print("    %s" % k)

    print("\n-- VERDICT --")
    if not moved and not gone and not added:
        print("  The 29 to 30 August reading stands unchanged.")
    else:
        print("  Figures moved. Re-run the funnel analysis before repeating")
        print("  any conclusion drawn from the earlier snapshot.")
    print()
    return 0


def _fmt(v):
    if v is None:
        return "None"
    return "%.2f" % v if abs(v - round(v)) > 0.001 else "%d" % round(v)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--diff", nargs=2, metavar=("OLD", "NEW"))
    ap.add_argument("--from", dest="a", default=DEFAULT_FROM)
    ap.add_argument("--to", dest="b", default=DEFAULT_TO)
    args = ap.parse_args()

    if args.diff:
        old = json.loads(pathlib.Path(args.diff[0]).read_text())
        new = json.loads(pathlib.Path(args.diff[1]).read_text())
        return report(old, new, args.diff[0], args.diff[1])

    snap = take(args.a, args.b)
    path = save(snap)
    print("snapshot written: %s" % path)
    for src in sorted(snap["coverage"]):
        c = snap["coverage"][src]
        print("  %-16s %6d rows, last day %s" % (src, c["rows"], c["max_day"]))

    if args.check:
        prev = previous(path)
        if not prev:
            print("\nno earlier snapshot to compare against; this one is the baseline.")
            return 0
        print()
        return report(json.loads(prev.read_text()), snap, prev.name, path.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
