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
      still materialising), no session bootstrapped yet, a PARTIAL run where
      order history landed but a secondary export did not (F22), or a TRANSPORT
      failure while another slot is still to come (F23). No stamp, so the next
      slot, or tomorrow morning's D-2 catch-up in run_daily.py, picks it up.
      Only the PARTIAL case alerts, and then once per day.
  1   real failure: the wrapper leaves the stamp unwritten; an owner alert is
      sent from here, once per day. A transport failure only reaches this once
      the evening has run out of slots.

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

# How many trailing days each evening re-reads. Was 7; cut to 3 on 4 Aug 2026 at
# Pranjay's direction after the first same-shape comparison showed no changes on
# days 2 to 7 (the earlier "still 20% moving" was xlsx-vs-CSV export-shape noise).
DAILY_WINDOW_DAYS = 3

# PLATFORM LIMIT, discovered live 4 Aug 2026: with more than 10 outlets mapped
# (we have 45), Zomato refuses any range longer than 10 days. The page renders
# "You have selected more than 10 outlets and a date range exceeding 10 days" and
# the export never starts. So no window here may exceed 10, and anything wider has
# to be walked in chunks (see backfill guidance in the feed doc).
MAX_WINDOW_DAYS = 10

# Once a week the window is widened to the platform maximum, because a 3-day daily
# window can no longer SEE a change that arrives on day 4 or later: ratings,
# complaints and refunds do land late, and without this a late correction would
# never reach the spine and the change log could never prove whether 3 is enough.
# Costs one extra export a week. Set to 0 (or pass --no-weekly-sweep) to disable.
WEEKLY_SWEEP_DAYS = 10
WEEKLY_SWEEP_WEEKDAY = 0          # Monday


# The evening's last launchd slot (in.cremecastle.zomato.plist: 18:00, 18:20,
# 20:00, 22:00). Before it, a network failure has more chances coming and must
# stay quiet; at it, nobody else is coming and the owner has to be told.
LAST_SLOT_HOUR = 22

# Failure text that means "the network was not there", for engines that do not
# raise a typed exception (Playwright, mainly).
_TRANSPORT_STRINGS = (
    "connection aborted", "connection refused", "connection reset",
    "max retries exceeded", "timed out", "timeout", "ssl", "eof occurred",
    "temporary failure in name resolution", "name or service not known",
    "could not translate host name", "network is unreachable",
    "no route to host", "can't assign requested address",
    "err_internet_disconnected", "err_name_not_resolved",
    "ns_error_unknown_host", "ns_error_net", "err_connection",
)


def _is_transport_error(e):
    """True when the failure is the network, not the data and not the code.

    Deliberately NOT transport: a 4xx from Storage (wrong key, missing bucket)
    and a parse failure. No number of extra slots can fix either, so they must
    alarm on the first one rather than sit quiet until 22:00.

    Bare OSError is not treated as transport either: requests wraps real socket
    errors into ConnectionError and psycopg2 into OperationalError, so a loose
    OSError here is far more likely a missing file than a dead network.
    """
    import requests
    if isinstance(e, requests.exceptions.HTTPError):
        status = getattr(getattr(e, "response", None), "status_code", None)
        return status is None or status >= 500
    if isinstance(e, (requests.exceptions.ConnectionError,
                      requests.exceptions.Timeout)):
        return True
    try:
        import psycopg2
        if isinstance(e, psycopg2.OperationalError):
            return True
    except Exception:
        pass
    text = f"{type(e).__name__}: {e}".lower()
    return any(t in text for t in _TRANSPORT_STRINGS)


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

    # Both exports in ONE browser session: the page loads once and the date range
    # is set once. Two retries, not zero, because transport-level failures (a
    # dropped Wi-Fi association on a laptop, a refused connection) are transient
    # and cost one browser launch to recover, whereas giving up wakes the owner
    # with an alert for something that would have worked on the next try.
    # Data-lag failures are NOT retried here; ExportNotReady goes straight up so
    # the slot defers (F16).
    wanted = ["order_history"] + (["customer_details"] if include_customer else [])
    paths = scrape.scrape_exports(wanted, start, end, max_retries=2, retry_wait_s=45)

    conn = psycopg2.connect(os.environ["SPINE_DATABASE_URL"])
    try:
        for key in wanted:
            path = paths.get(key)
            if not path:
                errors.append(f"{key}: no file returned")
                continue
            try:
                records, skipped, dupes = ingest.parse_export(path)
                receipt = ingest.store_receipt(path)
                ingest.load_records(records, skipped, dupes, conn, receipt, key)
            except Exception as e:
                # The order history load is the point of the run; a failure in the
                # customer-phone pass must not lose the rest.
                conn.rollback()
                if key == "order_history":
                    raise
                errors.append(f"{key}: {type(e).__name__}: {str(e)[:200]}")
    finally:
        conn.close()
    return errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--end")
    # 3 days, Pranjay's call (4 Aug 2026), backed by the first same-shape
    # comparison: days 2 to 7 showed ZERO changes once the export shape was held
    # constant (the earlier "20% still moving" was xlsx-vs-CSV noise).
    ap.add_argument("--days", type=int, default=DAILY_WINDOW_DAYS)
    ap.add_argument("--no-customer", action="store_true")
    ap.add_argument("--no-weekly-sweep", action="store_true",
                    help="skip the weekly deeper re-read (see WEEKLY_SWEEP_DAYS)")
    args = ap.parse_args()
    _load_env_file()
    started_at = dt.datetime.now()

    end = (dt.date.fromisoformat(args.end) if args.end
           else dt.date.today() - dt.timedelta(days=1))

    # Weekly deeper sweep. A 3-day daily window cannot SEE a rating, complaint or
    # refund that lands on day 4 or later, so without this such a correction would
    # never reach the spine and the change log could never prove whether 3 days is
    # in fact enough. One extra export a week buys both.
    days = args.days
    if (not args.no_weekly_sweep and args.days == DAILY_WINDOW_DAYS
            and WEEKLY_SWEEP_DAYS and end.weekday() == WEEKLY_SWEEP_WEEKDAY):
        days = WEEKLY_SWEEP_DAYS
        print(f"weekly sweep: widening the window to {days} days "
              f"(daily default is {DAILY_WINDOW_DAYS})")
    if days > MAX_WINDOW_DAYS:
        print(f"window {days} days exceeds Zomato's {MAX_WINDOW_DAYS}-day limit for "
              f"multi-outlet accounts; clamping to {MAX_WINDOW_DAYS}")
        days = MAX_WINDOW_DAYS

    if not scrape.have_session():
        print("no Zomato session bootstrapped yet; run "
              "`python3 scrape.py bootstrap` once from the Mac. Deferring quietly.")
        sys.exit(75)

    try:
        errors = pull_window(end, days, include_customer=not args.no_customer)
    except scrape.ExportNotReady as e:
        print(f"DEFER: {e}")
        sys.exit(75)
    except (Exception, SystemExit) as e:
        msg = f"{type(e).__name__}: {str(e)[:300]}"
        # A transport failure is the network being absent, which is exactly what
        # the later evening slots exist to absorb. Until 18 Aug 2026 the first
        # slot alarmed immediately, telling Pranjay "the spine keeps yesterday's
        # gap" while three more slots were still to come; that evening the 20:00
        # slot then landed the full sweep and the alert was already false by the
        # time he read it (F23). So: defer quietly while a slot remains, and
        # escalate only once the evening has genuinely run out of chances.
        # started_at, not "now": a slot that begins at 20:23 and dies at 22:05 is
        # still the 20:00 slot, and the 22:00 one has not had its turn yet.
        if _is_transport_error(e) and started_at.hour < LAST_SLOT_HOUR:
            print(f"DEFER (network unreachable): {msg}")
            print("another slot is still to come tonight; leaving the evening "
                  "unstamped so it retries. No alert while slots remain.")
            sys.exit(75)
        print(f"FAILED: {msg}")
        _alert_once(
            f"CC Zomato pull FAILED, {dt.date.today():%d %b %Y}",
            "The evening Zomato order-details pull failed with a real error (not "
            "the data-lag defer), and no further automatic retry is coming "
            "tonight: either this was the evening's last slot, or the fault is "
            "one that more slots cannot fix (a 4xx from Storage, a parse "
            "failure). A network outage earlier in the evening defers quietly "
            "instead and does not send this mail.\n\n  " + msg + "\n\n"
            "The spine keeps yesterday's gap until a pull succeeds; tomorrow's "
            "8 am run attempts a day-before-yesterday catch-up automatically.\n\n"
            "To retry by hand:\n  cd ~/creme-castle-erp/kitchen/workers/zomato-ingest "
            "&& python3 run_evening.py\n")
        sys.exit(1)

    if errors:
        _alert_once(
            f"CC Zomato pull PARTIAL, {dt.date.today():%d %b %Y}",
            "Order history landed, but a secondary step failed:\n\n- "
            + "\n- ".join(errors) + "\n\n"
            "The evening is NOT stamped as delivered, so the next slot retries "
            "the missing export on its own. Re-running is safe: both loads "
            "supersede by row_hash, so an unchanged re-pull writes nothing.\n")
        # Exit 75, not 0. Until 17 Aug 2026 a partial returned 0, which let the
        # wrapper stamp the evening as delivered and so gave a partial exactly one
        # attempt per day: the 20:00 and 22:00 slots skipped without retrying
        # (F22). 75 is the existing defer contract: no stamp, next slot tries
        # again. The alert has already gone out above, once per day.
        print("PARTIAL: deferring so the next slot retries the missing export.")
        sys.exit(75)
    print("done.")


if __name__ == "__main__":
    main()
