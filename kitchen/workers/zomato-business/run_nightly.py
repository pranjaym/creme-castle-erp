"""Nightly pull for the Zomato enterprise business reports.

    python3 run_nightly.py              # 10-day rolling window ending yesterday
    python3 run_nightly.py --days 21    # wider catch-up
    python3 run_nightly.py --shapes quality,segment

WINDOW: 10 days, ending yesterday. Measured, not guessed. Re-pulling August over
days already held (catalogue doc section 18) showed how long Zomato keeps revising
a day:

    day age    quality rows changed      ads rows changed
    1 day      41 of 45                  123 of 135
    3 days      5 of 45                   75 of 135
    6 days      1 of 45                   76 of 135

Quality is effectively settled by day four. **Ads is still moving at six days with
no sign of tapering.** A 3-day window would look right on the quality numbers and
would quietly freeze ad spend and ROI at wrong values. Ten days covers the ads tail
and costs about six minutes a night, so being generous is safer than being clever.

A wide window also removes any dependence on yesterday being materialised: if it is
not ready, days 2 to 10 still load correctly and yesterday is picked up tomorrow.

EXIT CODES, the house contract (same as workers/zomato-ingest/run_evening.py):
   0  loaded
  75  defer: transport failure, or reports have not arrived yet. No stamp, no
      alert, the next slot retries.
   1  a fault more slots cannot fix (parse failure, unknown shape, bad data).
      Alerts once.
"""
from __future__ import annotations

import argparse
import os
import socket
import ssl
import sys
import traceback
from datetime import date, datetime, timedelta, timezone

import requests as _rq

import harvest as H
import load as L
import parse as P
import request as R
import run_business as RB

HERE = os.path.dirname(os.path.abspath(__file__))
SESSION = os.path.expanduser(os.environ.get("ZOMATO_SESSION_FILE",
                                            "~/.creme-castle/zomato_session.json"))
# Per-shape rolling windows, set from the measured settling evidence rather than a
# single guess (catalogue doc section 18):
#
#   day age    quality rows changed      ads rows changed
#   1 day      41 of 45                  123 of 135
#   3 days      5 of 45                   75 of 135
#   6 days      1 of 45                   76 of 135
#
# Quality, segment and order are effectively settled by day four, so 5 days is
# comfortable. ADS IS STILL MOVING AT SIX DAYS with no sign of tapering, and we have
# no evidence of where it stops. A 5-day window would silently freeze ad spend and
# ROI at wrong values, which is the exact inconsistency this job exists to remove.
#
# Ads files are tiny (135 rows a day, against 2,025 for segment), so the ads window
# is set to the maximum Zomato allows. Pulling 31 days of ads every night costs
# seconds and removes the question entirely.
DEFAULT_DAYS = 5
SHAPE_DAYS = {"ads_sp": 31, "ads_nrl": 31}
DEFER = 75

TRANSPORT = (socket.timeout, socket.gaierror, ssl.SSLError, ConnectionError,
             _rq.exceptions.Timeout, _rq.exceptions.ConnectionError)


def alert(subject, body):
    """Once-per-run owner alert. Uses the same mailbox the reports arrive in."""
    import smtplib
    from email.message import EmailMessage
    try:
        user = os.environ["CC_MAIL_USER"]
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = user, user, subject
        msg.set_content(body)
        s = smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=45)
        s.login(user, os.environ["CC_MAIL_APP_PASSWORD"].replace(" ", ""))
        s.send_message(msg); s.quit()
        RB.log("owner alert sent")
    except Exception as e:
        RB.log(f"alert could not be sent: {type(e).__name__}: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=DEFAULT_DAYS)
    ap.add_argument("--shapes", default=",".join(RB.SHAPES))
    ap.add_argument("--wait", type=int, default=1500)
    ap.add_argument("--no-alert", action="store_true")
    args = ap.parse_args()

    L.load_env_file(os.path.join(HERE, "..", "..", ".env.local"))
    shapes = [s for s in args.shapes.split(",") if s]

    d2 = date.today() - timedelta(days=1)          # never ask for today or later:
    groups = {}                                    # a future end date is accepted
    for sh in shapes:                              # and then silently ignored
        days = SHAPE_DAYS.get(sh, args.days)
        if days > 31:
            RB.log(f"FATAL: {sh} window of {days} days exceeds Zomato's 31"); return 1
        groups.setdefault(days, []).append(sh)

    RB.log("nightly windows: " + "; ".join(
        f"{','.join(sh)} = {d2 - timedelta(days=d-1)} to {d2} ({d}d)"
        for d, sh in sorted(groups.items())))

    since = datetime.now(timezone.utc)
    # One window per distinct length. Reports are matched back to their window from
    # the date range printed in the mail body, so the groups cannot cross-contaminate.
    plan = [(d2 - timedelta(days=d - 1), d2, sh) for d, sh in sorted(groups.items())]
    d1 = plan[0][0]
    try:
        res = []
        for w1, w2, sh in plan:
            res += R.request_reports(SESSION, sh, w1, w2)
    except TRANSPORT as e:
        RB.log(f"DEFER, could not reach Zomato: {type(e).__name__}: {e}"); return DEFER
    except Exception:
        RB.log("FATAL requesting reports:\n" + traceback.format_exc())
        if not args.no_alert:
            alert("Zomato business pull failed", traceback.format_exc()[-3000:])
        return 1

    for r in res:
        RB.log(f"  {r['shape']:9s} metrics={r['metrics']:3d} http={r['status']}")
    bad = [r for r in res if r["status"] != 200]
    if bad:
        RB.log(f"DEFER, Zomato refused: {[(b['shape'], b['status']) for b in bad]}")
        return DEFER

    links = []
    for w1, w2, sh in plan:
        links += RB.wait_for_reports(since, len(sh), timeout_s=args.wait, window=(w1, w2))
    if not links:
        RB.log("DEFER: no reports arrived; a later slot retries"); return DEFER
    if len(links) < len(shapes):
        RB.log(f"partial: {len(links)}/{len(shapes)} arrived; loading those and deferring")

    conn = L.connect(); conn.autocommit = False
    total, loaded = 0, []
    try:
        with conn.cursor() as cur:
            for item in links:
                key, rtype = H.resolve_tracker(item["tracker"])
                text = H.download_csv(H.presigned_for(key, rtype, SESSION))
                shape = P.detect_shape(text)
                w = next(((a, b) for a, b, sh in plan if shape in sh), (d1, d2))
                rows, counts = RB.load_csv(cur, shape, text, w)
                total += rows; loaded.append(shape)
                RB.log(f"  loaded {shape:9s} {rows:>8,} rows  {counts}")
        conn.commit()
    except TRANSPORT as e:
        conn.rollback(); RB.log(f"DEFER, transport during load: {type(e).__name__}: {e}")
        return DEFER
    except Exception:
        conn.rollback(); RB.log("FATAL loading:\n" + traceback.format_exc())
        if not args.no_alert:
            alert("Zomato business load failed", traceback.format_exc()[-3000:])
        return 1
    finally:
        conn.close()

    RB.log(f"committed {total:,} rows across {len(loaded)} shapes")
    return 0 if len(links) >= len(shapes) else DEFER


if __name__ == "__main__":
    sys.exit(main())
