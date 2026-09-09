"""Fetchers for the three Petpooja witness screens.

Session: the same saved Petpooja login the 8am scraper uses, pulled from its
Supabase Storage copy (petpooja-session bucket) through the sibling worker's
own functions, so there is never a second login and never a second OTP.

The two logs are read through the portal's search endpoint with plain HTTP
(no browser, no clicks): POST /logs/online_log_status_ajax/?page=N with the
same form the page posts, 15 rows a page. Read-only.

The Online Order Activity Report needs the session pointed at ONE outlet
(the portal's change_restaurant switcher, the same step the inventory scrape
uses) and is read with a headless browser, one outlet at a time. The scope is
put back to "All Outlets" (change_restaurant(0)) at the end, and verified, so
the morning scrape is never left on a single store.
"""
from __future__ import annotations
import json
import os
import re
import sys
import time
from datetime import date

import requests

HERE = os.path.dirname(os.path.abspath(__file__))
SIBLING = os.path.join(HERE, "..", "petpooja-ingest")
sys.path.insert(0, SIBLING)
import scrape as SC  # noqa: E402  (session_file, pull_session, _is_headless)

import parse as P  # noqa: E402

BASE = "https://billing.petpooja.com"
LOG_PAGE = BASE + "/logs/online_log_status/{flag}"
LOG_AJAX = BASE + "/logs/online_log_status_ajax/?page={page}"
ACTIVITY = BASE + "/reports/online_rider_report"
DASHBOARD = BASE + "/users/dashboard"
PAGE_SIZE = 15
POLITE_SLEEP = float(os.environ.get("PETPOOJA_LOGS_SLEEP", "0.4"))
ACCOUNT = os.environ.get("PETPOOJA_ACCOUNT", "primary")


def log(*a):
    print(*a, flush=True)


class SessionExpired(RuntimeError):
    """The saved login no longer works: only a hand OTP re-login fixes it (F24)."""


# ------------------------------------------------------------------ session

def load_session() -> dict:
    """Pull the saved session and return Playwright's storage_state dict."""
    SC.pull_session(ACCOUNT)
    path = SC.session_file(ACCOUNT)
    if not os.path.exists(path):
        raise SessionExpired(f"no saved Petpooja session at {path}; run "
                             f"`python3 ../petpooja-ingest/scrape.py bootstrap {ACCOUNT}` by hand")
    with open(path) as f:
        return json.load(f)


def http_session(state: dict) -> requests.Session:
    s = requests.Session()
    for c in state.get("cookies", []):
        s.cookies.set(c["name"], c["value"], domain=c["domain"].lstrip("."), path=c.get("path", "/"))
    s.headers.update({"User-Agent": "Mozilla/5.0 (Macintosh) CremeCastleERP/petpooja-logs",
                      "X-Requested-With": "XMLHttpRequest"})
    return s


def _check_logged_in(html: str):
    if "UserEmail" in html and "UserLoginDetail" in html:
        raise SessionExpired("Petpooja asked for login: the saved session has expired (F24). "
                             "Re-login by hand: python3 ../petpooja-ingest/scrape.py bootstrap primary")


# ------------------------------------------------------------------ outlets

def list_outlets(s: requests.Session) -> list[tuple[str, str]]:
    """[(rest_id, label)] from the log page's outlet dropdown, e.g.
    ('317707', '317707 - CC-DL-Janakpuri'). 'All' is skipped."""
    r = s.get(LOG_PAGE.format(flag=1), timeout=60, headers={"X-Requested-With": ""})
    r.raise_for_status()
    _check_logged_in(r.text)
    m = re.search(r"<select[^>]*name=['\"]restaurant_m['\"][^>]*>(.*?)</select>", r.text, re.S)
    if not m:
        raise RuntimeError("outlet dropdown (restaurant_m) not found on the log page")
    out = []
    for val, label in re.findall(r"<option[^>]*value=['\"]([^'\"]*)['\"][^>]*>(.*?)</option>", m.group(1), re.S):
        label = P.clean(label)
        if val.strip().isdigit():
            out.append((val.strip(), label))
    if not out:
        raise RuntimeError("outlet dropdown had no numeric outlet ids")
    return out


# ------------------------------------------------------------------ logs

def _day_label(d: date) -> str:
    return f"{d.day} {d.strftime('%b %Y')}"


def fetch_log(s: requests.Session, flag: int, rest_id: str, day: date, max_pages=400) -> tuple[list[dict], int]:
    """All rows of one log (flag 1 store, 2 item) for one outlet and one day.
    Returns (rows, total_reported)."""
    form = {"restaurant_m": str(rest_id), "startdate": _day_label(day), "enddate": _day_label(day),
            "identifier[]": "all", "log_type": "1", "selected_restaurant_id": str(rest_id),
            "flag": str(flag), "search_text": ""}
    headers = {"Referer": LOG_PAGE.format(flag=flag)}
    rows, total, page = [], None, 1
    while page <= max_pages:
        r = s.post(LOG_AJAX.format(page=page), data=form, headers=headers, timeout=(15, 90))
        r.raise_for_status()
        html = r.text
        _check_logged_in(html)
        sh = P.showing(html)
        if sh is None:
            if page == 1:
                return [], 0
            break
        first, last, total = sh
        parsed = P.parse_store_log(html, rest_id, day) if flag == 1 else P.parse_item_log(html, rest_id, day)
        rows.extend(parsed)
        if last >= total or not parsed:
            break
        page += 1
        time.sleep(POLITE_SLEEP)
    return rows, (total or 0)


# ------------------------------------------------------------------ activity

def _scope(page, rest_id: int, attempts: int = 3):
    """Point the session at one outlet and VERIFY it took (the dashboard's
    hidden header_changed_rest_id field). change_restaurant() posts and then
    reloads; on the first build the report was opened before the reload had
    committed and Petpooja bounced it to the reports hub, so this now waits,
    re-reads the dashboard, and retries."""
    for attempt in range(1, attempts + 1):
        page.goto(DASHBOARD, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(800)
        if not page.evaluate("typeof change_restaurant === 'function'"):
            raise RuntimeError("outlet switcher not available on the billing dashboard")
        try:
            with page.expect_navigation(timeout=60000):
                page.evaluate(f"change_restaurant({int(rest_id)})")
        except Exception as e:
            log(f"  scope attempt {attempt}: navigation wait ended ({type(e).__name__})")
        page.wait_for_timeout(3000)
        page.goto(DASHBOARD, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(800)
        got = _scope_value(page)
        head = page.evaluate("() => document.body.innerText.slice(0,60).replace(/\\s+/g,' ')")
        if str(got) == str(rest_id) or (rest_id == 0 and "All Outlets" in head):
            log(f"  scope set to {rest_id} (attempt {attempt}, header: {head[:40]})")
            return
        log(f"  scope attempt {attempt}: field says {got!r}, header {head[:40]!r}; retrying")
        page.wait_for_timeout(2000)
    raise RuntimeError(f"scope did not stick for outlet {rest_id} after {attempts} attempts")


def _scope_value(page) -> str:
    return page.evaluate("() => (document.querySelector(\"input[name='header_changed_rest_id']\")||{}).value || ''")


def restore_all_outlets(page) -> bool:
    """Put the session back on All Outlets and verify. Returns True when verified."""
    try:
        _scope(page, 0)
        page.goto(DASHBOARD, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(1000)
        head = page.evaluate("() => document.body.innerText.slice(0,120)")
        ok = "All Outlets" in head or _scope_value(page) in ("0", "")
        log(f"scope restore: {'verified All Outlets' if ok else 'NOT verified: ' + head[:60]}")
        return ok
    except Exception as e:
        log(f"scope restore failed: {type(e).__name__}: {str(e)[:120]}")
        return False


def _read_table(page) -> tuple[list[str], list[list[str]]]:
    data = page.evaluate("""() => {
      const t = document.querySelector('table');
      if (!t) return {h: [], r: []};
      const h = Array.from(t.querySelectorAll('thead th, tr:first-child th')).map(x => x.innerText.replace(/\\s+/g,' ').trim());
      const r = Array.from(t.querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.replace(/\\s+/g,' ').trim()));
      return {h, r};
    }""")
    return data["h"], [row for row in data["r"] if row]


def _record_type_options(page) -> list[tuple[str, str]]:
    return page.evaluate("""() => Array.from(document.querySelectorAll('select')).flatMap(s =>
        Array.from(s.options).map(o => [s.name || s.id, o.value, o.text.trim()]))
        .filter(x => /record|server|type/i.test(x[0]) || /record/i.test(x[2])).map(x => [x[1], x[2]])""")


def fetch_activity(state: dict, outlets: list[tuple[str, str]], want_days: set[date],
                   on_outlet=None) -> tuple[dict[str, list[dict]], dict]:
    """For each outlet: scope, open the activity report, read every record type
    the page offers, page through the table, keep orders received on want_days.
    Returns ({rest_id: rows}, diagnostics). Always restores All Outlets."""
    from playwright.sync_api import sync_playwright
    result, diag = {}, {"record_types": None, "restored": None, "errors": {}}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=SC._is_headless())
        ctx = browser.new_context(storage_state=state, viewport={"width": 1400, "height": 1000})
        page = ctx.new_page()
        try:
            for rid, label in outlets:
                try:
                    _scope(page, int(rid))
                    page.goto(ACTIVITY, wait_until="domcontentloaded", timeout=60000)
                    page.wait_for_timeout(2500)
                    if "online_rider_report" not in page.url:
                        bounced = page.url
                        page.goto(DASHBOARD, wait_until="domcontentloaded", timeout=60000)
                        raise RuntimeError(f"report redirected to {bounced}; dashboard scope field now reads {_scope_value(page)!r}")
                    opts = _record_type_options(page)
                    if diag["record_types"] is None:
                        diag["record_types"] = opts
                        log(f"activity report record types: {opts}")
                    rows_all: dict[str, dict] = {}
                    seen_min = seen_max = None       # reach of the report, before the window filter
                    values = [v for v, _ in opts] or [None]
                    for val in values:
                        if val is not None:
                            try:
                                page.evaluate("""(v) => { const s = Array.from(document.querySelectorAll('select'))
                                    .find(s => Array.from(s.options).some(o => o.value === v));
                                    if (s) { s.value = v; s.dispatchEvent(new Event('change', {bubbles: true})); } }""", val)
                                btn = page.get_by_role("button", name=re.compile(r"^Search$", re.I))
                                if btn.count():
                                    btn.first.click(timeout=8000)
                                page.wait_for_timeout(4000)
                            except Exception as e:
                                log(f"  record type {val}: search click skipped ({type(e).__name__})")
                        seen_pages = 0
                        while True:
                            headers, rows = _read_table(page)
                            if not headers:
                                break                      # no table at all: an outlet with no online orders
                            for rec in P.parse_activity_rows(headers, rows, rid, min(want_days).year):
                                bd = rec["business_date"]
                                seen_min = bd if seen_min is None or bd < seen_min else seen_min
                                seen_max = bd if seen_max is None or bd > seen_max else seen_max
                                if bd in want_days:
                                    rows_all[rec["order_id"]] = rec
                            seen_pages += 1
                            if seen_pages >= 200:
                                break
                            # pager: a live "Next" that is not disabled. Petpooja renders the
                            # link even on the last page (found 9 Sep: three outlets timed out
                            # clicking a Next that could not be clicked), so check its state and
                            # never let one click kill the outlet.
                            nxt = page.locator("li.next:not(.disabled) a, a.next:not(.disabled), a[rel='next']:not(.disabled)").first
                            try:
                                if not nxt.count() or not nxt.is_visible():
                                    break
                                parent_cls = nxt.evaluate("e => (e.parentElement && e.parentElement.className) || ''")
                                if "disabled" in (nxt.get_attribute("class") or "") or "disabled" in parent_cls:
                                    break
                                before = page.evaluate("() => document.querySelector('table tbody') ? document.querySelector('table tbody').innerText.slice(0,200) : ''")
                                nxt.click(timeout=8000)
                                page.wait_for_timeout(2500)
                                after = page.evaluate("() => document.querySelector('table tbody') ? document.querySelector('table tbody').innerText.slice(0,200) : ''")
                                if after == before:
                                    break                  # the click changed nothing: last page
                            except Exception as e:
                                log(f"  pager stopped on page {seen_pages} ({type(e).__name__})")
                                break
                    result[rid] = list(rows_all.values())
                    diag.setdefault("reach", {})[rid] = (str(seen_min), str(seen_max))
                    log(f"  {label}: report reaches {seen_min} to {seen_max} (business dates), "
                        f"{len(result[rid])} orders kept for the window")
                    if on_outlet:
                        on_outlet(rid, label, len(result[rid]))
                except Exception as e:
                    diag["errors"][rid] = f"{type(e).__name__}: {str(e)[:160]}"
                    log(f"  {label}: {diag['errors'][rid]}")
                time.sleep(POLITE_SLEEP)
        finally:
            diag["restored"] = restore_all_outlets(page)
            browser.close()
    return result, diag
