#!/usr/bin/env python3
"""
Petpooja browser agent (Path B). Logs in once, saves the session, and reuses it to
download a report to a local file. The file is then handed to ingest.py's loader.

Adapted from Rishabh's proven pipeline (which scrapes Petpooja from Cloud Run today):
the login flow, the saved-session reuse, the retry-with-context-rebuild, and the
download pattern are lifted as KNOWLEDGE, not code. Nothing here hardcodes a secret;
every credential is an environment variable. The destination is our spine loader,
never Google Sheets.

Session persistence (why an always-on runner never re-asks for the OTP):
  Petpooja's OTP is interactive and only appears at first login. We save Playwright's
  storage_state and reuse it. On a cloud runner with no TTY we cannot answer an OTP,
  so the session is kept in Supabase Storage: pulled at startup, pushed after a fresh
  login. The one-time OTP login is done ONCE from a laptop (`python3 scrape.py bootstrap`),
  which pushes the session to Storage; the cloud runner then reuses it indefinitely.

PORTAL-SPECIFIC, CONFIRM AGAINST THE LIVE PORTAL BEFORE FIRST PROD RUN:
  Rishabh's pipeline scrapes `online_orders_report_all` and `order_summary_item`. The
  Build 1a punch source is a DIFFERENT report, the Material Purchase Report at the
  vendor-OMS location, whose exact URL, the outlet-scoping step, and the export
  selector are not yet observed on the live portal. They are isolated in REPORTS below
  and every one is overridable by an env var, so finalising them needs no code change.

Env:
  PETPOOJA_PORTAL_URL         (default https://billing.petpooja.com/)
  PETPOOJA_USERNAME, PETPOOJA_PASSWORD
  PETPOOJA_HEADLESS           (default "1" on cloud; bootstrap forces headed)
  PETPOOJA_DOWNLOAD_DIR       (default the system temp dir)
  PETPOOJA_SESSION_BUCKET     (default "petpooja-session")
  SPINE_SUPABASE_URL, SPINE_SUPABASE_SERVICE_ROLE_KEY   (for session pull/push)
  Per-report overrides (see REPORTS): PETPOOJA_REPORT_URL_OMS_PURCHASE, etc.
"""
import datetime as dt
import os
import sys
import tempfile
import time

SESSION_FILE = os.path.join(
    os.environ.get("PETPOOJA_DOWNLOAD_DIR", tempfile.gettempdir()),
    "petpooja_session.json",
)
NAV_TIMEOUT = 60000
SEL_TIMEOUT = 60000


def env(k, default=None, required=False):
    v = os.environ.get(k, default)
    if required and not v:
        sys.exit(f"{k} is not set")
    return v


def portal():
    return env("PETPOOJA_PORTAL_URL", "https://billing.petpooja.com/")


# Report registry. `url` is where the report lives; `strategy` is how its export
# button behaves. Both are env-overridable so the live-portal specifics can be
# pinned without touching code. `needs_outlet` marks a report that must be scoped
# to a specific Petpooja outlet first (the Material Purchase Report is downloaded
# AT the vendor-OMS outlet).
REPORTS = {
    "oms_purchase": {
        "url": env("PETPOOJA_REPORT_URL_OMS_PURCHASE",
                   "https://billing.petpooja.com/reports/purchase"),  # CONFIRM on live portal
        "strategy": env("PETPOOJA_OMS_PURCHASE_STRATEGY", "export_then_download"),
        "needs_outlet": True,
        "outlet_label": env("PETPOOJA_OMS_OUTLET_LABEL", "OMS"),      # CONFIRM exact label
        "prefix": "purchase",
    },
    "order_summary_item": {
        # CONFIRMED on the live portal 23 Jul 2026: this URL, the Export button, and
        # the Download-link that follows (a CSV from Petpooja's S3). Date boxes are
        # jQuery DateTimePicker widgets named data[Order][startdate]/enddate.
        "url": env("PETPOOJA_REPORT_URL_ORDER_SUMMARY_ITEM",
                   "https://billing.petpooja.com/reports/order_summary_item"),
        "strategy": env("PETPOOJA_ORDER_SUMMARY_ITEM_STRATEGY", "export_then_download"),
        "needs_outlet": False,
        "outlet_label": None,
        "prefix": "item",
        "start_sel": "input[name='data[Order][startdate]']",
        "end_sel": "input[name='data[Order][enddate]']",
    },
    "online_orders": {
        # CONFIRMED on the live portal 23 Jul 2026: URL, a direct #export download, date
        # boxes #from_date/#to_date (DateTimePicker), and a select2 #server_type that
        # must be set to "Get old records" (value 2) to reach historical dates.
        "url": env("PETPOOJA_REPORT_URL_ONLINE_ORDERS",
                   "https://billing.petpooja.com/reports/online_orders_report_all/"),
        # PROVEN approach (Rishabh's pipeline, confirmed 23 Jul 2026): do NOT set a date
        # range on this report. A custom range flips Petpooja into an async S3-generated
        # download that returns 503 until ready (unreliable). Instead just toggle the
        # server_type dropdown (2 = old records, 1 = latest/today) and catch the direct
        # download with expect_download. "Old records" returns a rolling historical dump;
        # deeper history accrues from the daily runs, not from one wide pull.
        "strategy": env("PETPOOJA_ONLINE_ORDERS_STRATEGY", "export_button"),
        "needs_outlet": False,
        "outlet_label": None,
        "prefix": "online",
        "server_type_value": "2",        # Get old records (select2); overridable per call
        "start_sel": "#from_date",
        "end_sel": "#to_date",
        "date_with_time": True,          # from 00:00:00, to 23:59:59
        "max_range_days": 5,             # Petpooja caps this report at a 5-day range
    },
    "sub_order_wise": {
        # CONFIRMED on the live portal 25 Jul 2026 (session with Pranjay). Sales summary
        # per outlet per channel. Lives in the BILLING app, which works across every
        # outlet: the "Restaurants" filter is left EMPTY and Petpooja reads that as all
        # of them (verified, one pull returned CC-CHD-*, CC-DL-*, ... together).
        #
        # Unlike the other reports this one is PRE-AGGREGATED over the chosen range, so a
        # multi-day pull returns one merged set and loses per-day detail. It must be
        # pulled ONE DAY AT A TIME (single_day below).
        "url": env("PETPOOJA_REPORT_URL_SUB_ORDER_WISE",
                   "https://billing.petpooja.com/custom_reports/view_report/67"),
        "strategy": env("PETPOOJA_SUB_ORDER_WISE_STRATEGY", "search_then_excel"),
        "needs_outlet": False,
        "outlet_label": None,
        "prefix": "suborder",
        # Plain text date inputs: verified live that NO DateTimePicker or flatpickr is
        # bound, so the direct-set path in _set_date_range applies and the value sticks.
        "start_sel": "input.start_fromdate",
        "end_sel": "input.end_todate",
        "search_sel": "input.re_final_search",
        "table_sel": "#re_pivot_table_1",
        # A DataTables client-side HTML5 export: it builds the file from the rendered
        # table, so there is no queued job and no stale-link trap. The table renders every
        # row on one page ("Showing 1 to 87 of 87 entries"), so the export is complete.
        "excel_sel": "button.buttons-excel",
        "single_day": True,
    },
}


# --------------------------- Supabase session store ---------------------------

def _session_object_url():
    base = env("SPINE_SUPABASE_URL", required=True)
    bucket = env("PETPOOJA_SESSION_BUCKET", "petpooja-session")
    return f"{base}/storage/v1/object/{bucket}/petpooja_session.json"


def pull_session():
    """Best effort: fetch a saved session from Supabase Storage to SESSION_FILE."""
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
        with open(SESSION_FILE, "wb") as f:
            f.write(r.content)
        print("session pulled from Supabase Storage.")
        return True
    return False


def push_session():
    """Upload the freshly-saved session so the cloud runner reuses it."""
    import requests
    key = env("SPINE_SUPABASE_SERVICE_ROLE_KEY")
    if not key or not os.path.exists(SESSION_FILE):
        return False
    with open(SESSION_FILE, "rb") as f:
        blob = f.read()
    r = requests.post(_session_object_url(), data=blob, headers={
        "Authorization": f"Bearer {key}", "apikey": key,
        "Content-Type": "application/json", "x-upsert": "true",
    }, timeout=30)
    if r.ok:
        print("session pushed to Supabase Storage.")
        return True
    print(f"session push failed: {r.status_code} {r.text[:120]}")
    return False


# ------------------------------- browser flow --------------------------------

def _is_headless():
    return env("PETPOOJA_HEADLESS", "1") not in ("0", "false", "False", "")


def _open_context(browser):
    kw = {"accept_downloads": True}
    if os.path.exists(SESSION_FILE):
        kw["storage_state"] = SESSION_FILE
    ctx = browser.new_context(**kw)
    ctx.set_default_timeout(SEL_TIMEOUT)
    ctx.set_default_navigation_timeout(NAV_TIMEOUT)
    return ctx


def _login_form_visible(page):
    try:
        page.wait_for_selector("[name='UserEmail'], #UserEmail", state="visible", timeout=3000)
        return True
    except Exception:
        return False


def perform_login(page, context):
    """Fill username + password, then wait for the human to answer the OTP. On a
    headless cloud runner there is no human, so a login prompt there means the saved
    session expired: fail loudly and tell the operator to re-run bootstrap."""
    user = env("PETPOOJA_USERNAME", required=True)
    pw = env("PETPOOJA_PASSWORD", required=True)
    if _is_headless():
        raise RuntimeError(
            "Petpooja asked for login on a headless runner: the saved session has "
            "expired. Re-run `python3 scrape.py bootstrap` from a laptop to refresh "
            "the OTP session (it re-pushes to Supabase Storage), then redeploy.")
    page.goto(portal(), wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
    page.fill("[name='UserEmail'], #UserEmail", user)
    page.locator(".ps-btn.sm-btn.primary-btn.w-100.mt-3").first.click()
    page.wait_for_selector("[name='UserLoginDetail'], #UserLoginDetail",
                           state="visible", timeout=SEL_TIMEOUT)
    page.fill("[name='UserLoginDetail'], #UserLoginDetail", pw)
    page.locator(".ps-btn.sm-btn.primary-btn.w-100.mt-3").last.click()
    input("Enter the OTP in the browser, finish login, then press ENTER here...")
    context.storage_state(path=SESSION_FILE)
    push_session()


def _select_outlet(page, label):
    """Scope the session to a specific Petpooja outlet (the vendor-OMS location).
    PORTAL-SPECIFIC: confirm the outlet switcher's selector on the live portal. Kept
    best-effort so a wrong guess does not crash the run; it logs and continues, and
    the downloaded file's title block still records which outlet it came from (the
    loader and recon read that, so a mis-scope is visible, never silent)."""
    try:
        page.get_by_text(label, exact=False).first.click(timeout=5000)
        page.wait_for_timeout(1500)
        print(f"outlet scoped to '{label}'.")
    except Exception as e:
        print(f"outlet switch to '{label}' not confirmed ({str(e)[:80]}); "
              f"continuing with the session's current outlet.")


def _pre_export(page, spec, server_type=None):
    """Report-specific step before Export. The online report hides historical dates
    behind a select2 dropdown (#server_type): 2 = Get old records (rolling ~2-day
    history), 1 = latest/current day. `server_type` overrides the spec default."""
    v = server_type or spec.get("server_type_value")
    if not v:
        return
    page.evaluate(
        """(val) => {
            const sel = document.querySelector('#server_type');
            if (sel && window.jQuery) { jQuery(sel).val(val).trigger('change'); }
        }""", v)
    page.wait_for_timeout(1000)
    print(f"server_type set to '{v}' ({'Get old records' if str(v) == '2' else 'latest/current'}).")


def _set_date_range(page, from_date, to_date, spec):
    """Set the report's From and To dates using this report's field selectors. Petpooja's
    date boxes are jQuery DateTimePicker widgets: setting the raw input value and firing
    'blur' makes the widget REVERT (this silently capped a range pull earlier). The
    reliable path is the widget's own .date() API. Verified on the live portal. Petpooja
    also cannot generate a very wide range in one export (30 days never returns; 7 days
    returns in under a minute), which is why the backfill walks weekly windows."""
    start_sel = spec.get("start_sel", "input[name='data[Order][startdate]']")
    end_sel = spec.get("end_sel", "input[name='data[Order][enddate]']")
    from_val, to_val = from_date, to_date
    if spec.get("date_with_time"):
        from_val, to_val = from_date + " 00:00:00", to_date + " 23:59:59"
    result = page.evaluate(
        """([startSel, endSel, fromV, toV]) => {
            const set = (sel, val) => {
                const el = document.querySelector(sel);
                if (el && window.jQuery && jQuery(el).data('DateTimePicker')) {
                    // pass a moment so the widget parses ISO unambiguously; a raw string
                    // is parsed against the widget's own display format and can mangle
                    // the date (an ISO string became "20 Jan 2000" on the online report).
                    const m = window.moment ? window.moment(val, ['YYYY-MM-DD HH:mm:ss','YYYY-MM-DD']) : val;
                    jQuery(el).data('DateTimePicker').date(m); return 'widget:' + el.value;
                }
                if (el) {
                    const s = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype, 'value').set;
                    s ? s.call(el, val) : (el.value = val);
                    el.dispatchEvent(new Event('change', {bubbles: true}));  // no blur
                    return 'direct:' + el.value;
                }
                return 'none';
            };
            return {start: set(startSel, fromV), end: set(endSel, toV)};
        }""", [start_sel, end_sel, from_val, to_val])
    page.wait_for_timeout(1500)
    print(f"date range set: {from_date} to {to_date} (start {result.get('start')}, end {result.get('end')}).")
    if result.get("start") == "none":
        print("  WARNING: from-date field not found; export could use the default range.")


def _clear_generated_reports(page):
    """The item report keeps a LIST of previously generated exports, each with its own
    Download link. Without clearing them, the scraper grabs a STALE link (this silently
    capped a 30-day pull at 2 days). Rishabh's proven pipeline clears first; so do we."""
    try:
        clear = page.locator("button:has-text('Clear All Reports')")
        if clear.is_visible(timeout=3000):
            clear.click()
            page.wait_for_timeout(3000)
            print("cleared previously generated reports.")
    except Exception as e:
        print(f"clear-reports step skipped ({str(e)[:60]}).")


def _download(page, spec, dest_dir, from_date=None, to_date=None, server_type=None):
    """Run the report's export and save the download. Two known Petpooja shapes:
    a direct #export button, or an Export click that queues a report and reveals a
    Download link (cleared of stale entries first, then the date set, then exported)."""
    strategy = spec["strategy"]
    prefix = spec["prefix"]
    if strategy == "export_button":
        _pre_export(page, spec, server_type)      # e.g. select 'Get old records'
        if from_date and to_date:
            _set_date_range(page, from_date, to_date, spec)
        page.wait_for_selector("#export", state="visible", timeout=SEL_TIMEOUT)
        with page.expect_download(timeout=180000) as di:
            page.click("#export")
    elif strategy == "export_then_download":
        _clear_generated_reports(page)            # remove stale links first
        _pre_export(page, spec)
        if from_date and to_date:
            _set_date_range(page, from_date, to_date, spec)  # set range after clearing
        page.locator("button:has-text('Export')").first.click()
        # after clearing, the only Download link that appears is our fresh export
        page.wait_for_selector("a:has-text('Download')", timeout=300000)
        page.wait_for_timeout(1500)
        with page.expect_download(timeout=180000) as di:
            page.locator("a:has-text('Download')").first.click()
    elif strategy == "search_then_excel":
        # Sub-Order Wise: set the dates, press Search, wait for the pivot table to
        # render, then press the DataTables Excel button. Confirmed live 25 Jul 2026.
        if from_date and to_date:
            _set_date_range(page, from_date, to_date, spec)
        page.click(spec["search_sel"])
        # Wait for rows to actually appear: the click is ajax, and exporting an empty
        # table would silently produce a header-only file.
        page.wait_for_selector(f"{spec['table_sel']} tbody tr", timeout=SEL_TIMEOUT)
        page.wait_for_timeout(2000)
        rows = page.locator(f"{spec['table_sel']} tbody tr").count()
        if rows == 0:
            raise RuntimeError("sub-order report returned no rows; refusing to export")
        print(f"search returned {rows} table rows.")
        with page.expect_download(timeout=180000) as di:
            page.click(spec["excel_sel"])
    elif strategy == "generate_then_fetch":
        # The online report does not stream a download: Export generates a file on S3
        # and the browser GETs a pre-signed URL that returns 503/404 until the object
        # is uploaded (no built-in retry, which is why a plain expect_download hangs).
        # We capture that URL from the network and poll it ourselves until it is ready.
        _pre_export(page, spec)
        if from_date and to_date:
            _set_date_range(page, from_date, to_date, spec)
        captured = {"url": None}
        page.on("request", lambda r: captured.__setitem__("url", r.url)
                if ("temp-uploads-live" in r.url and "order_report" in r.url) else None)
        page.wait_for_selector("#export", state="visible", timeout=SEL_TIMEOUT)
        page.click("#export")
        for _ in range(24):                       # up to ~60s for the URL to be requested
            if captured["url"]:
                break
            page.wait_for_timeout(2500)
        if not captured["url"]:
            raise RuntimeError("online export produced no file URL")
        url = captured["url"]
        resp = None
        for _ in range(72):                       # up to ~6 min for S3 to have the object
            resp = page.request.get(url)
            if resp.ok:
                path = os.path.join(dest_dir, f"{prefix}_order_report.xlsx")
                with open(path, "wb") as f:
                    f.write(resp.body())
                print(f"downloaded {path}")
                return path
            page.wait_for_timeout(5000)
        raise RuntimeError(f"online report file never became ready (last {resp.status if resp else '?'})")
    else:
        raise ValueError(f"unknown download strategy '{strategy}'")
    dl = di.value
    path = os.path.join(dest_dir, f"{prefix}_{dl.suggested_filename}")
    dl.save_as(path)
    print(f"downloaded {path}")
    return path


def _fetch_once(report, from_date=None, to_date=None, server_type=None):
    if report not in REPORTS:
        raise ValueError(f"no scrape recipe for report '{report}'")
    spec = REPORTS[report]
    dest = env("PETPOOJA_DOWNLOAD_DIR", tempfile.gettempdir())
    os.makedirs(dest, exist_ok=True)
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=_is_headless())
        context = _open_context(browser)
        try:
            page = context.new_page()
            page.on("dialog", lambda d: d.accept())
            page.goto(spec["url"], wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            if _login_form_visible(page):
                perform_login(page, context)
                page.goto(spec["url"], wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            if spec["needs_outlet"] and spec["outlet_label"]:
                _select_outlet(page, spec["outlet_label"])
                page.goto(spec["url"], wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
            return _download(page, spec, dest, from_date=from_date, to_date=to_date,
                             server_type=server_type)
        finally:
            try:
                browser.close()
            except Exception:
                pass


def scrape_and_download(report="oms_purchase", max_retries=2, days_back=0,
                        from_date=None, to_date=None, server_type=None):
    """Entry point used by ingest.py --scrape. Pulls any saved session first, then
    downloads with retry. Returns the local file path for the loader. Give an explicit
    from_date/to_date window (YYYY-MM-DD), or days_back for a window ending today.
    Keep windows small: Petpooja will not generate a very wide range in one export."""
    if days_back and not from_date:
        from_date = (dt.date.today() - dt.timedelta(days=days_back)).strftime("%Y-%m-%d")
        to_date = dt.date.today().strftime("%Y-%m-%d")
    pull_session()
    last = None
    for attempt in range(1, max_retries + 2):
        try:
            print(f"scrape {report} [{from_date or 'default'}..{to_date or 'default'}]: "
                  f"attempt {attempt}/{max_retries + 1}")
            return _fetch_once(report, from_date=from_date, to_date=to_date,
                               server_type=server_type)
        except Exception as e:
            last = e
            print(f"attempt {attempt} failed: {str(e)[:160]}")
            time.sleep(5)
    raise SystemExit(f"scrape failed after retries: {last}")


def _looks_logged_in(page):
    """The outlet switcher link is on every authenticated billing page and absent on
    the login screen, so it is a reliable 'logged in' signal."""
    try:
        return page.query_selector("a[href='#restro-select-pop-div']") is not None
    except Exception:
        return False


def bootstrap(timeout_s=480, poll_s=3):
    """One-time, headed, run from a laptop. Opens Petpooja; the USER logs in BY HAND
    (username, password, OTP) in the window. Nothing is auto-filled and no Petpooja
    password is ever read from the environment or seen by the agent. When login is
    detected, the session is saved and pushed to Supabase Storage for the cloud runner
    to reuse. Polls instead of waiting on a keypress, so it can run unattended-by-stdin."""
    import time as _t
    os.environ["PETPOOJA_HEADLESS"] = "0"
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = _open_context(browser)
        page = context.new_page()
        page.goto(portal(), wait_until="domcontentloaded", timeout=NAV_TIMEOUT)
        if _looks_logged_in(page):
            print("already logged in; refreshing and pushing session.")
        else:
            print("A browser window is open. Log in to Petpooja by hand "
                  "(username, password, OTP).")
            print(f"Waiting up to {timeout_s // 60} min for login to complete...")
            waited = 0
            while waited < timeout_s and not _looks_logged_in(page):
                _t.sleep(poll_s)
                waited += poll_s
            if not _looks_logged_in(page):
                browser.close()
                raise SystemExit("login not detected within the time limit; re-run to retry.")
            print("login detected.")
        context.storage_state(path=SESSION_FILE)
        push_session()
        browser.close()
    print("bootstrap complete: session saved and pushed to Supabase Storage.")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "bootstrap":
        bootstrap()
    else:
        report = sys.argv[1] if len(sys.argv) > 1 else "oms_purchase"
        print(scrape_and_download(report))
