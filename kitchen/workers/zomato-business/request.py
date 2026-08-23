"""Report requester for the Zomato enterprise business reports.

Rather than drive the three-step form (aggregation pills, a React date-range
calendar, then a nested checkbox tree), this opens the reporting page, lets the
app fetch its own download-form-config, and then REPLAYS the submit call the
form itself would have made, from inside the page so cookies and the app's
x-zomato-mx-csrf-token / device / session headers all apply.

The config also hands us, verbatim, the brandIds and the postbackParams string
carrying the city, legal-entity and outlet id filters, so nothing about the
account is hardcoded here.

Breakdown-to-metric rules, measured 21 Aug 2026 and documented in
erp-plan/zomato-business-reports-catalogue.md section 15. Ticking a breakdown
removes whole metric groups, and all four at once leaves nothing selectable:

    breakdowns                       metric groups removed
    ------------------------------   ---------------------------------------
    (none)                           none                       -> 100 delivered
    mealtime                         Ads                        ->  87
    nrl                              Service quality, Kitchen   ->  72
    nrl + offerSensitive + mealtime  Service quality, Kitchen, Ads -> 58
    spendingPotential                everything except Ads      ->  14
"""
from __future__ import annotations

import json
import re
from datetime import datetime, time, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
PAGE = "https://www.zomato.com/partners/business/performance/reporting/"

SQ, KE, ADS = "Service quality", "Kitchen efficiency", "Ads"

# shape -> (aggLevel, breakupLevel, groups to EXCLUDE, or an explicit keep-list)
SHAPES = {
    "quality":     ("outlet", [],                                            set(),          None),
    "segment":     ("outlet", ["nrl", "offerSensitive", "mealtime"],         {SQ, KE, ADS},  None),
    "ads_sp":      ("outlet", ["spendingPotential"],                         None,           {ADS}),
    "ads_nrl":     ("outlet", ["nrl"],                                       None,           {ADS}),
    "order":       ("order",  [],                                            set(),          "ORDER"),
}


def _find_download_button(page):
    page.evaluate("""() => { const t=[...document.querySelectorAll('button')].find(x=>{
        const r=x.getBoundingClientRect();
        return !x.innerText.trim() && r.width>=45 && r.height>=45 && r.y>100 && r.y<250; });
        if(!t) throw new Error('download button not found'); t.click(); }""")


def fetch_form_config(page, timeout_ms=20000):
    """Click the download button and return (config, headers).

    The headers matter: api.zomato.com is a different origin from the page, and
    the API rejects a bare cross-origin fetch. The app's own calls carry
    x-zomato-mx-csrf-token, x-zomato-device-id, x-zomato-session-id, x-client-id
    and x-zomato-source-identifier, so the replayed submit must carry them too.
    They are lifted off the request the app just made rather than guessed."""
    holder = {}
    def on_resp(r):
        if r.url.split("?")[0].endswith("download-form-config"):
            try:
                holder["cfg"] = json.loads(r.text())
                holder["headers"] = dict(r.request.headers)
            except Exception:
                pass
    page.on("response", on_resp)
    _find_download_button(page)
    waited = 0
    while "cfg" not in holder and waited < timeout_ms:
        page.wait_for_timeout(500); waited += 500
    if "cfg" not in holder:
        raise RuntimeError("download-form-config was never returned")
    hdrs = {k: v for k, v in holder.get("headers", {}).items()
            if k.lower().startswith("x-") or k.lower() == "content-type"}
    hdrs["content-type"] = "application/json"
    return holder["cfg"], hdrs


def _dashboard_metric_groups(cfg, with_group_ids=False):
    for s in cfg["sections"]:
        if s["id"] == "metricsSelection":
            for row in s["rows"]:
                for f in row["fields"]:
                    if f["id"] == "metricIds":
                        opts = f["data"]["options"]
                        groups = {g["title"]: [c["optionId"] for c in g["childOptions"]
                                               if not c.get("isDisabled")] for g in opts}
                        if with_group_ids:
                            return groups, {g.get("optionId") for g in opts if g.get("optionId")}
                        return groups
    raise RuntimeError("metricsSelection not found in config")


def _walk_options(node, out):
    """Collect every {title, optionId, isDisabled} dict anywhere in the config.
    Walked rather than regexed: the JSON puts isDisabled BEFORE optionId, so a
    positional pattern silently matches nothing."""
    if isinstance(node, dict):
        if "optionId" in node:
            out.append((node.get("title"), node["optionId"], bool(node.get("isDisabled"))))
        for v in node.values():
            _walk_options(v, out)
    elif isinstance(node, list):
        for v in node:
            _walk_options(v, out)
    return out


def _order_metric_ids(cfg):
    """Order-level metric ids live in the aggLevel dependency block, not in the
    default section. Take every optionId there, minus the dashboard metrics,
    minus group headers (whose optionId equals their title), minus disabled ones
    (this account cannot select the three customer segment columns, nor
    Customer refund amount, Total Discount or Total voucher discount)."""
    groups, group_ids = _dashboard_metric_groups(cfg, with_group_ids=True)
    dash = {oid for ids in groups.values() for oid in ids}
    # Group PARENT ids (sales_overview, offers, ads, ...) also carry an optionId and
    # are not metrics. Sending them is accepted with HTTP 200 and then the report is
    # silently never generated, which cost 20 minutes on 22 Aug 2026. Exclude them
    # by id, not by comparing optionId to title: the parent's title is "Sales
    # overview" while its optionId is "sales_overview", so a title comparison misses.
    out, seen = [], set()
    for title, oid, disabled in _walk_options(cfg, []):
        if oid in dash or oid in group_ids or oid == title or disabled or oid in seen:
            continue
        seen.add(oid); out.append(oid)
    if not out:
        raise RuntimeError("no order-level metric ids found in config")
    return out


def build_values(cfg, shape, day_from, day_to):
    agg, breakups, exclude, keep = SHAPES[shape]
    if keep == "ORDER":
        metric_ids = _order_metric_ids(cfg)
        duration = {"aggLevel": "daily",
                    "startTime": int(datetime.combine(day_from, time(0, 0), IST).timestamp()),
                    "endTime": int(datetime.combine(day_to, time(23, 59, 59), IST).timestamp())}
        return {"aggLevel": agg, "duration": duration, "metricIds": metric_ids,
                "breakupLevel": [], "sendTo": []}
    groups = _dashboard_metric_groups(cfg)
    if keep is not None:
        metric_ids = [i for g, ids in groups.items() if g in keep for i in ids]
    else:
        metric_ids = [i for g, ids in groups.items() if g not in exclude for i in ids]
    duration = {"aggLevel": "daily",
                "startTime": int(datetime.combine(day_from, time(0, 0), IST).timestamp()),
                "endTime": int(datetime.combine(day_to, time(23, 59, 59), IST).timestamp())}
    return {"aggLevel": agg, "duration": duration, "metricIds": metric_ids,
            "breakupLevel": breakups, "sendTo": []}


def submit(page, cfg, headers, values):
    """Replay the form's own POST from inside the page, with the app's headers."""
    action = cfg["footer"][1]["data"]["clickAction"]["data"]
    payload = {"brandIds": action["body"]["brandIds"],
               "postbackParams": action["body"]["postbackParams"],
               "values": values}
    return page.evaluate(
        """async ([url, payload, headers]) => {
             const r = await fetch(url, {method:'POST', credentials:'include',
                 headers: headers, body: JSON.stringify(payload)});
             return {status: r.status, text: (await r.text()).slice(0, 400)};
           }""", [action["url"], payload, headers])


def request_reports(session_file, shapes, day_from, day_to, headless=True, viewport=None):
    """Fire one report request per shape. Returns [{shape, metrics, status, text}]."""
    from playwright.sync_api import sync_playwright
    out = []
    with sync_playwright() as p:
        b = p.firefox.launch(headless=headless)
        try:
            c = b.new_context(storage_state=session_file,
                              viewport=viewport or {"width": 1600, "height": 1000})
            page = c.new_page()
            page.goto(PAGE, wait_until="domcontentloaded", timeout=90000)
            page.wait_for_timeout(14000)
            cfg, hdrs = fetch_form_config(page)
            for shape in shapes:
                values = build_values(cfg, shape, day_from, day_to)
                res = submit(page, cfg, hdrs, values)
                out.append({"shape": shape, "metrics": len(values["metricIds"]),
                            "breakups": values["breakupLevel"], **res})
                page.wait_for_timeout(2500)
        finally:
            b.close()
    return out
