#!/usr/bin/env python3
"""
Daily Creme Castle sales dashboard, end to end and unattended.

  scrape yesterday's Petpooja order + item reports
    -> enrich the item side (Zomato/Swiggy, glossary, 7am business day)
    -> append to the running history (deduped)
    -> build cc_daily.html from the full history
    -> email it

Reuses the kitchen module's Petpooja scraper (workers/petpooja-ingest/scrape.py) and
the existing dashboard (../cc_dashboard). Seed the history once (history_store.seed_*)
before the first run.

Flags:
  --no-scrape        just rebuild the dashboard from existing history (fast; for testing)
  --days N           scrape a window of the last N days (default 3; order report caps at 5)
  --allow-unmapped   proceed even if new items lack a glossary alias (falls back to the raw
                     name and flags them in the email). Without it, the run STOPS and lists
                     the unmapped items so a human can add them first (Pranjay's rule).
  --no-email         build but do not send

Env for scraping: the PETPOOJA_* / SPINE_SUPABASE_* vars the scraper uses (session lives
in Supabase Storage). Env for email: DASH_SMTP_HOST, DASH_SMTP_PORT, DASH_EMAIL_SENDER,
DASH_EMAIL_APP_PASSWORD, DASH_EMAIL_RECIPIENTS (comma-separated).
"""
import argparse
import datetime as dt
import os
import re
import shutil
import smtplib
import sys
from email.message import EmailMessage

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
V5 = os.path.dirname(HERE)
# Paths are env-overridable so the same code runs on the Mac and in the container.
DASH_DIR = os.environ.get("CC_DASH_DIR", os.path.join(V5, "cc_dashboard"))
# The ingest worker lives in this same repo (kitchen/workers/petpooja-ingest), so the
# default is resolved relative to here. It used to point at the old standalone
# cremecastle-kitchen checkout, which does not exist in a fresh clone.
REPO_ROOT = os.path.dirname(V5)
SCRAPER_DIR = os.environ.get(
    "PETPOOJA_SCRAPER_DIR",
    os.path.join(REPO_ROOT, "kitchen", "workers", "petpooja-ingest"))
sys.path.insert(0, HERE)
import enrich
import history_store as hist

# How many days back the sub-order loader checks for holes. Seven covers a long
# weekend of failed mornings plus slack; the cost of a bigger number is only extra
# Petpooja scrapes on the (rare) morning something is actually missing.
SUB_ORDER_LOOKBACK_DAYS = 7


def _load_env_file():
    """Load auto/.env (KEY=VALUE lines) into os.environ if present. Keeps the Gmail
    App Password and recipients on disk, never in code or chat. Existing environment
    variables win (so the cloud runner's own env is not overridden)."""
    path = os.path.join(HERE, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def scrape_orders_today(scrape):
    """Pull TODAY's online orders as a second, separate export. Returns a path or None.

    Why this exists: the main order pull runs with Petpooja's server_type=2 ("Get old
    records"), whose history stops at the previous midnight. So an 8am run sees no
    order after 23:59, and the business day it is reporting on (04:00 to 03:59 next
    day) is short its own 00:00 to 03:59 tail. Measured on 29 Jul 2026: business day
    27 held 3,473 order rows ending 23:59:53 at 07:30, and only reached its true 3,797
    rows ending 01:59:46 when the NEXT morning's run swept the rows up, a full day
    late. server_type=1 is the "latest/current day" scope, which is where those rows
    sit until midnight rolls them into the history. The item report never had this
    problem: it honours a real date range and already carries the tail.

    NO DATE RANGE IS SET, and that is deliberate, not an oversight. Tested live on
    29 Jul 2026: asking this report for today's date makes the DateTimePicker clamp
    silently back to yesterday (the log read "date range set: 2026-07-29 to
    2026-07-29 (start widget:28 Jul 2026...)") and the export then returned 28 July,
    which is the one thing we do not need. Left alone, the "latest/current" scope
    returns today by itself: 371 rows, 00:00:05 to 08:45:27, including all 316 rows
    of the overnight tail. Do not "improve" this by adding the dates back.

    Best effort by design. The tail still self-heals a day later through the normal
    pull, so a failure here costs freshness, never data, and must not stop the email.
    scrape_and_download raises SystemExit (not Exception) when it gives up, hence the
    two-class except."""
    try:
        return scrape.scrape_and_download("online_orders", server_type="1", max_retries=0)
    except (Exception, SystemExit) as e:
        print(f"today's order pull FAILED, so the focal day's 00:00 to 03:59 tail will "
              f"arrive tomorrow instead: {type(e).__name__}: {str(e)[:160]}")
        return None


def scrape_and_append(days):
    """Pull the last `days` days of both reports, enrich items, append to history.
    Returns (unmapped_item_names, downloaded_files) where downloaded_files is a list
    of (report, path) pairs: the order report is pulled TWICE under two different
    Petpooja scopes (see scrape_orders_today), so a dict keyed by report would lose
    one of them. The paths are kept so the spine sync can reuse the SAME downloads:
    Petpooja is slow and rate limited, so it must be scraped once per morning."""
    sys.path.insert(0, SCRAPER_DIR)
    import scrape
    today = dt.date.today()
    frm = (today - dt.timedelta(days=days)).strftime("%Y-%m-%d")
    to = today.strftime("%Y-%m-%d")

    print(f"\n[1/3] scraping order report {frm}..{to} ...")
    ofile = scrape.scrape_and_download("online_orders", from_date=frm, to_date=to, max_retries=1)
    orders_raw = pd.read_excel(ofile)
    hist.append_orders(orders_raw)
    files = [("online_orders", ofile)]

    print(f"\n[2/3] scraping today's orders for the overnight tail ...")
    tfile = scrape_orders_today(scrape)
    if tfile:
        hist.append_orders(pd.read_excel(tfile))
        files.append(("online_orders", tfile))

    print(f"\n[3/3] scraping item report {frm}..{to} ...")
    ifile = scrape.scrape_and_download("order_summary_item", from_date=frm, to_date=to, max_retries=1)
    items_raw = pd.read_csv(ifile)
    enriched, unmapped = enrich.enrich(items_raw)
    if unmapped:
        # keep the dashboard buildable: fall back to the raw name so the item still counts
        enriched["Alias Name"] = enriched["Alias Name"].fillna(enriched["item_name"])
        enriched["Alias Category"] = enriched["Alias Category"].fillna("Unmapped")
    hist.append_items(enriched)
    files.append(("order_summary_item", ifile))
    return unmapped, files


def load_sub_order_wise():
    """Pull the Sub-Order Wise sales summary and land it in the spine, healing any
    day the last SUB_ORDER_LOOKBACK_DAYS is missing.

    Kept separate from the two line-level reports because this one is PRE-AGGREGATED
    over whatever range you ask for: a multi-day pull returns one merged set, so it
    has to be one day at a time.

    The lookback exists because of 31 July to 1 August 2026 (F15): this used to pull
    only yesterday, so a morning whose spine connection failed lost that day's
    summary permanently (both days had to be backfilled by hand). Now it asks the
    spine which days in the window have no rows and loads each one, oldest first, so
    a failed morning heals itself on the next successful run. A day Petpooja
    genuinely reports as empty stays "missing" and is re-tried until it ages out of
    the window: a few wasted scrapes, not a correctness problem, since the insert is
    idempotent on (business_date, row_hash).

    Caveat worth knowing: because Petpooja aggregates it server side, its day is
    Petpooja's own calendar day, not the spine's 04:00 business day. The stored
    business_date is therefore the report's date filter, and it will not tie out to
    the line-level reports to the last rupee across the 00:00 to 04:00 window.

    Best effort: never blocks the dashboard. Returns (summary, error); error is None
    when every missing day loaded, else a short string for the owner alert."""
    if not os.environ.get("SPINE_DATABASE_URL"):
        print("sub-order load skipped (SPINE_DATABASE_URL not set).")
        return None, None
    try:
        sys.path.insert(0, SCRAPER_DIR)
        import psycopg2
        import scrape
        import ingest
        today = dt.date.today()
        window = [(today - dt.timedelta(days=i)).isoformat()
                  for i in range(SUB_ORDER_LOOKBACK_DAYS, 0, -1)]      # oldest first
        table = ingest.REPORTS["sub_order_wise"]["table"]
        conn = psycopg2.connect(os.environ["SPINE_DATABASE_URL"])
        try:
            with conn.cursor() as cur:
                cur.execute(f"select distinct business_date from {table} "
                            f"where business_date >= %s", (window[0],))
                have = {r[0].isoformat() for r in cur.fetchall()}
            missing = [d for d in window if d not in have]
            if not missing:
                print(f"\n[spine] sub-order wise: all of the last "
                      f"{SUB_ORDER_LOOKBACK_DAYS} day(s) already present.")
                return "sub-order summary: nothing missing", None
            loaded, failed = [], []
            for day in missing:
                # scrape_and_download raises SystemExit (not Exception) when it gives
                # up, hence the two-class except; rollback because load_records only
                # commits on success and a dead transaction would poison the next day.
                try:
                    print(f"\n[spine] sub-order wise for {day} ...")
                    path = scrape.scrape_and_download("sub_order_wise", from_date=day,
                                                      to_date=day, max_retries=1)
                    records, skipped = ingest.REPORTS["sub_order_wise"]["parse"](path)
                    receipt = ingest.store_receipt(path)
                    ingest.load_records("sub_order_wise", records, skipped, conn, receipt)
                    loaded.append(f"{day} ({len(records)} rows)")
                except (Exception, SystemExit) as e:
                    conn.rollback()
                    print(f"sub-order load FAILED for {day} (dashboard unaffected): "
                          f"{type(e).__name__}: {str(e)[:200]}")
                    failed.append(f"{day} ({type(e).__name__})")
            summary = f"sub-order summary loaded: {', '.join(loaded) if loaded else 'none'}"
            error = ("sub-order load failed for " + ", ".join(failed)) if failed else None
            return summary, error
        finally:
            conn.close()
    except Exception as e:
        err = f"{type(e).__name__}: {str(e)[:200]}"
        print(f"sub-order load FAILED (dashboard unaffected): {err}")
        return None, f"sub-order load failed before any day could load ({err})"


def sync_spine(files):
    """Feed this morning's already-downloaded reports into the spine and verify the
    last few business days against them (see workers/petpooja-ingest/sync.py).

    Best effort by design: the dashboard email is the business-critical output, so a
    spine problem must never stop it going out. Returns (line, material, error): a
    short human summary, the days where something MATERIAL changed (status, amounts,
    charges), which are the only ones worth putting in front of a person, and an
    error string (None on success) so main() can raise the owner alert. The error
    return exists because of 31 July to 2 August 2026 (F15): a spine failure used to
    be invisible, since the run still exits 0 and the wrapper's alert never fires."""
    if not os.environ.get("SPINE_DATABASE_URL"):
        print("spine sync skipped (SPINE_DATABASE_URL not set).")
        return None, [], None
    try:
        sys.path.insert(0, SCRAPER_DIR)
        import psycopg2
        import sync as spine_sync
        conn = psycopg2.connect(os.environ["SPINE_DATABASE_URL"])
        try:
            results = []
            for report, path in files:
                print(f"\n[spine] verifying {report} ...")
                results += spine_sync.sync_file(conn, report, path)
            line, material = spine_sync.summarise(results)
            print(f"spine sync: {line}")
            return line, material, None
        finally:
            conn.close()
    except Exception as e:
        err = f"{type(e).__name__}: {str(e)[:200]}"
        print(f"spine sync FAILED (dashboard unaffected): {err}")
        return f"spine sync failed: {type(e).__name__}", [], err


def alert_spine_failure(errors):
    """Tell the owner the spine did not get today's data even though the dashboard
    went out. Exists because of 31 July to 2 August 2026 (F15): the spine steps are
    best effort, so the run exits 0, the wrapper's failure alert never fires, and the
    ERP portal's downloads silently freeze at the last loaded day. That outage ran
    unnoticed for two days. Best effort itself: an alert problem must not fail a run
    that has already delivered."""
    try:
        import alert_failure
        today = dt.date.today().strftime("%d %b %Y (%A)")
        subject = f"CC dashboard delivered BUT spine load FAILED, {today}"
        body = (
            "The dashboard was built and delivered normally, but the spine database "
            "did not get today's data:\n\n- " + "\n- ".join(errors) + "\n\n"
            "Until a run succeeds, the ERP portal's report downloads are frozen at "
            "the last loaded day. Orders and items heal automatically on the next "
            "successful run (rolling verify window); sub-order summaries heal within "
            f"a {SUB_ORDER_LOOKBACK_DAYS} day lookback.\n\n"
            "To retry the spine load by hand WITHOUT re-emailing the dashboard:\n"
            "  cd ~/creme-castle-erp/dashboard/auto && "
            "python3 run_daily.py --allow-unmapped --no-email\n"
        )
        if alert_failure.send_alert(subject, body):
            print("spine failure alert emailed to the owner.")
    except Exception as e:
        print(f"spine failure alert could not be sent: {type(e).__name__}: {str(e)[:160]}")


def zomato_catchup():
    """If last evening's Zomato pull never succeeded, pull a 7-day window ending
    DAY-BEFORE-YESTERDAY (whose data is certain to be materialised; yesterday's is
    not ready in the morning, F16). Keeps the spine's worst-case Zomato staleness
    at D+2 when evenings fail. See erp-plan/zomato-order-details-feed.md section 6.

    Runs as a SUBPROCESS on purpose: this file imports the Petpooja worker's
    `scrape`/`ingest` modules by path, and the Zomato worker has modules of the
    same names, so importing both in one interpreter would collide. Best effort:
    never blocks or fails the dashboard; run_evening.py sends its own owner alert
    on a real failure and exits 75 quietly when there is nothing it can do."""
    zdir = os.path.join(REPO_ROOT, "kitchen", "workers", "zomato-ingest")
    stamp = os.path.join(zdir, ".last_success")
    yesterday = (dt.date.today() - dt.timedelta(days=1)).isoformat()
    try:
        if os.path.exists(stamp) and open(stamp).read().strip() == yesterday:
            return
        if not os.path.isdir(zdir):
            return
        import subprocess
        end = (dt.date.today() - dt.timedelta(days=2)).isoformat()
        print(f"\n[zomato] last evening's pull missing; D-2 catch-up (window ending {end}) ...")
        r = subprocess.run([sys.executable, "run_evening.py", "--end", end],
                           cwd=zdir, timeout=2400)
        print(f"[zomato] catch-up exit {r.returncode} "
              f"(0 loaded, 75 deferred quietly, else alerted by run_evening itself)")
    except Exception as e:
        print(f"[zomato] catch-up skipped: {type(e).__name__}: {str(e)[:160]}")


def build_dashboard():
    """Run the existing dashboard against the history parquet. Returns (html_path,
    focal_date) where focal_date is the day the dashboard is FOR (the last complete
    day, read from the generated title), so the filename and subject can carry it."""
    os.environ["CC_ORDERS_PARQUET"] = hist.ORDERS_PARQUET
    os.environ["CC_ITEMS_PARQUET"] = hist.ITEMS_PARQUET
    sys.path.insert(0, DASH_DIR)
    cwd = os.getcwd()
    os.chdir(DASH_DIR)          # cc_dashboard writes cc_daily.html next to itself
    try:
        import cc_dashboard
        cc_dashboard.main()
    finally:
        os.chdir(cwd)
    src = os.path.join(DASH_DIR, "cc_daily.html")
    html = open(src, encoding="utf-8").read()
    m = re.search(r"CC Daily - (\d{4}-\d{2}-\d{2})", html)
    focal = m.group(1) if m else dt.date.today().isoformat()
    out = os.path.join(HERE, f"cc_daily_{focal}.html")     # dated file, the deliverable
    shutil.copy(src, out)
    shutil.copy(src, os.path.join(HERE, "cc_daily.html"))  # stable pointer to the latest
    print(f"dashboard for {focal} -> {os.path.basename(out)}")
    return out, focal


def archive_dashboard(html_path, focal):
    """Upload the built dashboard to the spine Storage bucket the ERP portal reads
    (DASH_HTML_BUCKET, default 'dashboard-html'), as cc_daily_<focal>.html. This is
    what makes 'latest + archive' work in the portal. Best effort: if the spine env
    is not set, skip quietly (the email path is unaffected). Upsert so a same-day
    re-run overwrites rather than erroring."""
    import requests
    base = os.environ.get("SPINE_SUPABASE_URL")
    key = os.environ.get("SPINE_SUPABASE_SERVICE_ROLE_KEY")
    if not base or not key:
        print("archive skipped (SPINE_SUPABASE_* not set).")
        return False
    bucket = os.environ.get("DASH_HTML_BUCKET", "dashboard-html")
    name = f"cc_daily_{focal}.html"
    url = f"{base.rstrip('/')}/storage/v1/object/{bucket}/{name}"
    with open(html_path, "rb") as f:
        data = f.read()
    try:
        r = requests.post(
            url,
            data=data,
            headers={
                "Authorization": f"Bearer {key}",
                "apikey": key,
                "Content-Type": "text/html",
                "x-upsert": "true",
            },
            timeout=120,
        )
        if r.status_code in (200, 201):
            print(f"archived {name} to bucket {bucket} ({len(data)//1024} KB)")
            return True
        print(f"archive failed ({r.status_code}): {r.text[:200]}")
        return False
    except Exception as e:
        print(f"archive error: {str(e)[:150]}")
        return False


def send_email(html_path, focal, unmapped, spine_line=None, spine_material=None):
    host = os.environ.get("DASH_SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("DASH_SMTP_PORT", "587"))
    sender = os.environ.get("DASH_EMAIL_SENDER")
    pw = os.environ.get("DASH_EMAIL_APP_PASSWORD")
    recips = [r.strip() for r in os.environ.get("DASH_EMAIL_RECIPIENTS", "").split(",") if r.strip()]
    if not (sender and pw and recips):
        print("email not configured (DASH_EMAIL_* not set); skipping send.")
        return False
    focal_nice = dt.datetime.strptime(focal, "%Y-%m-%d").strftime("%d %b %Y (%A)")
    msg = EmailMessage()
    msg["Subject"] = f"CC Daily Dashboard — {focal_nice}"
    msg["From"] = sender
    msg["To"] = ", ".join(recips)
    body = (f"Attached: the Creme Castle sales dashboard for {focal_nice} "
            f"(the last complete business day). Open the HTML in a browser.")
    expected = (dt.date.today() - dt.timedelta(days=1)).strftime("%Y-%m-%d")
    if focal != expected:
        body = (f"HEADS UP: this is for {focal_nice}, not yesterday ({expected}). "
                f"Yesterday's data was not complete/available when this ran (a partial "
                f"day is skipped on purpose).\n\n") + body
    if unmapped:
        body += ("\n\nNOTE: new items with no glossary mapping (counted under their raw "
                 "name for now, please add an Alias + Category):\n- " + "\n- ".join(unmapped))
    # Only surface the spine check when something MEANINGFUL moved (an order status,
    # an amount, a charge). Routine confirmations and cosmetic label changes stay in
    # the log: measured on real data, raw comparison shouts about ~292 rows a day
    # when only a handful matter.
    if spine_material:
        body += "\n\nDATA CHECK: the database was corrected against a fresh Petpooja pull:"
        for r in spine_material:
            body += (f"\n- {r['report']} {r['business_date']}: "
                     f"{r['material']} meaningful change(s)")
    msg.set_content(body)
    with open(html_path, "rb") as f:
        msg.add_attachment(f.read(), maintype="text", subtype="html",
                           filename=os.path.basename(html_path))
    with smtplib.SMTP(host, port, timeout=60) as s:
        s.starttls()
        s.login(sender, pw)
        s.send_message(msg)
    print(f"emailed to {', '.join(recips)}")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-scrape", action="store_true")
    ap.add_argument("--no-spine", action="store_true",
                    help="skip the spine load and verification (dashboard only)")
    # 4 days, not 3: the first and last business day of any pull are incomplete under
    # the 04:00 rule, so a 4-day window is what lets the spine sync fully verify three
    # business days per morning. The dashboard is unaffected (history dedups).
    ap.add_argument("--days", type=int, default=4)
    ap.add_argument("--allow-unmapped", action="store_true")
    ap.add_argument("--no-email", action="store_true")
    args = ap.parse_args()
    _load_env_file()

    # On the stateless cloud runner, the history lives in Supabase Storage: pull it in
    # before the run and push the updated files back after (DASH_CLOUD=1 in the container).
    cloud = os.environ.get("DASH_CLOUD") not in (None, "", "0", "false")
    if cloud:
        hist.pull_history()

    unmapped, files = [], []
    if not args.no_scrape:
        unmapped, files = scrape_and_append(args.days)
        if unmapped and not args.allow_unmapped:
            print("\nSTOP: these items have no glossary mapping. Add them to "
                  "glossary/item_glossary.csv (Alias + Category), or re-run with "
                  "--allow-unmapped:")
            for u in unmapped:
                print("   -", u)
            sys.exit(2)

    # Land this morning's reports in the spine and verify the recent days against
    # them, reusing the downloads above. Never blocks the dashboard, but failures
    # are collected and alerted after delivery (F15).
    spine_line, spine_material, spine_errors = None, [], []
    if files and not args.no_spine:
        spine_line, spine_material, err = sync_spine(files)
        if err:
            spine_errors.append(f"spine sync: {err}")
    if not args.no_spine and not args.no_scrape:
        _, err = load_sub_order_wise()
        if err:
            spine_errors.append(err)

    html, focal = build_dashboard()
    archive_dashboard(html, focal)          # push to the portal's archive bucket
    if not args.no_email:
        send_email(html, focal, unmapped, spine_line, spine_material)
    # After the deliverables on purpose: the dashboard and email must never wait on,
    # or die with, the alert path.
    if spine_errors:
        alert_spine_failure(spine_errors)
    # Zomato D-2 catch-up, also after the deliverables: it exists for the mornings
    # after a failed evening pull and must never delay or break the dashboard.
    if not args.no_scrape and not args.no_spine:
        zomato_catchup()
    if cloud:
        hist.push_history()
    print("\ndone.")


if __name__ == "__main__":
    main()
