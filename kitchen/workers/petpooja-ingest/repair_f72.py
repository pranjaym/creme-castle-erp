#!/usr/bin/env python3
"""
F72 repair: put back the identical repeat item lines the spine dropped before
migration 245 (plan: erp-plan/f72-duplicate-item-lines-plan.md, part C).

ADD ONLY. For each day a line is added when Petpooja's file holds more copies of a
line than the spine does AND the spine already holds that line at least once
(sync.add_missing_duplicates). Nothing is corrected, voided or deleted; any other
difference between an old file and the spine is counted and left alone.

Two sources:
  --stored   days before 21 Jul 2026: re-read the Petpooja file that loaded each day,
             from its stored receipt in Supabase Storage. No Petpooja download.
  --pull     21 Jul 2026 onwards: only the days the morning check found short
             (spine_daily_checks), pulled fresh from Petpooja in windows of up to
             7 days. Run on the Mac (trusted IP), never during the 8am slots.

Default is a DRY RUN: it prints, per day, the lines it would add with their units
and Rs value, and writes nothing. --apply writes, one transaction per day, then
appends the matching core.order_items rows for days older than the core refresh
window. It never runs core.refresh_orders: that deletes core.orders, and
identity.order_customer cascades on that delete (F70).

  python3 repair_f72.py --stored
  python3 repair_f72.py --pull
  python3 repair_f72.py --stored --apply
"""
import argparse
import datetime as dt
import os
import shutil
import sys
import tempfile
from decimal import Decimal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
CUTOFF = dt.date(2026, 7, 21)           # first day the morning check judged
REPORT = "order_summary_item"
CORE_WINDOW_DAYS = 11                   # core.refresh_orders(11), 04:30 and 14:30
ENV_FILE = os.path.join(HERE, "..", "..", "..", "dashboard", "auto", ".env")


def load_env(path=ENV_FILE):
    """Same KEY=VALUE loader as dashboard/auto/run_daily.py; existing env wins."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def connect():
    import psycopg2
    import ingest
    return psycopg2.connect(ingest.env("SPINE_DATABASE_URL"), connect_timeout=30,
                            keepalives=1, keepalives_idle=30, keepalives_interval=10,
                            keepalives_count=5)


def fetch_receipt(storage_path, cache):
    """Download a stored receipt ('<bucket>/<path>') once into the cache folder."""
    import requests
    import ingest
    local = os.path.join(cache, os.path.basename(storage_path))
    if os.path.exists(local):
        return local
    url = f"{ingest.env('SPINE_SUPABASE_URL').rstrip('/')}/storage/v1/object/{storage_path}"
    key = ingest.env("SPINE_SUPABASE_SERVICE_ROLE_KEY")
    r = requests.get(url, headers={"Authorization": f"Bearer {key}", "apikey": key},
                     timeout=(10, 600))
    r.raise_for_status()
    with open(local + ".part", "wb") as f:
        f.write(r.content)
    os.replace(local + ".part", local)
    return local


def stored_plan(cur):
    """{storage_path: [days]}: for each day before CUTOFF, the receipt of the run that
    loaded most of its live rows. Days whose loading run kept no file are reported."""
    cur.execute("""
        with c as (
          select business_date, ingest_run_id,
                 row_number() over (partition by business_date
                                    order by count(*) desc, ingest_run_id desc) rk
          from landing.petpooja_order_summary_item
          where business_date < %s and voided_at is null
          group by business_date, ingest_run_id)
        select c.business_date, r.raw_file_path
        from c join landing.ingest_runs r on r.id = c.ingest_run_id
        where c.rk = 1 order by 1""", (CUTOFF,))
    plan, orphans = {}, []
    for day, path in cur.fetchall():
        if path:
            plan.setdefault(path, []).append(day)
        else:
            orphans.append(day)
    return plan, orphans


def short_days(cur):
    """Days from CUTOFF whose latest judged check saw more source rows than the spine
    holds live: exactly the days that lost a repeat line."""
    cur.execute("""
        with latest as (
          select distinct on (business_date) business_date, rows_in_source
          from landing.spine_daily_checks
          where report_key = %s and business_date >= %s
            and verdict <> 'partial' and verdict not like 'aborted%%'
          order by business_date, id desc),
        held as (
          select business_date, count(*) n from landing.petpooja_order_summary_item
          where business_date >= %s and voided_at is null group by 1)
        select l.business_date from latest l left join held h using (business_date)
        where l.rows_in_source > coalesce(h.n, 0) order by 1""", (REPORT, CUTOFF, CUTOFF))
    return [r[0] for r in cur.fetchall()]


def windows(days, span=7):
    """Group sorted days into pull windows (from, to, [days]). A business day D runs
    to 04:00 on D+1, so a window ends the calendar day after its last target day, and
    from..to covers at most `span` calendar days (Petpooja's item export cap)."""
    out = []
    for d in days:
        if out and (d + dt.timedelta(days=1) - out[-1][0]).days < span:
            out[-1][2].append(d)
            out[-1][1] = d + dt.timedelta(days=1)
        else:
            out.append([d, d + dt.timedelta(days=1), [d]])
    return [(a, b, ds) for a, b, ds in out]


def repair_days(conn, path, days, apply, receipt=None):
    """Run the add-only repair for `days` from one file. One transaction per day."""
    import ingest
    import sync
    records, _ = ingest.REPORTS[REPORT]["parse"](path)
    by_day = {}
    for r in records:
        by_day.setdefault(r["business_date"], []).append(r)
    cur = conn.cursor()
    run_id = None
    if apply:
        cur.execute("insert into landing.ingest_runs (source_system, report_key, window_from, "
                    "window_to, raw_file_path, sha256, status) values "
                    "('petpooja', %s, %s, %s, %s, %s, 'started') returning id",
                    (REPORT, min(days), max(days), receipt[1] if receipt else None,
                     receipt[0] if receipt else None))
        run_id = cur.fetchone()[0]
        conn.commit()
    results = []
    for day in sorted(days):
        recs = by_day.get(day)
        if not recs:
            print(f"  {day}: not in this file, skipped")
            continue
        res = sync.add_missing_duplicates(cur, REPORT, day, recs, run_id)
        if apply:
            conn.commit()
        else:
            conn.rollback()
        results.append(res)
        if res["lines"] or res["other"] or res["shortfall"]:
            print(f"  {day}: +{res['lines']} line(s), {res['units']} unit(s), "
                  f"Rs {res['value']:,.0f}"
                  + (f"; {res['other']} other difference(s) left alone" if res["other"] else "")
                  + (f"; SHORTFALL {res['shortfall']}" if res["shortfall"] else ""))
    if apply:
        cur.execute("update landing.ingest_runs set status='loaded', finished_at=now(), "
                    "row_count=%s where id=%s",
                    (sum(len(r["landed"]) for r in results), run_id))
        conn.commit()
    return results


def append_core_items(conn):
    """core.order_items for repaired lines older than the core refresh window, built
    exactly as core.refresh_orders step 6 builds them, append only. Newer days are
    rebuilt by the next 04:30 or 14:30 refresh. Before migration 245 no row had
    line_no >= 2, so those rows are precisely the restored and newly kept repeats."""
    cur = conn.cursor()
    cur.execute("""
        insert into core.order_items (order_id, link_status, landing_item_id,
          location_id, outlet_raw, business_date, invoice_no, item_name, category_name,
          sap_code, item_price, item_quantity, item_total)
        select pick.id,
          case when pick.id is not null then 'linked'
               when coalesce(nullif(trim(s.invoice_no), ''), '0') in ('0', 'O1') then 'orphan_junk_invoice'
               else 'orphan_no_order' end,
          s.id, core.map_location(s.restaurant_name), s.restaurant_name, s.business_date,
          nullif(trim(s.invoice_no), ''), s.item_name, s.category_name, s.sap_code,
          core.to_num(s.item_price), core.to_num(s.item_quantity), core.to_num(s.item_total)
        from landing.petpooja_order_summary_item s
        left join lateral (
          select c.id from core.orders c
          where c.business_date = s.business_date and c.outlet_raw = s.restaurant_name
            and c.invoice_no = nullif(trim(s.invoice_no), '')
            and coalesce(nullif(trim(s.invoice_no), ''), '0') not in ('0', 'O1')
          order by (c.source = 'online_report') desc, c.id
          limit 1
        ) pick on true
        where s.voided_at is null and s.line_no >= 2
          and s.business_date < current_date - %s
          and not exists (select 1 from core.order_items oi where oi.landing_item_id = s.id)
        returning 1""", (CORE_WINDOW_DAYS,))
    n = len(cur.fetchall())
    conn.commit()
    print(f"\ncore.order_items: {n} repaired line(s) appended for days older than "
          f"{CORE_WINDOW_DAYS} days (newer days rebuild at the next core refresh)")


def report(results, label):
    lines = sum(r["lines"] for r in results)
    units = sum((r["units"] for r in results), Decimal(0))
    value = sum((r["value"] for r in results), Decimal(0))
    other = sum(r["other"] for r in results)
    short = sum(r["shortfall"] for r in results)
    days = sum(1 for r in results if r["lines"])
    print(f"\n{label}: {lines} line(s) on {days} of {len(results)} day(s), {units} unit(s), "
          f"Rs {value:,.0f}; {other} other difference(s) left alone"
          + (f"; SHORTFALL {short}" if short else ""))
    return short


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--stored", action="store_true", help="days before 21 Jul 2026, stored files")
    ap.add_argument("--pull", action="store_true", help="short days from 21 Jul 2026, Petpooja")
    ap.add_argument("--apply", action="store_true", help="write (default: dry run)")
    ap.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "f72_repair_cache"),
                    help="folder for downloaded files, reused between dry run and --apply")
    args = ap.parse_args()
    if not (args.stored or args.pull):
        ap.error("choose --stored and/or --pull")
    load_env()
    os.makedirs(args.cache, exist_ok=True)
    print(("APPLY" if args.apply else "DRY RUN, nothing is written") + f"; cache {args.cache}")

    conn = connect()
    shortfall = 0
    try:
        if args.stored:
            plan, orphans = stored_plan(conn.cursor())
            conn.rollback()
            print(f"\n[stored] {sum(len(d) for d in plan.values())} day(s) in {len(plan)} "
                  f"stored file(s); {len(orphans)} day(s) with no stored file")
            results = []
            for path, days in sorted(plan.items(), key=lambda kv: min(kv[1])):
                print(f"\n{path}  ({min(days)} to {max(days)}, {len(days)} day(s))")
                local = fetch_receipt(path, args.cache)
                results += repair_days(conn, local, days, args.apply, receipt=(None, path))
            shortfall += report(results, "[stored] total")
        if args.pull:
            from scrape import scrape_and_download
            import ingest
            days = short_days(conn.cursor())
            conn.rollback()
            print(f"\n[pull] {len(days)} short day(s) from {CUTOFF}")
            results = []
            for frm, to, targets in windows(days):
                name = f"f72_items_{frm}_{to}.csv"
                local = os.path.join(args.cache, name)
                print(f"\nPetpooja item report {frm} to {to} for {len(targets)} day(s)")
                if not os.path.exists(local):
                    got = scrape_and_download(REPORT, from_date=frm.isoformat(),
                                              to_date=to.isoformat(), max_retries=1)
                    shutil.move(got, local)
                else:
                    print(f"  using the file pulled earlier: {local}")
                receipt = ingest.store_receipt(local) if args.apply else None
                results += repair_days(conn, local, targets, args.apply, receipt)
            shortfall += report(results, "[pull] total")
        if args.apply:
            append_core_items(conn)
    finally:
        conn.close()
    if shortfall:
        raise SystemExit(f"{shortfall} line(s) did not save; nothing else is wrong with "
                         f"the days that did. Investigate before re-running.")


if __name__ == "__main__":
    main()
