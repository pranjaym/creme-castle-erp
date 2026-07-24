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
SCRAPER_DIR = os.environ.get(
    "PETPOOJA_SCRAPER_DIR",
    "/Users/Pranjay/Library/Mobile Documents/com~apple~CloudDocs/"
    "Downloads Drive/cremecastle-kitchen/workers/petpooja-ingest")
sys.path.insert(0, HERE)
import enrich
import history_store as hist


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


def scrape_and_append(days):
    """Pull the last `days` days of both reports, enrich items, append to history.
    Returns the sorted list of item names that had no glossary alias."""
    sys.path.insert(0, SCRAPER_DIR)
    import scrape
    today = dt.date.today()
    frm = (today - dt.timedelta(days=days)).strftime("%Y-%m-%d")
    to = today.strftime("%Y-%m-%d")

    print(f"\n[1/2] scraping order report {frm}..{to} ...")
    ofile = scrape.scrape_and_download("online_orders", from_date=frm, to_date=to, max_retries=1)
    orders_raw = pd.read_excel(ofile)
    hist.append_orders(orders_raw)

    print(f"\n[2/2] scraping item report {frm}..{to} ...")
    ifile = scrape.scrape_and_download("order_summary_item", from_date=frm, to_date=to, max_retries=1)
    items_raw = pd.read_csv(ifile)
    enriched, unmapped = enrich.enrich(items_raw)
    if unmapped:
        # keep the dashboard buildable: fall back to the raw name so the item still counts
        enriched["Alias Name"] = enriched["Alias Name"].fillna(enriched["item_name"])
        enriched["Alias Category"] = enriched["Alias Category"].fillna("Unmapped")
    hist.append_items(enriched)
    return unmapped


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


def send_email(html_path, focal, unmapped):
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
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--allow-unmapped", action="store_true")
    ap.add_argument("--no-email", action="store_true")
    args = ap.parse_args()
    _load_env_file()

    # On the stateless cloud runner, the history lives in Supabase Storage: pull it in
    # before the run and push the updated files back after (DASH_CLOUD=1 in the container).
    cloud = os.environ.get("DASH_CLOUD") not in (None, "", "0", "false")
    if cloud:
        hist.pull_history()

    unmapped = []
    if not args.no_scrape:
        unmapped = scrape_and_append(args.days)
        if unmapped and not args.allow_unmapped:
            print("\nSTOP: these items have no glossary mapping. Add them to "
                  "glossary/item_glossary.csv (Alias + Category), or re-run with "
                  "--allow-unmapped:")
            for u in unmapped:
                print("   -", u)
            sys.exit(2)

    html, focal = build_dashboard()
    if not args.no_email:
        send_email(html, focal, unmapped)
    if cloud:
        hist.push_history()
    print("\ndone.")


if __name__ == "__main__":
    main()
