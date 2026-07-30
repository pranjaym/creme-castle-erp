"""Email a short alert when the morning dashboard run fails.

Added 30 July 2026. That morning the 8am job died on a network-less dark wake and,
because the wrapper ended in an `echo`, reported success to launchd. There was no
email and no failure signal either, so the only symptom was an absence that went
unnoticed for hours. A failed morning now says so.

Called by run_dashboard.sh as: alert_failure.py <exit-status>
Only called when the network was already proven reachable, so the send should work.

Alerts go to DASH_ALERT_RECIPIENTS if set, otherwise to the FIRST address in
DASH_EMAIL_RECIPIENTS only. A broken run is an operations problem for the owner, not
something the wider dashboard list can act on.
"""
import datetime as dt
import os
import smtplib
import sys
from email.message import EmailMessage

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "run.log")


def _load_env_file():
    """Load auto/.env (KEY=VALUE lines) into os.environ if present. Same contract as
    run_daily.py: existing environment variables win."""
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


def _tail(path, n=60):
    """Last n lines of the log, for pasting into the alert. The cause is almost always
    in the final few lines, and this saves opening a terminal to find out."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return "".join(f.readlines()[-n:])
    except OSError as exc:
        return f"(could not read {path}: {exc})"


def main():
    _load_env_file()
    status = sys.argv[1] if len(sys.argv) > 1 else "?"

    host = os.environ.get("DASH_SMTP_HOST", "smtp.gmail.com")
    port = int(os.environ.get("DASH_SMTP_PORT", "587"))
    sender = os.environ.get("DASH_EMAIL_SENDER")
    pw = os.environ.get("DASH_EMAIL_APP_PASSWORD")

    recips = [r.strip() for r in os.environ.get("DASH_ALERT_RECIPIENTS", "").split(",") if r.strip()]
    if not recips:
        everyone = [r.strip() for r in os.environ.get("DASH_EMAIL_RECIPIENTS", "").split(",") if r.strip()]
        recips = everyone[:1]
    if not (sender and pw and recips):
        print("alert not sent: DASH_EMAIL_* not configured.")
        return 1

    today = dt.date.today().strftime("%d %b %Y (%A)")
    msg = EmailMessage()
    msg["Subject"] = f"CC Dashboard run FAILED, {today} (exit {status})"
    msg["From"] = sender
    msg["To"] = ", ".join(recips)
    msg.set_content(
        f"The daily dashboard run failed this morning with exit status {status}.\n"
        f"No dashboard was built and no dashboard email was sent.\n\n"
        f"The scheduler will retry at the remaining slots today, and this alert is sent\n"
        f"only once per day, so silence after this means either a retry succeeded or\n"
        f"nothing further ran.\n\n"
        f"To retry by hand:\n"
        f"  bash ~/creme-castle-erp/dashboard/auto/run_dashboard.sh --force\n\n"
        f"Last 60 lines of run.log:\n"
        f"{'-' * 60}\n"
        f"{_tail(LOG)}"
    )

    with smtplib.SMTP(host, port, timeout=60) as s:
        s.starttls()
        s.login(sender, pw)
        s.send_message(msg)
    print(f"failure alert emailed to {', '.join(recips)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
