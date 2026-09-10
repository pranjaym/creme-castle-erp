"""Daily pull of the three Petpooja witness screens into the spine.

What one run does (default window: yesterday, IST):
  1. pull the saved Petpooja session from its Storage copy (no login, no OTP);
  2. read the outlet list from the log page and refresh landing.petpooja_outlet_map;
  3. for every outlet and every day in the window, read the Online Store Log
     and the Online Item On/Off Log through the portal's search endpoint (plain
     HTTP, 15 rows a page) and load them, insert-or-supersede;
  4. unless --no-activity: point the session at each outlet in turn, read the
     Online Order Activity Report, load it, and put the session back on
     All Outlets (verified; if the restore fails the run alerts, because the
     8am scrape depends on it).
Exit codes (the wrapper stamps only on 0):
  0   loaded;  75  defer (transport blip, no network, or the session copy
  could not be fetched: no stamp, no alert, the next slot retries);
  1   real failure, alerted (session expired = F24, a parse contract broke,
  or the scope restore could not be verified).
Flags: --from YYYY-MM-DD --to YYYY-MM-DD (backfill window), --outlet ID[,ID,...]
(only those outlets), --no-activity, --only-activity, --dry-run (parse and count,
write nothing).
"""
from __future__ import annotations
import argparse
import os
import sys
import time
import traceback
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import load as L  # noqa: E402

L.load_env_file(os.path.join(HERE, "..", "..", ".env.local"))

import fetch as F  # noqa: E402  (imports the sibling scraper; needs the env loaded first)
import parse as P  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))
LAST_SLOT_HOUR = 15      # after this hour IST a transport failure alerts instead of deferring
TRANSPORT = (ConnectionError, TimeoutError, OSError)


def log(*a):
    print(*a, flush=True)


ALERT_STAMP = os.path.join(HERE, ".last_alert")


def alert(subject, body):
    """One owner mail per day, and none at all when CC_NO_ALERT is set (the
    backfill sets it). Added 10 Sep 2026 after a 38-day backfill loop sent one
    mail per failing day overnight: the fault was worth ONE message, not 17."""
    import smtplib
    from email.message import EmailMessage
    if os.environ.get("CC_NO_ALERT"):
        log(f"alert suppressed (CC_NO_ALERT): {subject}")
        return
    today = datetime.now(IST).date().isoformat()
    try:
        if open(ALERT_STAMP).read().strip() == today:
            log(f"alert already sent today, not repeating: {subject}")
            return
    except FileNotFoundError:
        pass
    try:
        user = os.environ["CC_MAIL_USER"]
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = user, user, subject
        msg.set_content(body)
        s = smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=45)
        s.login(user, os.environ["CC_MAIL_APP_PASSWORD"].replace(" ", ""))
        s.send_message(msg)
        s.quit()
        with open(ALERT_STAMP, "w") as f:
            f.write(today)
        log("owner alert sent")
    except Exception as e:
        log(f"alert could not be sent: {type(e).__name__}: {e}")


def is_transport(e: Exception) -> bool:
    """A network problem, not a data problem: defer and let the next slot retry.
    psycopg2's OperationalError / InterfaceError belong here. They are what a
    keepalive-killed socket raises ("could not receive data from server"), and
    on 9 Sep 2026 the overnight backfill mailed 17 of those as real failures."""
    import requests
    import psycopg2
    if isinstance(e, (psycopg2.OperationalError, psycopg2.InterfaceError)):
        return True
    return isinstance(e, TRANSPORT) or isinstance(e, requests.exceptions.RequestException)


def days_between(a: date, b: date):
    d = a
    while d <= b:
        yield d
        d += timedelta(days=1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="d_from")
    ap.add_argument("--to", dest="d_to")
    ap.add_argument("--outlet")
    ap.add_argument("--no-activity", action="store_true")
    ap.add_argument("--only-activity", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    now = datetime.now(IST)
    yesterday = (now - timedelta(days=1)).date()
    d_from = date.fromisoformat(args.d_from) if args.d_from else yesterday
    d_to = date.fromisoformat(args.d_to) if args.d_to else d_from
    days = list(days_between(d_from, d_to))
    log(f"===== petpooja-logs run at {now:%Y-%m-%d %H:%M} IST, window {d_from} to {d_to}"
        f"{' (dry run)' if args.dry_run else ''} =====")

    # 1. session
    try:
        state = F.load_session()
        s = F.http_session(state)
        outlets = F.list_outlets(s)
    except F.SessionExpired as e:
        log(f"SESSION EXPIRED: {e}")
        alert("[CC ERP] Petpooja logs: saved login expired (F24)", str(e))
        return 1
    except Exception as e:
        if is_transport(e):
            log(f"transport problem before the pull ({type(e).__name__}: {str(e)[:120]}); deferring")
            return 75
        log(traceback.format_exc())
        alert("[CC ERP] Petpooja logs: failed before the pull", traceback.format_exc()[-3000:])
        return 1
    if args.outlet:
        wanted = {x.strip() for x in str(args.outlet).split(",") if x.strip()}
        outlets = [o for o in outlets if o[0] in wanted]
        if not outlets:
            log(f"outlet(s) {args.outlet} not in the dropdown"); return 1
    log(f"{len(outlets)} outlets in the dropdown")

    conn = None if args.dry_run else L.connect()
    cur = conn.cursor() if conn else None
    hashes: dict[str, str] = {}
    totals = {"store_log": [0, 0, 0], "item_log": [0, 0, 0], "activity": [0, 0, 0]}
    trig = {"manual": 0, "automatic": 0, "unknown": 0}
    try:
        # 2 and 3. the two logs, plain HTTP
        if not args.only_activity:
            for flag, shape in ((1, "store_log"), (2, "item_log")):
                run_id = None
                if cur:
                    run_id = L.open_run(cur, shape, d_from, d_to, note=f"{len(outlets)} outlets")
                rows_all = []
                for rid, label in outlets:
                    for day in days:
                        try:
                            rows, reported = F.fetch_log(s, flag, rid, day)
                        except F.SessionExpired as e:
                            raise
                        except Exception as e:
                            if is_transport(e):
                                log(f"  {label} {day}: transport problem ({type(e).__name__}); retrying once in 20s")
                                time.sleep(20)
                                rows, reported = F.fetch_log(s, flag, rid, day)
                            else:
                                raise
                        if reported and len(rows) != reported:
                            log(f"  {label} {day} {shape}: parsed {len(rows)} of {reported} reported rows")
                        if shape == "store_log":
                            for r in rows:
                                if r.get("client_hash"):
                                    hashes[rid] = r["client_hash"]
                        else:
                            for r in rows:
                                trig[r["trigger"]] = trig.get(r["trigger"], 0) + 1
                        rows_all.extend(rows)
                        time.sleep(F.POLITE_SLEEP)
                log(f"{shape}: {len(rows_all)} rows read for {len(outlets)} outlets x {len(days)} day(s)")
                if cur:
                    n, c, u = L.load_shape(cur, shape, rows_all, run_id, d_from, d_to)
                    totals[shape] = [n, c, u]
                    L.close_run(cur, run_id, len(rows_all), note=f"new {n}, changed {c}, unchanged {u}")
                    conn.commit()
                    log(f"{shape}: loaded, new {n}, changed {c}, unchanged {u}")
            if cur:
                L.upsert_outlets(cur, outlets, hashes)
                conn.commit()
                log(f"outlet map refreshed ({len(outlets)} outlets, {len(hashes)} hashes)")
            log(f"item switches by trigger: {trig}")

        # 4. the activity report, headless browser, per-outlet scope
        if not args.no_activity:
            want = set(days)
            result, diag = F.fetch_activity(state, outlets, want,
                                            on_outlet=lambda rid, label, n: log(f"  {label}: {n} orders in window"))
            rows_all = [r for rows in result.values() for r in rows]
            log(f"activity: {len(rows_all)} orders read for {len(result)} of {len(outlets)} outlets; "
                f"errors {len(diag['errors'])}; record types {diag['record_types']}")
            if cur:
                run_id = L.open_run(cur, "activity", d_from, d_to,
                                    note=f"{len(result)} outlets ok, {len(diag['errors'])} errors, types {diag['record_types']}")
                n, c, u = L.load_shape(cur, "activity", rows_all, run_id, d_from, d_to)
                totals["activity"] = [n, c, u]
                L.close_run(cur, run_id, len(rows_all), note=f"new {n}, changed {c}, unchanged {u}")
                conn.commit()
                log(f"activity: loaded, new {n}, changed {c}, unchanged {u}")
            if diag["restored"] is False:
                alert("[CC ERP] Petpooja logs: session NOT back on All Outlets",
                      "The activity pull could not verify the session was restored to All Outlets. "
                      "Open billing.petpooja.com and pick All Outlets at the top left before 8am, "
                      "otherwise the morning scrape may read one store only.")
                return 1
            if diag["errors"] and len(diag["errors"]) == len(outlets):
                raise RuntimeError(f"activity report failed on every outlet: {list(diag['errors'].values())[:2]}")
        log(f"done: {totals}")
        return 0
    except F.SessionExpired as e:
        log(f"SESSION EXPIRED: {e}")
        alert("[CC ERP] Petpooja logs: saved login expired (F24)", str(e))
        return 1
    except Exception as e:
        if conn:
            try:
                conn.rollback()
            except Exception as re_:
                log(f"rollback itself failed ({type(re_).__name__}); the transaction is abandoned")
        if is_transport(e) and now.hour < LAST_SLOT_HOUR:
            log(f"transport problem mid-run ({type(e).__name__}: {str(e)[:120]}); deferring to the next slot")
            return 75
        log(traceback.format_exc())
        alert("[CC ERP] Petpooja logs: run failed", traceback.format_exc()[-3000:])
        return 1
    finally:
        if conn:
            try:
                conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
