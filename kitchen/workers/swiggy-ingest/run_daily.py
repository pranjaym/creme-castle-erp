"""Phase 2: fetch the Swiggy Daily-MTD mail from Gmail and load it.

Chain: aashuraj.hassani@swiggy.in mails the xlsx daily (to pranjay@, which is
CC_MAIL_USER, since 24 Aug 2026) at an UNRELIABLE hour (10:30 to 20:45 IST
observed), so launchd runs this on an evening ladder plus a next-morning
catch-up (14:00, 18:00, 21:30, 07:15; in.cremecastle.swiggy.plist). The MTD
file restates the whole month, so a missed day heals itself on the next load.

Per slot: read recent mails over IMAP, save each attachment to archive/,
sha-skip files the register already has, upload new ones to the swiggy-raw
storage bucket (the immutable receipt), then load through run_file.load_path
(one transaction per file; a failure rolls the whole file back).

Exit codes (the wrapper stamps only on 0):
  0   the register holds a loaded file covering yesterday (IST): today's job
      is done, later slots exit in milliseconds off the stamp.
  75  defer: mail not arrived yet, or a transport blip. No stamp, no alert;
      the next slot retries. F23 rule: defer silently until the last slot.
  1   real failure, alerted: last evening slot and the newest loaded file is
      2+ days stale (that means self-healing has already missed a cycle).
"""
from __future__ import annotations

import email
import hashlib
import imaplib
import os
import re
import sys
import time
import traceback
from datetime import datetime, timedelta, timezone
from email.header import decode_header

import load as L
from run_file import load_path

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE = os.path.join(HERE, "archive")
IST = timezone(timedelta(hours=5, minutes=30))
SENDER = "aashuraj.hassani@swiggy.in"
SUBJECT_DATE = re.compile(r"Daily-MTD - ([A-Z][a-z]{2}-\d{2}-\d{4})")
LOOKBACK_DAYS = 5
LAST_SLOT_HOUR = 21     # after this hour IST, a stale feed alerts instead of deferring


def log(*a):
    print(*a, flush=True)


def _pin_to_ipv4():
    """F22: this network is NAT64; a lost IPv6 source address kills uploads
    with OSError 49. Storage sits behind Cloudflare with A records, so IPv4
    is the safe path. Off switch: CC_FORCE_IPV4=0."""
    if os.environ.get("CC_FORCE_IPV4", "1") == "0":
        return
    try:
        import urllib3.util.connection as urllib3_conn
        urllib3_conn.HAS_IPV6 = False
    except Exception:
        pass


def alert(subject, body):
    """Once-per-run owner alert, same mailbox the reports arrive in."""
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
        log("owner alert sent")
    except Exception as e:
        log(f"alert could not be sent: {type(e).__name__}: {e}")


def _subject(msg) -> str:
    parts = decode_header(msg.get("Subject", ""))
    out = ""
    for text, charset in parts:
        out += text.decode(charset or "utf-8", errors="replace") if isinstance(text, bytes) else text
    return re.sub(r"\s+", " ", out)


def fetch_mails():
    """Pull recent Daily-MTD attachments into archive/.
    Returns [(report_date, local_path)] oldest first, all matching mails in
    the lookback window (sha-skip downstream makes re-downloads free)."""
    user = os.environ["CC_MAIL_USER"]
    pw = os.environ["CC_MAIL_APP_PASSWORD"].replace(" ", "")
    os.makedirs(ARCHIVE, exist_ok=True)
    since = (datetime.now(IST) - timedelta(days=LOOKBACK_DAYS)).strftime("%d-%b-%Y")
    found = []
    M = imaplib.IMAP4_SSL("imap.gmail.com", 993, timeout=60)
    try:
        M.login(user, pw)
        M.select("INBOX", readonly=True)
        typ, data = M.search(None, f'(FROM "{SENDER}" SINCE {since})')
        for num in data[0].split():
            typ, d = M.fetch(num, "(RFC822)")
            msg = email.message_from_bytes(d[0][1])
            subject = _subject(msg)
            m = SUBJECT_DATE.search(subject)
            if not m:
                continue
            report_date = datetime.strptime(m.group(1), "%b-%d-%Y").date()
            for part in msg.walk():
                fname = part.get_filename()
                if not fname or not fname.lower().endswith(".xlsx"):
                    continue
                blob = part.get_payload(decode=True)
                if not blob:
                    continue
                local = os.path.join(ARCHIVE, f"{report_date}.xlsx")
                with open(local, "wb") as f:
                    f.write(blob)
                found.append((report_date, local))
                log(f"mail {report_date}: {len(blob):,} bytes -> {os.path.basename(local)}")
    finally:
        try:
            M.logout()
        except Exception:
            pass
    found.sort()
    return found


def store_receipt(path, report_date, max_retries=3, retry_wait_s=10):
    """Upload the raw xlsx to Storage as the immutable receipt (sha256 named).
    Same retry contract as the Zomato workers: transport and 5xx retry, a 4xx
    is a real problem and alerts immediately."""
    import requests
    _pin_to_ipv4()
    with open(path, "rb") as f:
        blob = f.read()
    sha = hashlib.sha256(blob).hexdigest()
    bucket = os.environ.get("SPINE_STORAGE_BUCKET_SWIGGY", "swiggy-raw")
    storage_path = f"{report_date}/{sha}-daily-mtd.xlsx"
    url = f"{os.environ['SPINE_SUPABASE_URL']}/storage/v1/object/{bucket}/{storage_path}"
    key = os.environ["SPINE_SUPABASE_SERVICE_ROLE_KEY"]
    headers = {"Authorization": f"Bearer {key}", "apikey": key,
               "Content-Type": "application/octet-stream", "x-upsert": "true"}
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(url, data=blob, headers=headers, timeout=(10, 180))
            resp.raise_for_status()
            break
        except requests.exceptions.RequestException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if attempt == max_retries or (status is not None and status < 500):
                raise
            log(f"receipt upload attempt {attempt}/{max_retries} failed "
                f"({type(e).__name__}: {str(e)[:120]}); retrying in {retry_wait_s}s")
            time.sleep(retry_wait_s)
    log(f"receipt stored: {sha[:12]}... -> {bucket}/{storage_path}")
    return sha, f"{bucket}/{storage_path}"


def newest_loaded_window_to():
    conn = L.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("""select max(window_to) from landing.ingest_runs
                            where source_system='swiggy' and report_key='daily_mtd'
                              and status='loaded'""")
            return cur.fetchone()[0]
    finally:
        conn.close()


def sha_already_loaded(path):
    sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
    conn = L.connect()
    try:
        with conn.cursor() as cur:
            return L.already_loaded(cur, sha) is not None
    finally:
        conn.close()


def main():
    L.load_env_file(os.path.join(HERE, "..", "..", ".env.local"))
    now = datetime.now(IST)
    yesterday = (now - timedelta(days=1)).date()
    log(f"===== swiggy run_daily at {now:%Y-%m-%d %H:%M %Z}, target report {yesterday} =====")

    try:
        loaded_any = False
        for report_date, path in fetch_mails():
            if sha_already_loaded(path):
                log(f"{report_date}: already in the register, skipping")
                continue
            sha, storage_path = store_receipt(path, report_date)
            status = load_path(path, raw_file_path=storage_path, log=log)
            loaded_any = loaded_any or (status == "loaded")

        if loaded_any:
            # The merged daily pages read the outlet map from a materialized
            # view (migration 215); refresh it so a new outlet maps itself
            # the day its first orders load.
            conn = L.connect()
            try:
                with conn:
                    with conn.cursor() as cur:
                        cur.execute("set local statement_timeout = 0")
                        cur.execute("refresh materialized view concurrently core.mv_swiggy_outlet_codes")
                log("outlet map refreshed")
            finally:
                conn.close()

        newest = newest_loaded_window_to()
        log(f"newest loaded report day: {newest}")
        if newest is not None and newest >= yesterday:
            log("target covered; done for today.")
            return 0
        if now.hour >= LAST_SLOT_HOUR and (newest is None or newest <= yesterday - timedelta(days=2)):
            alert("Swiggy daily feed is stale",
                  f"Last evening slot and the newest loaded Swiggy report day is {newest} "
                  f"(target {yesterday}). The MTD self-heal has already missed a cycle. "
                  f"Check the mail from {SENDER} in {os.environ.get('CC_MAIL_USER','the inbox')} "
                  f"and run kitchen/workers/swiggy-ingest/run_daily.py by hand. "
                  f"Before acting, check whether a later slot already succeeded (F23).")
            return 1
        log(f"target {yesterday} not covered yet"
            + (", loaded older files this slot" if loaded_any else "")
            + "; deferring to the next slot.")
        return 75
    except Exception:
        log(traceback.format_exc())
        if now.hour >= LAST_SLOT_HOUR:
            alert("Swiggy daily pull failed", traceback.format_exc()[-3000:])
            return 1
        log("deferring after error (not the last slot).")
        return 75


if __name__ == "__main__":
    sys.exit(main())
