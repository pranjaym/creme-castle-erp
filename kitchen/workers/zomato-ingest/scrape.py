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
    """Default HEADED, unlike the Petpooja worker.

    Measured 4 Aug 2026 against the live site: every headless variant (plain, real
    user agent, --headless=new, --disable-blink-features=AutomationControlled) was
    refused in under a second with net::ERR_HTTP2_PROTOCOL_ERROR, before any page
    code ran, while the same session in a headed browser loaded normally. Zomato's
    edge rejects the headless browser signature. We do not try to disguise it; the
    job simply runs a real browser window.

    Consequence for scheduling: the 18:00 slots open a visible Chromium window for
    a few minutes and close it. That needs a logged-in GUI session on the Mac, the
    same condition the morning dashboard already depends on (F14).

    ZOMATO_HEADLESS=1 forces headless again, for the day their edge stops caring."""
    return env("ZOMATO_HEADLESS", "0") not in ("0", "false", "False", "")


def _open_context(browser):
    kw = {"accept_downloads": True}
    if os.path.exists(session_file()):
        kw["storage_state"] = session_file()
    ctx = browser.new_context(**kw)
    ctx.set_default_timeout(SEL_TIMEOUT)
    ctx.set_default_navigation_timeout(NAV_TIMEOUT)
    return ctx


# The date-range chip's label is an ordinal day: '30th Jul', '3rd to 4th Aug'.
# NOT anchored with ^: Playwright matches has_text against the element's text
# content, which carries leading whitespace from the JSX, so an anchored pattern
# silently matched nothing and the page looked permanently "not ready" even when
# fully loaded and logged in (4 Aug 2026, cost several debugging rounds).
CHIP_RE = re.compile(r"\d{1,2}(st|nd|rd|th)\s")


def _chip(page):
    """The date-range chip button: the control the scrape drives, and the
    strictest 'order history is ready' signal."""
    return page.locator("button", has_text=CHIP_RE).first


def _on_order_history(page, timeout_ms=5000):
    try:
        return _chip(page).is_visible(timeout=timeout_ms)
    except Exception:
        return False


def _wait_for_order_history(page, timeout_ms=60000):
    """Wait for the chip to render, polling rather than sleeping a fixed amount.

    This page is a React SPA behind an API call: domcontentloaded fires while it is
    still a skeleton, and on a cold headless context the real controls can take
    tens of seconds. A fixed 4 to 5 second sleep reported 'not reachable' on a
    perfectly good session (4 Aug 2026 bootstrap), so every caller now waits on the
    element itself with a generous budget."""
    try:
        _chip(page).wait_for(state="visible", timeout=timeout_ms)
        return True
    except Exception:
        return False


def _logged_in(page):
    """Authenticated anywhere in the partner dashboard, not just on order history.

    The first version required the order-history date chip, so a login that landed
    on any other partner page (which is what Zomato actually does after a fresh
    OTP) looked like "not logged in" and the bootstrap sat there until it timed
    out, with a perfectly good session in the window (4 Aug 2026). Bootstrap needs
    to recognise the LOGIN, and can navigate to order history itself afterwards."""
    if _on_order_history(page):
        return True
    try:
        url = page.url.lower()
        if "/partners/" not in url:
            return False
        if any(k in url for k in ("login", "otp", "auth", "verify", "signin")):
            return False
        # The left sidebar is on every authenticated partner page; two of its
        # items together are a far stronger signal than any single word.
        hits = 0
        for label in ("Order history", "Reporting", "Outlet info", "Customer complaints"):
            try:
                if page.get_by_text(label, exact=True).first.is_visible(timeout=1500):
                    hits += 1
            except Exception:
                pass
            if hits >= 2:
                return True
        return False
    except Exception:
        return False


def _open_picker(page):
    """Open the date popover, tolerating a chip click that lands while the page is
    still settling. Escape can leave the popover in a state where one click only
    re-focuses it, so a second click is attempted before giving up."""
    for attempt in (1, 2):
        try:
            _chip(page).click()
            page.wait_for_selector(".rdrMonthPicker select", timeout=10000)
            return
        except Exception:
            if attempt == 2:
                raise
            page.wait_for_timeout(1500)


def _shown_month(page):
    """(year, month_index_0_based) currently displayed, read from the picker's own
    selects, or None if the picker is not open."""
    st = page.evaluate(
        """() => {
            const m = document.querySelector('.rdrMonthPicker select');
            const y = document.querySelector('.rdrYearPicker select');
            return (m && y) ? {m: parseInt(m.value, 10), y: parseInt(y.value, 10)} : null;
        }""")
    return (st["y"], st["m"]) if st else None


def _goto_month(page, year, month0, max_clicks=36):
    """Bring the calendar to (year, month0) using its own next/previous ARROWS.

    Not the month <select>: Playwright's select_option changes the element's value
    without React noticing, so the grid keeps showing the old month and a day click
    lands on the wrong date (that is how 27 Jul to 2 Aug became 2 Jul to 27 Jul,
    4 Aug 2026).

    Every press is verified to have moved the grid, and a press that does NOT move
    it is simply retried by the loop rather than treated as fatal: immediately after
    a day click React is re-rendering and swallows the next click, which is a normal
    race, not a broken page. The picker also opens on the current month and cannot
    navigate into the future, so the next arrow is legitimately inert there."""
    target = (year, month0)
    for _ in range(max_clicks):
        here = _shown_month(page)
        if here is None:
            raise RuntimeError("date picker is not open")
        if here == target:
            return
        forward = (target[0] * 12 + target[1]) > (here[0] * 12 + here[1])
        page.click(".rdrNextButton" if forward else ".rdrPprevButton")
        for _ in range(10):                      # up to 2s for the grid to move
            page.wait_for_timeout(200)
            if _shown_month(page) != here:
                break
    raise RuntimeError(f"calendar would not reach {target} (stuck at {_shown_month(page)})")


def _click_day(page, d):
    """Put the calendar on the right month, then click that day. Day cells carry no
    date attribute, so the displayed month MUST be correct before the click."""
    _goto_month(page, d.year, d.month - 1)
    page.wait_for_timeout(400)
    cell = page.locator("button.rdrDay:not(.rdrDayPassive)",
                        has=page.locator(f"span:text-is('{d.day}')")).first
    cell.click()
    # Generous settle: the day click re-renders the whole picker, and the next
    # action (another arrow press) is otherwise swallowed mid-render.
    page.wait_for_timeout(1500)


def _picker_values(page):
    """The two readonly inputs inside the picker echo the chosen range, e.g.
    ['Jul 27, 2026', 'Aug 2, 2026']. Returns them parsed, or []."""
    vals = page.eval_on_selector_all(
        ".rdrCalendarWrapper input[readonly], .rdrDateDisplay input, input[readonly]",
        "els => els.map(e => e.value).filter(Boolean)")
    out = []
    for v in vals[:2]:
        try:
            out.append(dt.datetime.strptime(v.strip(), "%b %d, %Y").date())
        except ValueError:
            pass
    return out


def _set_range(page, from_date, to_date, attempts=3):
    """Set the range and PROVE it took, reading the picker's own inputs back.

    The read-back is exact and mandatory: an unnoticed wrong range would quietly
    ingest the wrong days, which is worse than a failed pull. react-date-range
    also normalises a range so start <= end, so a mis-click can look plausible."""
    last = None
    for attempt in range(1, attempts + 1):
        _open_picker(page)
        _click_day(page, from_date)
        _click_day(page, to_date)
        got = _picker_values(page)
        last = got
        if got and sorted(got)[0] == from_date and sorted(got)[-1] == to_date:
            print(f"date range set to {from_date}..{to_date} (picker confirms {got})")
            break
        print(f"date range attempt {attempt}/{attempts} landed on {got}, "
              f"wanted {from_date}..{to_date}; retrying from a clean page")
        # Reload rather than Escape-and-reopen: a half-set range is sticky, and a
        # fresh page is the only state we can reason about.
        page.goto(ORDER_HISTORY_URL, wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        if not _wait_for_order_history(page):
            raise RuntimeError("order history did not reload for the range retry")
    else:
        raise RuntimeError(
            f"could not set the date range: picker settled on {last}, "
            f"wanted {from_date}..{to_date}")
    page.keyboard.press("Escape")
    try:
        # Dismiss the popover by clicking the page heading. Escape alone sometimes
        # leaves it open, and clicking a random point risks hitting a control.
        page.get_by_text("Order History", exact=True).last.click(timeout=5000)
    except Exception:
        pass
    page.wait_for_timeout(500)


def _trigger_export(page, export, dest_dir, prefix):
    """Open Download data -> the chosen export -> Download now, then wait for the
    browser download event. Raises ExportNotReady on the failure toast/timeout."""
    label = EXPORTS[export]
    # .last, never .first: each label sits inside several nested wrapper divs and
    # get_by_text matches every one of them. .first is the OUTERMOST wrapper, whose
    # centre is not over the control, so the click silently does nothing and the run
    # then waits out the full download timeout for a job it never started (4 Aug
    # 2026: the page sat idle with the range correctly set). .last is the innermost
    # element, the one a user actually clicks. Verified live end to end.
    page.get_by_text("Download data", exact=True).last.click()
    page.wait_for_timeout(1200)
    page.get_by_text(label, exact=True).last.click(timeout=SEL_TIMEOUT)
    page.wait_for_timeout(1500)
    print(f"{export}: confirming, then waiting for the file "
          f"(up to {DOWNLOAD_TIMEOUT_MS // 60000} min)...")
    try:
        # The modal's "Download now" starts an async server job; the download event
        # fires minutes later when the file is ready, so the click sits INSIDE the
        # expect_download window.
        with page.expect_download(timeout=DOWNLOAD_TIMEOUT_MS) as di:
            page.get_by_text("Download now", exact=True).last.click(timeout=SEL_TIMEOUT)
        dl = di.value
    except Exception:
        # Distinguish the three ways this ends, instead of calling everything a
        # timeout: Zomato's own failure toast, a still-running job, or our own
        # click never landing. A screenshot is kept for the last case.
        state = []
        for marker in ("Download failed", "Download in progress", "Download now",
                       "Something went wrong"):
            try:
                if page.get_by_text(marker, exact=False).first.is_visible(timeout=1500):
                    state.append(marker)
            except Exception:
                pass
        shot = os.path.join(dest_dir, f"{prefix}_failure.png")
        try:
            page.screenshot(path=shot)
        except Exception:
            shot = "(screenshot failed)"
        if "Download failed" in state or "Something went wrong" in state:
            raise ExportNotReady(
                f"{export}: Zomato reported 'Download failed' (data likely not "
                f"materialised yet for the newest day in the range, F16)")
        if "Download now" in state:
            raise ExportNotReady(
                f"{export}: the confirmation modal was still showing, so the job "
                f"never started (see {shot})")
        raise ExportNotReady(
            f"{export}: no file within the timeout; page showed {state or 'nothing'} "
            f"(see {shot})")
    path = os.path.join(dest_dir, f"{prefix}_{dl.suggested_filename}")
    dl.save_as(path)
    print(f"downloaded {path}")
    return path


def _fetch_once(export, from_date, to_date):
    dest = env("ZOMATO_DOWNLOAD_DIR", tempfile.gettempdir())
    os.makedirs(dest, exist_ok=True)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        # No --disable-http2 here: it was tried against the headless rejection and
        # made things worse (an instant protocol error became a 60s hang). A plain
        # headed launch is what the site accepts.
        browser = p.chromium.launch(headless=_is_headless())
        context = _open_context(browser)
        try:
            page = context.new_page()
            page.goto(ORDER_HISTORY_URL, wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            # Wait for the control we are about to drive, not for a fixed number of
            # seconds: the SPA is still a skeleton at domcontentloaded.
            if not _wait_for_order_history(page):
                if not _logged_in(page):
                    raise RuntimeError(
                        "Zomato partner session is missing or expired. Run "
                        "`python3 scrape.py bootstrap` from the Mac and log in by hand.")
                raise RuntimeError(
                    "logged in, but the order-history date control never rendered "
                    "within 60s (page slow or its layout changed)")
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
        # Land on order history before saving: it is the page every scheduled run
        # starts from, so any outlet/consent interstitial that would otherwise
        # surprise the first headless pull is resolved and captured here.
        if not _on_order_history(page):
            try:
                page.goto(ORDER_HISTORY_URL, wait_until="domcontentloaded",
                          timeout=NAV_TIMEOUT)
                page.wait_for_timeout(5000)
                print(f"order history reachable: {_on_order_history(page)}")
            except Exception as e:
                print(f"could not confirm order history ({str(e)[:80]}); "
                      f"saving the session anyway.")
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
