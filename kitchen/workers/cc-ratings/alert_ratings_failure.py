"""Email a short alert when the evening ratings mail fails.

Added 23 August 2026 after the automation audit. The wrapper (run_ratings.sh)
returned an honest exit code to launchd, but nothing turned that code into a
message, so a broken evening would have looked exactly like a quiet one. The
dashboard already solved this (dashboard/auto/alert_failure.py); this file
reuses that module's send_alert so the mailbox, the app password, and the
recipient rule live in exactly one place.

Called by run_ratings.sh as: alert_ratings_failure.py <exit-status>
Only called when the network was already proven reachable, so the send should
work. Pass --dry-run to print the mail instead of sending it (for tests).
"""
import datetime as dt
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
AUTO = os.path.normpath(os.path.join(HERE, "..", "..", "..", "dashboard", "auto"))
LOG = os.path.join(HERE, "run.log")


def _tail(path, n=40):
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return "".join(f.readlines()[-n:])
    except OSError as exc:
        return f"(could not read {path}: {exc})"


def main():
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    dry = "--dry-run" in sys.argv[1:]
    status = args[0] if args else "?"
    today = dt.date.today().strftime("%d %b %Y (%A)")
    subject = f"CC Ratings mail FAILED, {today} (exit {status})"
    body = (
        f"The evening ratings run failed with exit status {status}.\n"
        f"No ratings mail was sent to the team.\n\n"
        f"The scheduler will retry at the remaining evening slots, and this alert is\n"
        f"sent only once per day, so silence after this means either a retry succeeded\n"
        f"or nothing further ran.\n\n"
        f"To retry by hand:\n"
        f"  bash ~/creme-castle-erp/kitchen/workers/cc-ratings/run_ratings.sh --force\n\n"
        f"Last 40 lines of the ratings run.log:\n{'-' * 60}\n{_tail(LOG)}"
    )
    if dry:
        print(subject)
        print(body)
        return 0
    sys.path.insert(0, AUTO)
    import alert_failure
    sent = alert_failure.send_alert(subject, body, include_log_tail=False)
    return 0 if sent else 1


if __name__ == "__main__":
    sys.exit(main())
