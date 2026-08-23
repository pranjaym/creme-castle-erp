"""Mail harvester for the Zomato enterprise business reports.

Zomato's submit endpoint returns NO key, no job id and no polling endpoint. The
only carrier of a report's download key is the email. So the chain is:

  reports@zomato.com  ->  "Download Report" link (a url7479.zomato.com tracker)
                      ->  302 to /partners/business/download?key=...&report_type=...
                      ->  that page, loaded in the logged-in session, fires a
                          PRESIGNED S3 url valid 3 hours
                      ->  the presigned url needs no cookies; plain GET.

Mail arrives at pranjay.mittal@gmail.com (the Zomato login) and is auto-forwarded
by a Gmail filter to CC_MAIL_USER, which is what we read here. See
erp-plan/zomato-business-reports-catalogue.md sections 13 and 14.
"""
from __future__ import annotations

import email
import imaplib
import os
import re
import time
from datetime import datetime, timedelta, timezone
from email.header import decode_header
from urllib.parse import parse_qs, urlparse

import requests

IST = timezone(timedelta(hours=5, minutes=30))
TRACKER = re.compile(r"https://url\d+\.zomato\.com/ss/c/[^\s\"'>\)]+")
# The mail is text/html ONLY, and the dates sit inside tags:
#   'Your business report for <strong>2025-01-01</strong> to <strong>2025-01-31</strong>'
# so the tags are stripped before matching. Matching the raw body finds nothing,
# which silently looks exactly like "the report never arrived".
WINDOW = re.compile(r"business report for\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})")
TAGS = re.compile(r"<[^>]+>")


def strip_tags(html: str) -> str:
    return re.sub(r"\s+", " ", TAGS.sub(" ", html))


def _pw():
    return os.environ["CC_MAIL_APP_PASSWORD"].replace(" ", "")


def _body_text(msg) -> str:
    out = []
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() in ("text/plain", "text/html"):
                try:
                    out.append(part.get_payload(decode=True).decode(
                        part.get_content_charset() or "utf-8", errors="replace"))
                except Exception:
                    pass
    else:
        try:
            out.append(msg.get_payload(decode=True).decode(
                msg.get_content_charset() or "utf-8", errors="replace"))
        except Exception:
            pass
    return "\n".join(out)


def fetch_report_links(since_utc: datetime, host="imap.gmail.com", mailbox="INBOX",
                       window=None):
    """Return [{'received', 'subject', 'tracker', 'window'}] for report mails that
    arrived after `since_utc`. IMAP SEARCH is date-granular only, so the precise
    cutoff is applied on the parsed Date header.

    `window` is an optional (date_from, date_to) filter. Every report mail names
    its own range in the body, so matching on it lets two pulls for different
    windows run at the same time without stealing each other's reports. Without
    it a concurrent run grabs whatever landed first, which matters once a backfill
    is firing dozens of requests."""
    user = os.environ["CC_MAIL_USER"]
    M = imaplib.IMAP4_SSL(host, 993, timeout=60)
    try:
        M.login(user, _pw())
        M.select(mailbox, readonly=True)
        since = (since_utc - timedelta(days=1)).strftime("%d-%b-%Y")
        typ, data = M.search(None, f'(FROM "reports@zomato.com" SINCE {since})')
        found = []
        for num in data[0].split():
            typ, d = M.fetch(num, "(RFC822)")
            msg = email.message_from_bytes(d[0][1])
            try:
                received = email.utils.parsedate_to_datetime(msg["Date"])
            except Exception:
                continue
            if received.tzinfo is None:
                received = received.replace(tzinfo=timezone.utc)
            if received < since_utc:
                continue
            subj = str(decode_header(msg.get("Subject", ""))[0][0])
            if isinstance(subj, bytes):
                subj = subj.decode(errors="replace")
            body = _body_text(msg)
            wm = WINDOW.search(strip_tags(body))
            mail_window = (wm.group(1), wm.group(2)) if wm else None
            if window is not None:
                want = (str(window[0]), str(window[1]))
                if mail_window != want:
                    continue
            for m in TRACKER.finditer(body):
                found.append({"received": received, "subject": subj,
                              "tracker": m.group(0), "window": mail_window})
                break
        return sorted(found, key=lambda x: x["received"])
    finally:
        try:
            M.logout()
        except Exception:
            pass


def resolve_tracker(tracker_url: str, timeout=60):
    """Follow the tracker one hop. Needs no auth. -> (key, report_type).

    Parse the query string properly: Zomato emits the two parameters in EITHER
    order (?key=...&report_type=... and ?report_type=...&key=... both observed
    on 22 Aug 2026 within the same batch of five reports), so a positional
    regex silently fails on half of them."""
    r = requests.head(tracker_url, allow_redirects=False, timeout=timeout)
    loc = r.headers.get("location", "")
    q = parse_qs(urlparse(loc).query)
    key = (q.get("key") or [None])[0]
    rtype = (q.get("report_type") or [None])[0]
    if not key or not rtype:
        raise RuntimeError(f"tracker did not resolve to a download key: {loc[:160]!r}")
    return key, rtype


def presigned_for(key: str, report_type: str, session_file: str, timeout_ms=90000) -> str:
    """Load the download page in the saved Zomato session and capture the presigned
    S3 url it fires. The session is the one the live zomato-ingest worker keeps;
    verified 21 Aug 2026 to work on this console headless in Firefox."""
    from playwright.sync_api import sync_playwright
    url = (f"https://www.zomato.com/partners/business/download"
           f"?key={key}&report_type={report_type}")
    got = []
    with sync_playwright() as p:
        b = p.firefox.launch(headless=True)
        try:
            c = b.new_context(storage_state=session_file)
            pg = c.new_page()
            pg.on("response", lambda r: got.append(r.url) if "amazonaws.com" in r.url else None)
            pg.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            for _ in range(30):
                if got:
                    break
                pg.wait_for_timeout(1000)
            if not got:                      # nudge the explicit button
                try:
                    pg.get_by_text(re.compile("download again", re.I)).first.click(timeout=5000)
                except Exception:
                    pass
                for _ in range(20):
                    if got:
                        break
                    pg.wait_for_timeout(1000)
        finally:
            b.close()
    if not got:
        raise RuntimeError("download page never fired a presigned S3 url")
    return got[-1]


def download_csv(presigned_url: str, timeout=300) -> str:
    r = requests.get(presigned_url, timeout=timeout)
    r.raise_for_status()
    if "csv" not in r.headers.get("content-type", "") and not r.text.lstrip().startswith(
            ("Restaurant ID", "dt,")):
        raise RuntimeError(f"unexpected content-type {r.headers.get('content-type')!r}")
    return r.text


def harvest(since_utc: datetime, session_file: str):
    """Full chain for every report mail since `since_utc`.
    -> [{'received','subject','key','report_type','csv'}]"""
    out = []
    for item in fetch_report_links(since_utc):
        key, rtype = resolve_tracker(item["tracker"])
        csv_text = download_csv(presigned_for(key, rtype, session_file))
        out.append({**item, "key": key, "report_type": rtype, "csv": csv_text})
    return out
