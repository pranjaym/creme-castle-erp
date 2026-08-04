#!/usr/bin/env python3
"""
Evening Zomato pull, end to end and unattended (feed doc section 6).

  one range export covering the last 7 days ending yesterday
    -> land in landing.zomato_order_details (supersede semantics, revision history)
    -> same range again as the Customer details export (real-phone subset)
    -> change log per order date (the settling-horizon measurement)

Scheduled by launchd (in.cremecastle.zomato.plist) at 18:00 / 18:20 / 20:00 / 22:00
IST via run_zomato.sh, which owns the stamp, lock, network gate and caffeinate hold.

Exit codes (the wrapper's contract):
  0   success: the wrapper stamps the evening as delivered
  75  DEFER: data not ready (F16: Zomato's report job fails while yesterday is
      still materialising) or no session bootstrapped yet. No alert; the next
      slot, or tomorrow morning's D-2 catch-up in run_daily.py, picks it up.
  1   real failure: the wrapper leaves the stamp unwritten; an owner alert is
      sent from here, once per day.

Flags:
  --end YYYY-MM-DD   window end (default yesterday); the window is always 7 days
  --days N           window length (default 7; will shrink when the change log
                     proves Pranjay's 3-day settling estimate, feed doc s.6)
  --no-customer      skip the Customer details pass
Env: SPINE_* (db + storage), ZOMATO_* (see scrape.py). Reads dashboard/auto/.env.
"""
import argparse
import datetime as dt
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
AUTO = os.path.join(REPO, "dashboard", "auto")
ALERT_STAMP = os.path.join(HERE, ".last_alert")

sys.path.insert(0, HERE)
import ingest
import scrape


def _load_env_file():
    """Same contract as run_daily.py: dashboard/auto/.env, existing env wins."""
    path = os.path.join(AUTO, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def _alert_once(subject, body):
    """Owner alert via the dashboard's alert module, at most once per day."""
    today = dt.date.today().isoformat()
    try:
        if os.path.exists(ALERT_STAMP) and open(ALERT_STAMP).read().strip() == today:
            return
        sys.path.insert(0, AUTO)
        import alert_failure
        if alert_failure.send_alert(subject, body):
            with open(ALERT_STAMP, "w") as f:
                f.write(today)
            print("owner alert sent.")
    except Exception as e:
        print(f"alert could not be sent: {type(e).__name__}: {str(e)[:160]}")


def pull_window(end, days, include_customer=True):
    """Pull and land both exports for the window. Returns a list of error strings
    (empty on full success). Raises scrape.ExportNotReady through to the caller."""
    import psycopg2
    start = end - dt.timedelta(days=days - 1)
    errors = []

    path = scrape.scrape_and_download("order_history", start, end)
    records, skipped, dupes = ingest.parse_export(path)
    receipt = ingest.store_receipt(path)
    conn = psycopg2.connect(os.environ["SPINE_DATABASE_URL"])
    try:
        ingest.load_records(records, skipped, dupes, conn, receipt, "order_history")

        if include_customer:
            # Best effort: the phone-subset pass upgrades identity but must not
            # fail an evening whose order data already landed. ExportNotReady here
            # is just logged: the same orders re-enter tomorrow's window anyway.
            try:
                cpath = scrape.scrape_and_download("customer_details", start, end)
                crecords, cskipped, cdupes = ingest.parse_export(cpath)
                creceipt = ingest.store_receipt(cpath)
                ingest.load_records(crecords, cskipped, cdupes, conn, creceipt,
                                    "customer_details")
            except scrape.ExportNotReady as e:
                print(f"customer details not ready, will ride tomorrow's window: {e}")
            except Exception as e:
                errors.append(f"customer_details: {type(e).__name__}: {str(e)[:200]}")
    finally:
        conn.close()
    return errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--end")
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--no-customer", action="store_true")
    args = ap.parse_args()
    _load_env_file()

    end = (dt.date.fromisoformat(args.end) if args.end
           else dt.date.today() - dt.timedelta(days=1))

    if not scrape.have_session():
        print("no Zomato session bootstrapped yet; run "
              "`python3 scrape.py bootstrap` once from the Mac. Deferring quietly.")
        sys.exit(75)

    try:
        errors = pull_window(end, args.days, include_customer=not args.no_customer)
    except scrape.ExportNotReady as e:
        print(f"DEFER: {e}")
        sys.exit(75)
    except (Exception, SystemExit) as e:
        msg = f"{type(e).__name__}: {str(e)[:300]}"
        print(f"FAILED: {msg}")
        _alert_once(
            f"CC Zomato pull FAILED, {dt.date.today():%d %b %Y}",
            "The evening Zomato order-details pull failed with a real error (not "
            "the data-lag defer):\n\n  " + msg + "\n\n"
            "The spine keeps yesterday's gap until a pull succeeds; tomorrow's "
            "8 am run attempts a day-before-yesterday catch-up automatically.\n\n"
            "To retry by hand:\n  cd ~/creme-castle-erp/kitchen/workers/zomato-ingest "
            "&& python3 run_evening.py\n")
        sys.exit(1)

    if errors:
        _alert_once(
            f"CC Zomato pull PARTIAL, {dt.date.today():%d %b %Y}",
            "Order history landed, but a secondary step failed:\n\n- "
            + "\n- ".join(errors) + "\n")
    print("done.")


if __name__ == "__main__":
    main()
