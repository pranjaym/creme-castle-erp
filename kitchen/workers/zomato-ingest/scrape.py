#!/usr/bin/env python3
"""
Zomato partner-dashboard browser agent. Logs in once (bootstrap, by hand), saves the
session, and reuses it headless to download the Order history / Customer details
exports for a date range. The file is handed to ingest.py's loader.

Follows the proven Petpooja pattern (workers/petpooja-ingest/scrape.py): Playwright
storage_state kept per account in Supabase Storage, one-time headed bootstrap from
the Mac, headless reuse forever after, loud failure naming the fix when the session
expires. No credential or OTP is ever read by this code; the human logs in by hand
in the bootstrap window.

Page mechanics (verified live 4 Aug 2026, erp-plan/zomato-order-details-feed.md):
  * https://www.zomato.com/partners/onlineordering/orderHistory/
  * date picker is react-date-range: stable classes .rdrMonthPicker select,
    .rdrYearPicker select, button.rdrDay (adjacent-month cells carry .rdrDayPassive);
    everything else on the page has hashed css-* classes, so text locators are used.
  * "Download data" dropdown -> "Order history" | "Customer details" -> modal
    "Download now" -> async server job -> the browser download event fires when the
    file is ready (a zip containing one CSV). Failure shows a "Download failed"
    toast after minutes of churn; that is what NOT-YET-READY data looks like (F16),
    so the caller treats it as retryable, not fatal.

Env:
  ZOMATO_PORTAL_URL       (default the order-history page URL)
  ZOMATO_HEADLESS         (default "1"; bootstrap forces headed)
  ZOMATO_DOWNLOAD_DIR     (default the system temp dir)
  ZOMATO_SESSION_BUCKET   (default "petpooja-session", object zomato_session.json;
                           reuses the existing private bucket, no new infra)
  SPINE_SUPABASE_URL, SPINE_SUPABASE_SERVICE_ROLE_KEY   (session pull/push)
"""
import datetime as dt
import os
import re
import sys
import tempfile
import time

NAV_TIMEOUT = 60000
SEL_TIMEOUT = 30000
# The export job runs server side for minutes. 12 minutes covers every observed
# success (fast when the data is ready) with headroom; the observed failure mode
# ("Download failed" toast) lands well inside it.
DOWNLOAD_TIMEOUT_MS = 12 * 60 * 1000

ORDER_HISTORY_URL = os.environ.get(
    "ZOMATO_PORTAL_URL", "https://www.zomato.com/partners/onlineordering/orderHistory/")

EXPORTS = {
    "order_history": "Order history",
    "customer_details": "Customer details",
}


class ExportNotReady(Exception):
    """Zomato's report job failed server side ('Download failed' toast). For a
    recent day this almost always means the data is not materialised yet (F16):
    retry later, do not treat as a code or session problem."""


def _load_env_file():
    """Load dashboard/auto/.env (the repo's one secrets file) so this module works
    when run DIRECTLY (`python3 scrape.py bootstrap`), not only when imported by
    run_evening.py. Without this the bootstrap has no SPINE_SUPABASE_* creds, so
    the session is never pushed to Storage and the evening runs cannot find it:
    exactly the 4 Aug 2026 failure where a successful login still left every slot
    deferring with 'no session bootstrapped yet'. Existing env wins."""
    here = os.path.dirname(os.path.abspath(__file__))
    repo = os.path.dirname(os.path.dirname(os.path.dirname(here)))
    path = os.path.join(repo, "dashboard", "auto", ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_env_file()


def env(k, default=None, required=False):
    v = os.environ.get(k, default)
    if required and not v:
        sys.exit(f"{k} is not set")
    return v


# Durable, predictable home for the saved session. NOT the system temp dir: on
# macOS that is a per-boot, per-context path ($TMPDIR under /var/folders) which
# differs between a terminal and a launchd agent and is swept periodically, so a
# session saved by an interactive bootstrap could be invisible to the scheduled
# run minutes later. Supabase Storage remains the source of truth; this is the
# local cache.
SESSION_DIR = os.environ.get(
    "ZOMATO_SESSION_DIR", os.path.expanduser("~/.creme-castle"))


def session_file():
    os.makedirs(SESSION_DIR, exist_ok=True)
    return os.path.join(SESSION_DIR, "zomato_session.json")


def _session_object_url():
    base = env("SPINE_SUPABASE_URL", required=True)
    bucket = env("ZOMATO_SESSION_BUCKET", "petpooja-session")
    return f"{base}/storage/v1/object/{bucket}/zomato_session.json"


def pull_session():
    import requests
    key = env("SPINE_SUPABASE_SERVICE_ROLE_KEY")
    if not key or not os.environ.get("SPINE_SUPABASE_URL"):
        return False
    try:
        r = requests.get(_session_object_url(),
                         headers={"Authorization": f"Bearer {key}", "apikey": key},
                         timeout=30)
    except Exception as e:
        print(f"session pull skipped: {e}")
        return False
    if r.status_code == 200 and r.content:
        with open(session_file(), "wb") as f:
            f.write(r.content)
        print("zomato session pulled from Supabase Storage.")
        return True
    return False


def push_session():
    import requests
    key = env("SPINE_SUPABASE_SERVICE_ROLE_KEY")
    path = session_file()
    if not key or not os.path.exists(path):
        return False
    with open(path, "rb") as f:
        blob = f.read()
    r = requests.post(_session_object_url(), data=blob, headers={
        "Authorization": f"Bearer {key}", "apikey": key,
        "Content-Type": "application/json", "x-upsert": "true",
    }, timeout=30)
    if r.ok:
        print("zomato session pushed to Supabase Storage.")
        return True
    print(f"session push failed: {r.status_code} {r.text[:120]}")
    return False


def have_session():
    """True if a saved session exists locally or in Storage. The evening wrapper
    uses this to exit QUIETLY before bootstrap has ever been run, instead of
    alerting every evening about a login that simply has not happened yet."""
    return os.path.exists(session_file()) or pull_session()


def _is_headless():
    return env("ZOMATO_HEADLESS", "1") not in ("0", "false", "False", "")


def _open_context(browser):
    kw = {"accept_downloads": True}
    if os.path.exists(session_file()):
        kw["storage_state"] = session_file()
    ctx = browser.new_context(**kw)
    ctx.set_default_timeout(SEL_TIMEOUT)
    ctx.set_default_navigation_timeout(NAV_TIMEOUT)
    return ctx


def _logged_in(page):
    """The date-range chip (a button whose label starts with an ordinal day, like
    '30th Jul' or '3rd to 4th Aug') exists only on the authenticated order-history
    page; the logged-out page redirects to a login/marketing screen without it."""
    try:
        return page.locator("button", has_text=re.compile(r"^\d{1,2}(st|nd|rd|th)\b")) \
                   .first.is_visible(timeout=8000)
    except Exception:
        return False


def _open_picker(page):
    chip = page.locator("button", has_text=re.compile(r"^\d{1,2}(st|nd|rd|th)\b")).first
    chip.click()
    page.wait_for_selector(".rdrMonthPicker select", timeout=SEL_TIMEOUT)


def _click_day(page, d):
    """Click one calendar day: month via the native <select> (value = month-1),
    then the day cell, skipping the grayed adjacent-month cells."""
    page.select_option(".rdrMonthPicker select", value=str(d.month - 1))
    year_opts = page.eval_on_selector_all(".rdrYearPicker select option",
                                          "els => els.map(e => e.value)")
    if str(d.year) not in year_opts:
        raise RuntimeError(f"year {d.year} not offered by the date picker ({year_opts})")
    page.select_option(".rdrYearPicker select", value=str(d.year))
    page.wait_for_timeout(400)
    cell = page.locator(f"button.rdrDay:not(.rdrDayPassive)",
                        has=page.locator(f"span:text-is('{d.day}')")).first
    cell.click()
    page.wait_for_timeout(400)


def _set_range(page, from_date, to_date):
    """Set the range: first click = range start, second = range end. Verified live:
    the two readonly inputs inside the picker echo the chosen dates."""
    _open_picker(page)
    _click_day(page, from_date)
    _click_day(page, to_date)
    vals = page.eval_on_selector_all(
        ".rdrDateDisplay input, input[readonly]",
        "els => els.map(e => e.value).filter(Boolean)")
    print(f"date range set to {from_date}..{to_date} (picker shows {vals[:2]})")
    want = {from_date.strftime("%b %-d, %Y"), to_date.strftime("%b %-d, %Y")}
    if vals and not want & set(vals):
        raise RuntimeError(f"picker did not take the range: shows {vals[:2]}, wanted {want}")
    page.keyboard.press("Escape")
    page.locator("text=Order History").first.click(timeout=5000)   # close the popover
    page.wait_for_timeout(500)


def _trigger_export(page, export, dest_dir, prefix):
    """Open Download data -> the chosen export -> Download now, then wait for the
    browser download event. Raises ExportNotReady on the failure toast/timeout."""
    label = EXPORTS[export]
    page.get_by_text("Download data", exact=True).first.click()
    page.get_by_text(label, exact=True).first.click(timeout=SEL_TIMEOUT)
    print(f"{export}: confirming, then waiting for the file "
          f"(up to {DOWNLOAD_TIMEOUT_MS // 60000} min)...")
    try:
        # The modal's "Download now" starts an async server job; the download event
        # fires minutes later when the file is ready, so the click sits INSIDE the
        # expect_download window.
        with page.expect_download(timeout=DOWNLOAD_TIMEOUT_MS) as di:
            page.get_by_text("Download now", exact=True).first.click(timeout=SEL_TIMEOUT)
        dl = di.value
    except Exception:
        failed = False
        try:
            failed = page.get_by_text("Download failed", exact=False) \
                         .first.is_visible(timeout=2000)
        except Exception:
            pass
        if failed:
            raise ExportNotReady(
                f"{export}: Zomato reported 'Download failed' (data likely not "
                f"materialised yet for the newest day in the range, F16)")
        raise ExportNotReady(f"{export}: no file within the timeout")
    path = os.path.join(dest_dir, f"{prefix}_{dl.suggested_filename}")
    dl.save_as(path)
    print(f"downloaded {path}")
    return path


def _fetch_once(export, from_date, to_date):
    dest = env("ZOMATO_DOWNLOAD_DIR", tempfile.gettempdir())
    os.makedirs(dest, exist_ok=True)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=_is_headless())
        context = _open_context(browser)
        try:
            page = context.new_page()
            page.goto(ORDER_HISTORY_URL, wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            page.wait_for_timeout(4000)          # the SPA hydrates after domcontentloaded
            if not _logged_in(page):
                raise RuntimeError(
                    "Zomato partner session is missing or expired. Run "
                    "`python3 scrape.py bootstrap` from the Mac and log in by hand.")
            _set_range(page, from_date, to_date)
            prefix = f"{export}_{from_date:%Y%m%d}_{to_date:%Y%m%d}"
            path = _trigger_export(page, export, dest, prefix)
            # Persist any refreshed cookies so the session's lifetime keeps sliding.
            context.storage_state(path=session_file())
            push_session()
            return path
        finally:
            try:
                browser.close()
            except Exception:
                pass


def scrape_and_download(export, from_date, to_date, max_retries=0, retry_wait_s=60):
    """Entry point. export in ('order_history', 'customer_details'); dates are
    datetime.date. Retries only transient errors; ExportNotReady is passed through
    immediately (the caller owns the wait-hours-and-retry policy, F16)."""
    if export not in EXPORTS:
        raise ValueError(f"unknown export '{export}'")
    pull_session()
    last = None
    for attempt in range(1, max_retries + 2):
        try:
            print(f"zomato {export} [{from_date}..{to_date}]: "
                  f"attempt {attempt}/{max_retries + 1}")
            return _fetch_once(export, from_date, to_date)
        except ExportNotReady:
            raise
        except Exception as e:
            last = e
            print(f"attempt {attempt} failed: {type(e).__name__}: {str(e)[:160]}")
            time.sleep(retry_wait_s)
    raise SystemExit(f"zomato scrape failed after retries: {last}")


def bootstrap(timeout_s=600, poll_s=3):
    """One-time, headed, from the Mac. Opens the partner dashboard; the USER logs in
    BY HAND (phone, OTP) in the window. Nothing is auto-filled. When the order
    history page is reachable the session is saved and pushed to Supabase Storage,
    so the evening headless runs never see a login screen."""
    os.environ["ZOMATO_HEADLESS"] = "0"
    pull_session()
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = _open_context(browser)
        page = context.new_page()
        page.goto(ORDER_HISTORY_URL, wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        page.wait_for_timeout(4000)
        if _logged_in(page):
            print("already logged in; refreshing and pushing the session.")
        else:
            print("A browser window is open. Log in to the Zomato partner dashboard "
                  "by hand (phone number, OTP).")
            print(f"Waiting up to {timeout_s // 60} min for login to complete...")
            # The wait is PASSIVE while the user is anywhere in the login flow: an
            # earlier version re-navigated to the order-history page on every poll,
            # which reloaded the login screen before the OTP could be typed (found
            # live, 4 Aug 2026). We only steer the browser back to order history
            # when the page is clearly OUT of the login flow, the chip is still
            # absent, and we have not steered in the last 30 seconds.
            waited, last_nav = 0, 0
            while waited < timeout_s and not _logged_in(page):
                time.sleep(poll_s)
                waited += poll_s
                try:
                    url = page.url.lower()
                    in_login_flow = any(k in url for k in ("login", "otp", "auth", "verify"))
                    on_target = "orderhistory" in url
                    if (not in_login_flow and not on_target
                            and waited - last_nav >= 30):
                        last_nav = waited
                        page.goto(ORDER_HISTORY_URL, wait_until="domcontentloaded",
                                  timeout=NAV_TIMEOUT)
                        page.wait_for_timeout(3000)
                except Exception:
                    pass
            if not _logged_in(page):
                browser.close()
                raise SystemExit("login not detected within the time limit; re-run to retry.")
            print("login detected.")
        context.storage_state(path=session_file())
        pushed = push_session()
        browser.close()
    # Say plainly whether the DURABLE copy exists. The local file alone is not
    # enough for the scheduled runs to be sure of finding it, so a failed push is
    # reported as a problem to fix, never as success (4 Aug 2026 lesson).
    print(f"session saved locally: {session_file()}")
    if pushed:
        print("bootstrap complete: session saved AND pushed to Supabase Storage. "
              "The evening pulls can now run headless.")
    else:
        print("WARNING: the session was saved locally but NOT pushed to Supabase "
              "Storage (SPINE_SUPABASE_URL / SPINE_SUPABASE_SERVICE_ROLE_KEY "
              "missing or rejected). Scheduled runs may not find it.")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "bootstrap":
        bootstrap()
    else:
        export = sys.argv[1] if len(sys.argv) > 1 else "order_history"
        days = int(sys.argv[2]) if len(sys.argv) > 2 else 7
        end = dt.date.today() - dt.timedelta(days=1)
        start = end - dt.timedelta(days=days - 1)
        print(scrape_and_download(export, start, end))
