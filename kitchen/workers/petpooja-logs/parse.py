"""Parsers for the three Petpooja witness screens. Pure functions, no network,
no database, so they can be tested on saved pages.

Two of the screens are read through the portal's own search endpoint
(POST /logs/online_log_status_ajax/?page=N), which returns an HTML table of
15 rows with "Showing 1 to 15 of N records". The dates in that table carry no
year ("05 Sep | 23:55:21"), so every parser takes the query date and uses its
year. The third screen (the Online Order Activity Report) is read as a table
whose header names the columns, so it is parsed by header.
"""
from __future__ import annotations
import hashlib
import html as htmlmod
import json
import re
from datetime import date, datetime, timedelta

MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

_TR = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
_TD = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
_TH = re.compile(r"<th[^>]*>(.*?)</th>", re.S)
_TAG = re.compile(r"<[^>]+>")
_BR = re.compile(r"<br\s*/?>", re.I)
_SHOWING = re.compile(r"Showing\s+(\d+)\s+to\s+(\d+)\s+of\s+(\d+)\s+records", re.I)


def row_hash(row: dict) -> str:
    parts = [f"{k}={row[k]}" for k in sorted(row) if not k.startswith("_")]
    return hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()


def clean(cell_html: str) -> str:
    """Tags removed, entities decoded, whitespace collapsed."""
    return re.sub(r"\s+", " ", htmlmod.unescape(_TAG.sub(" ", cell_html))).strip()


def parts(cell_html: str) -> list[str]:
    """Split a cell on <br> and return the non-empty cleaned pieces."""
    out = []
    for piece in _BR.split(cell_html):
        t = clean(piece)
        if t:
            out.append(t)
    return out


def showing(html: str):
    """(first, last, total) from the 'Showing 1 to 15 of 82 records' line, or None."""
    m = _SHOWING.search(html)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


def parse_day_time(text: str, year: int) -> datetime | None:
    """'05 Sep | 23:55:21' or '05 Sep 23:59' or '5 Sep 2026 23:55:21' -> datetime."""
    t = text.replace("|", " ").strip()
    m = re.match(r"(\d{1,2})\s+([A-Za-z]{3})(?:\s+(\d{4}))?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?", t)
    if not m:
        return None
    d, mon, y, hh, mm, ss = m.groups()
    mon_n = MONTHS.get(mon[:3].title())
    if not mon_n:
        return None
    return datetime(int(y) if y else year, mon_n, int(d), int(hh), int(mm), int(ss or 0))


def body_rows(html: str) -> list[list[str]]:
    """Every <tr> that has <td> cells, as a list of raw cell HTML."""
    rows = []
    for tr in _TR.findall(html):
        tds = _TD.findall(tr)
        if tds:
            rows.append(tds)
    return rows


def header_cells(html: str) -> list[str]:
    return [clean(th) for th in _TH.findall(html)]


def _json_pair(cell_html: str):
    """The last cell of both logs holds two hidden spans, id request_logs_data_N
    and response_logs_data_N, with the raw JSON. Return (request, response)."""
    req = re.search(r'id="request_logs_data_\d+"[^>]*>(.*?)</span>', cell_html, re.S)
    resp = re.search(r'id="response_logs_data_\d+"[^>]*>(.*?)</span>', cell_html, re.S)
    if req or resp:
        return (clean(req.group(1)) if req else ""), (clean(resp.group(1)) if resp else "")
    ps = parts(cell_html)
    js = [p for p in ps if p.startswith("{") or p.startswith("[")]
    if len(js) >= 2:
        return js[0], js[-1]
    if len(js) == 1:
        return js[0], ""
    return (ps[0] if ps else ""), ""


def _app_from(text: str) -> str:
    t = text.lower()
    if "zomato" in t:
        return "zomato"
    if "swiggy" in t:
        return "swiggy"
    return "other"


# ------------------------------------------------------------------ store log

def parse_store_log(html: str, rest_id: str, query_day: date) -> list[dict]:
    """Rows of landing.petpooja_store_status_log (without run id and hash).
    Live layout (9 Sep 2026): 6 cells: date | client hash | request type with
    the ON/OFF in a span | http status | user details | request+response spans."""
    out = []
    for tds in body_rows(html):
        if len(tds) < 6:
            continue
        logged = parse_day_time(clean(tds[0]), query_day.year)
        if not logged:
            continue
        if len(tds) >= 7:                      # an older layout with a separate status cell
            rt_cell, st_cell, http_i, user_i, json_i = tds[2], tds[3], 4, 5, 6
        else:
            rt_cell, st_cell, http_i, user_i, json_i = tds[2], None, 3, 4, 5
        m = re.search(r'class="stor-(on|off)"[^>]*>\s*(ON|OFF)', rt_cell, re.I)
        status = (m.group(2).upper() if m else (clean(st_cell).replace("Store", "").strip().upper() if st_cell else ""))
        request_type = re.sub(r"\s*\b(ON|OFF)\s*$", "", clean(rt_cell)).strip()
        user = clean(tds[user_i])
        req, resp = _json_pair(tds[json_i])
        ul = user.lower()
        if "get outlet status" in ul or request_type.lower().startswith("check status"):
            kind = "poll"                       # Petpooja asked the app for the status
        elif ul.startswith("from zomato end") or ul.startswith("from swiggy end"):
            kind = "platform"                   # the app told Petpooja (webhook): a close/open from the app's side
        elif "update outlet status from pos" in ul or request_type:
            kind = "manual"                     # a person switched the store from the POS
        else:
            kind = "other"
        app = _app_from(user)
        if app == "other":
            app = _app_from(req)
        if not status and kind == "platform":
            # Zomato: {"zomato_online_order_status": true/false, "reason": "Your outlet is Open/Closed ..."}
            # Swiggy: {"reason": "Dear Partner, we noticed you have switched off ..."}
            try:
                j = json.loads(req) if req else {}
            except Exception:
                j = {}
            zs = j.get("zomato_online_order_status")
            text = (str(j.get("reason", "")) + " " + user).lower()
            if zs is True or " is open" in text:
                status = "ON"
            elif zs is False or " is closed" in text or "switched off" in text:
                status = "OFF"
        out.append({
            "business_date": logged.date(),
            "petpooja_rest_id": str(rest_id),
            "client_hash": clean(tds[1]),
            "logged_at": logged,
            "app": app,
            "event_kind": kind,
            "request_type": request_type,
            "current_status": status or None,
            "http_status": clean(tds[http_i]),
            "user_details": user,
            "request_json": req,
            "response_json": resp,
        })
    return out


# ------------------------------------------------------------------ item log

def classify_trigger(user_details: str):
    """Pranjay's rule: a person at the POS is MANUAL, Petpooja's stock rule is
    AUTOMATIC. The user column reads 'biller (biller) from pos(new) (ip)' for a
    person and 'System (biller) from pos(new) (ip)' for the stock rule."""
    name = user_details.split(" (")[0].strip() if user_details else ""
    low = name.lower()
    if not name:
        return "unknown", name
    if low == "system" or "real time inventory" in user_details.lower():
        return "automatic", name
    return "manual", name


def parse_item_log(html: str, rest_id: str, query_day: date) -> list[dict]:
    """Rows of landing.petpooja_item_toggle_log (without run id and hash)."""
    out = []
    for tds in body_rows(html):
        if len(tds) < 7:
            continue
        logged = parse_day_time(clean(tds[0]), query_day.year)
        if not logged:
            continue
        po = parts(tds[1])                      # ['Swiggy', 'CC-DL-Janakpuri']
        app = _app_from(po[0]) if po else "other"
        outlet_name = po[1] if len(po) > 1 else ""
        rq_text = clean(tds[2])                 # 'ITEM - OFF 05 Sep | 23:59 - 07 Sep | 00:00'
        m = re.match(r"(ITEM|VARIATION|[A-Z ]+?)\s*-\s*(ON|OFF)\s*(.*)$", rq_text, re.I)
        object_type = m.group(1).strip().upper() if m else rq_text.split("-")[0].strip().upper()
        action = m.group(2).strip().upper() if m else ""
        window_text = m.group(3).strip() if m else ""
        wf = wt = None
        if window_text and window_text != "-":
            halves = [h.strip() for h in window_text.split(" - ", 1)]
            if len(halves) == 2:
                wf = parse_day_time(halves[0], query_day.year)
                wt = parse_day_time(halves[1], query_day.year)
                if wf and wt and wt < wf:      # a window crossing the new year
                    wt = wt.replace(year=wt.year + 1)
        items_text = clean(tds[3])
        # "<id> - <name>[ via Real time inventory, based on stock affected of raw
        # materials <stock item> [ Real-Time Stock : 0 Piece , At par Stock : 1 Piece ]]"
        # one or more times, joined by ", " or a space.
        ids, names, reasons, stock_items, rts, pars = [], [], [], [], [], []
        entries = re.split(r"(?:,\s*|\s+)(?=\d{5,}\s*-\s)", items_text)
        for ent in entries:
            m2 = re.match(r"(\d{5,})\s*-\s*(.*)$", ent.strip())
            if not m2:
                if ent.strip():
                    names.append(ent.strip())
                continue
            iid, rest = m2.group(1), m2.group(2).strip()
            name, reason = rest, ""
            mv = re.search(r"\s+via\s+", rest)
            if mv:
                name, reason = rest[:mv.start()].strip(), rest[mv.start():].strip()
            ids.append(iid); names.append(name.rstrip(","))
            if reason:
                reasons.append(reason)
                ms = re.search(r"raw materials\s+(.*?)\s*\[\s*Real-Time Stock\s*:\s*([^,\]]+?)\s*,\s*At par Stock\s*:\s*([^\]]+?)\s*\]", reason)
                if ms:
                    stock_items.append(ms.group(1).strip()); rts.append(ms.group(2).strip()); pars.append(ms.group(3).strip())
        user = clean(tds[5])
        trigger, actor_name = classify_trigger(user)
        req, resp = _json_pair(tds[6])
        # the request JSON also names the ids; prefer it when the cell was cut short
        try:
            j = json.loads(req) if req else {}
            jid = j.get("catalogueVendorEntityIds") or j.get("externalItemIds")
            if jid and len(jid) >= len(ids):
                ids = [str(x) for x in jid]
        except Exception:
            pass
        out.append({
            "business_date": logged.date(),
            "petpooja_rest_id": str(rest_id),
            "outlet_name": outlet_name,
            "app": app,
            "logged_at": logged,
            "action": action or "UNKNOWN",
            "object_type": object_type,
            "trigger": trigger,
            "actor_name": actor_name,
            "actor": user,
            "window_from": wf,
            "window_to": wt,
            "item_ids": ",".join(ids),
            "item_names": ", ".join(names),
            "reason": " | ".join(reasons) or None,
            "stock_item": " | ".join(dict.fromkeys(stock_items)) or None,
            "stock_realtime": " | ".join(rts) or None,
            "stock_par": " | ".join(pars) or None,
            "http_status": clean(tds[4]),
            "request_json": req,
            "response_json": resp,
        })
    return out


# ------------------------------------------------------------------ activity

ACTIVITY_COLS = {
    "restaurant id": "petpooja_rest_id", "client sharing code": "client_hash",
    "identifier": "identifier", "order id": "order_id", "order status": "order_status",
    "received time": "received_at", "accepted time": "accepted_at",
    "mark ready time": "mark_ready_at", "rider arrival time": "rider_arrival_at",
    "picked up time": "picked_up_at", "delivered time": "delivered_at",
    "cancelled time": "cancelled_at", "returned to store time": "returned_at",
}
TIME_COLS = ["received_at", "accepted_at", "mark_ready_at", "rider_arrival_at",
             "picked_up_at", "delivered_at", "cancelled_at", "returned_at"]


def app_guess(order_id: str) -> str:
    s = (order_id or "").strip()
    if re.fullmatch(r"\d{15,}", s):
        return "swiggy"
    if re.fullmatch(r"\d{9,11}", s):
        return "zomato"
    return "other"


def parse_activity_rows(headers: list[str], rows: list[list[str]], rest_id: str, year: int) -> list[dict]:
    """rows are lists of cleaned cell text in header order (from the HTML table
    or a CSV export). Returns rows of landing.petpooja_order_activity."""
    idx = {}
    for i, h in enumerate(headers):
        key = ACTIVITY_COLS.get(re.sub(r"\s+", " ", h).strip().lower())
        if key:
            idx[key] = i
    if "order_id" not in idx:
        raise ValueError(f"activity table has no Order ID column; headers were {headers}")
    out = []
    for r in rows:
        def cell(k):
            i = idx.get(k)
            return r[i].strip() if i is not None and i < len(r) else ""
        oid = cell("order_id")
        if not oid:
            continue
        rec = {"petpooja_rest_id": str(cell("petpooja_rest_id") or rest_id),
               "client_hash": cell("client_hash"), "identifier": cell("identifier"),
               "order_id": oid, "app_guess": app_guess(oid), "order_status": cell("order_status")}
        for k in TIME_COLS:
            rec[k] = parse_day_time(cell(k), year) if cell(k) else None
        # Petpooja's business day ends at 04:00 (F11): an order received at
        # 00:30 belongs to the previous date, exactly as petpooja_online_orders
        # files it. Verified 9 Sep 2026: the 17 orders "missing" from Janakpuri
        # 8 Sep were all received 00:01 to 01:50 on 9 Sep.
        t = rec["received_at"] or rec["accepted_at"] or datetime(year, 1, 1)
        rec["business_date"] = (t - timedelta(hours=4)).date()
        rec["raw_json"] = json.dumps({h: (r[i] if i < len(r) else "") for i, h in enumerate(headers)}, ensure_ascii=False)
        out.append(rec)
    return out


def activity_from_html(html: str, rest_id: str, year: int) -> list[dict]:
    headers = header_cells(html)
    rows = [[clean(td) for td in tds] for tds in body_rows(html)]
    return parse_activity_rows(headers, rows, rest_id, year)
