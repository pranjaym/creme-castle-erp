"""Every morning, check that last evening's jobs actually delivered, and mail the
owner about any that did not.

Added 23 August 2026, on Pranjay's instruction that a broken daily schedule must
always become a message. The evening workers already alert on a REAL failure, but
two kinds of broken evening produce no alert at all:
  1. no slot ever fired (Mac asleep or off through every slot, launchd unloaded)
  2. every slot deferred (exit 75: no network, data never materialised)
In both cases the worker code never reaches a failure path, so only an outside
observer can notice. This is that observer. Each evening job writes its date into
a .last_success stamp when it delivers; a stamp that does not say yesterday means
yesterday evening did not deliver, whatever the reason.

Runs from run_dashboard.sh after the dashboard work, never fatal to it. Alerts
once per day (.last_evening_stamp_alert), reusing alert_failure.send_alert, so the
morning retry slots cannot repeat the message.

Honest limit: this runs on the same Mac as the evening jobs. A Mac that stays
dead through the morning slots as well sends nothing. Only a watcher on another
machine can close that, and that is a deliberate, separate decision.

Pass --dry-run to print instead of send (for tests).
"""
import datetime as dt
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WORKERS = os.path.normpath(os.path.join(HERE, "..", "..", "kitchen", "workers"))
STAMP = os.path.join(HERE, ".last_evening_stamp_alert")

# name shown in the mail, stamp file, retry command
EVENING_JOBS = [
    ("Zomato evening pull (order history)",
     os.path.join(WORKERS, "zomato-ingest", ".last_success"),
     "bash ~/creme-castle-erp/kitchen/workers/zomato-ingest/run_zomato.sh --force"),
    ("Ratings mail",
     os.path.join(WORKERS, "cc-ratings", ".last_success"),
     "bash ~/creme-castle-erp/kitchen/workers/cc-ratings/run_ratings.sh --force"),
    ("Zomato business pull (enterprise reports, 08:30 morning ladder)",
     os.path.join(WORKERS, "zomato-business", ".last_success"),
     "bash ~/creme-castle-erp/kitchen/workers/zomato-business/run_zomato_business.sh --force"),
]


def _stamp_date(path):
    try:
        return open(path).read().strip()
    except OSError:
        return "(no stamp file: never succeeded on this machine)"


def main():
    dry = "--dry-run" in sys.argv[1:]
    sys.path.insert(0, HERE)
    import alert_failure

    today = dt.date.today()
    yesterday = (today - dt.timedelta(days=1)).isoformat()
    if not dry:
        try:
            if open(STAMP).read().strip() == today.isoformat():
                print("evening stamp check: already alerted today, skipping.")
                return 0
        except OSError:
            pass

    # A stamp saying yesterday OR today counts as delivered. Today matters since
    # 24 Aug 2026: zomato-business runs on a MORNING ladder (08:30 to 10:45), so
    # when this check fires from a late dashboard retry slot the job may already
    # have delivered today, and yesterday's stamp has been overwritten.
    ok_dates = (yesterday, today.isoformat())
    late = [(name, _stamp_date(path), retry)
            for name, path, retry in EVENING_JOBS
            if _stamp_date(path) not in ok_dates]
    if not late:
        print(f"evening stamp check: all {len(EVENING_JOBS)} evening jobs "
              f"delivered on {yesterday}.")
        return 0

    lines = []
    for name, got, retry in late:
        lines.append(f"  {name}")
        lines.append(f"    last delivered: {got}")
        lines.append(f"    to run by hand: {retry}")
        lines.append("")
    body = (
        f"Yesterday evening ({yesterday}), these scheduled jobs never delivered:\n\n"
        + "\n".join(lines) +
        "This is the silent kind of breakage: nothing crashed, so no failure mail\n"
        "was sent last night. Either no slot fired (Mac asleep or off through the\n"
        "evening) or every slot deferred and ran out of chances. The commands above\n"
        "re-run each job by hand; each job also self-heals its data window, so\n"
        "running them now recovers the missed evening.\n\n"
        "This check runs every morning and mails at most once per day.\n")
    subject = (f"CC evening job(s) missed last night, "
               f"{today.strftime('%d %b %Y (%A)')}")

    if dry:
        print(subject)
        print(body)
        return 0
    if alert_failure.send_alert(subject, body, include_log_tail=False):
        with open(STAMP, "w") as f:
            f.write(today.isoformat())
    return 0


if __name__ == "__main__":
    sys.exit(main())
