"""Parsers for the Zomato enterprise business reports.

Pure functions: CSV text in, row dicts out. No network, no database, so every
contract below is testable offline against erp-plan/data-samples/.

Design doc: erp-plan/zomato-business-reports-catalogue.md
Schema:     kitchen/migrations/130_zomato_business_reports.sql

The six loader contracts from the migration header are implemented here:
  1. the quality cube is read POSITIONALLY (its header has duplicate names);
  2. order timestamps say "+0000 UTC" and are IST, so they are parsed as IST;
  3. item lines come out of items_in_order, whose names contain square brackets,
     and must sum to order_subtotal;
  4. net sales means two different things, so nothing is renamed here;
  5. food_prep_time units are unknown, so it is carried as raw text;
  6. the grid is sparse, so absent combinations are simply absent.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
from datetime import date, datetime, time, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))

# Source positions of the 28 metrics that exist ONLY in the no-breakdown quality
# file (23 service quality + 5 kitchen efficiency). Positional by contract 1:
# positions 65 and 68 are the ALL-ORDERS "Poor packaging or spillage" and
# "Others complaints", whose names collide with the large-order columns.
QUALITY_POSITIONS = list(range(45, 50)) + [51, 52, 53] + list(range(55, 70)) + list(range(75, 80))

DIMENSION_HEADERS = {
    "Restaurant ID", "City", "Subzone", "Brand name", "Mealtime",
    "NRL customer", "Offer sensitivity", "Spending potential", "Date",
}

# Mealtime windows, as Zomato defines them on the drill-down page.
MEALTIMES = (
    ("Breakfast", 7, 11), ("Lunch", 11, 16), ("Snacks", 16, 19), ("Dinner", 19, 23),
)


class ParseError(ValueError):
    pass


def snake(header: str) -> str:
    s = header.replace("%", "pct").replace("/", " or ").replace("+", " plus ").replace("&", "and")
    s = re.sub(r"[^0-9a-zA-Z]+", "_", s).strip("_").lower()
    return re.sub(r"_+", "_", s)


def parse_business_date(raw: str) -> date:
    """Aggregate cubes mix date formats inside a single file: '07/01/26' and
    '7/27/2026' both appear, and monthly pulls use 'Apr 2026'. Month is always
    first. Never hand this to a library that guesses."""
    v = (raw or "").strip()
    if not v:
        raise ParseError("empty date")
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            pass
    try:                                    # monthly grain, first of the month
        return datetime.strptime(v, "%b %Y").date()
    except ValueError:
        raise ParseError(f"unrecognised date {raw!r}")


def parse_ist(raw: str):
    """Order-level stamps arrive as '2026-08-19 22:10:01 +0000 UTC'. The suffix is
    a lie: the clock is IST (placed_at peaks 20:00-23:00, empties 02:00-06:00).
    Return an aware datetime in IST, or None."""
    v = (raw or "").strip()
    if not v or v.lower() in ("null", "na"):
        return None
    v = re.sub(r"\s*\+0000\s*UTC\s*$", "", v)
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(v, fmt).replace(tzinfo=IST)
        except ValueError:
            pass
    raise ParseError(f"unrecognised timestamp {raw!r}")


def mealtime_of(dt) -> str | None:
    if dt is None:
        return None
    h = dt.hour
    for name, lo, hi in MEALTIMES:
        if lo <= h < hi:
            return name
    return "Late night"                      # 23:00-07:00


def parse_items(raw: str) -> list[dict]:
    """items_in_order is a Go map dump:
       [map[catalogue_id:1 item_name:Butter Croissant item_quantity:2 ...] map[...]]
    Item names contain square brackets ("Overload Brownie [1 Pc]"), so scan for
    balanced brackets rather than regexing 'map[...]' non-greedily."""
    s = raw or ""
    out, i, line_no = [], 0, 0
    while True:
        start = s.find("map[", i)
        if start == -1:
            break
        depth, j = 0, start + 3               # sits on the '[' of 'map['
        while j < len(s):
            if s[j] == "[":
                depth += 1
            elif s[j] == "]":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        if depth != 0:
            raise ParseError("unbalanced brackets in items_in_order")
        body = s[start + 4:j]
        fields, line_no = {}, line_no + 1
        for m in re.finditer(r"(\w+):(.*?)(?=\s+\w+:|$)", body):
            fields[m.group(1)] = m.group(2).strip()
        fields["line_no"] = line_no
        out.append(fields)
        i = j + 1
    return out


def _num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def row_hash(values) -> str:
    joined = "\x1f".join("" if v is None else str(v) for v in values)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def _reader(text: str):
    return csv.reader(io.StringIO(text))


# ---------------------------------------------------------------- order level

ORDER_TIMESTAMP_FIELDS = (
    "placed_at", "accepted_at", "dp_assigned_at", "food_ready_market_at",
    "rider_reached_outlet_at", "rider_arrived_at", "picked_up_at",
    "delivered_at", "rejected_at",
)


def parse_order_file(text: str):
    """-> (order_rows, item_rows). One order row per order, one item row per line.

    Raises if the item lines do not multiply out to order_subtotal, which is the
    check that keeps the item table honest (contract 3). Orders whose lines are
    unparseable are still emitted, with line_count 0 and a note, rather than
    dropped: no silent loss."""
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows:
        return [], []
    orders, items, mismatches = [], [], []
    for r in rows:
        placed = parse_ist(r.get("placed_at"))
        order_id = (r.get("order_id") or "").strip()
        if not order_id:
            raise ParseError("row with no order_id")
        lines = parse_items(r.get("items_in_order", ""))
        subtotal = _num(r.get("order_subtotal"))
        lines_total = 0.0
        for ln in lines:
            q, c = _num(ln.get("item_quantity")), _num(ln.get("item_unit_cost"))
            ln["_value"] = None if (q is None or c is None) else round(q * c, 4)
            if ln["_value"] is not None:
                lines_total += ln["_value"]
        if lines and subtotal is not None and abs(lines_total - subtotal) > 1.0:
            mismatches.append((order_id, subtotal, round(lines_total, 2)))

        o = {k: (v if v != "" else None) for k, v in r.items()}
        o["business_date"] = parse_business_date(r["dt"]) if r.get("dt") else (
            placed.date() if placed else None)
        o["zomato_order_id"] = order_id
        o["restaurant_id"] = r.get("res_id")
        o["placed_at_ist"] = placed
        o["mealtime"] = mealtime_of(placed)
        o["line_count"] = len(lines)
        o["_items_canon"] = "|".join(sorted(
            f'{l.get("pos_item_id")}:{l.get("item_quantity")}:{l.get("item_unit_cost")}'
            for l in lines))
        orders.append(o)

        for ln in lines:
            items.append({
                "business_date": o["business_date"],
                "zomato_order_id": order_id,
                "restaurant_id": r.get("res_id"),
                "line_no": ln["line_no"],
                "catalogue_id": ln.get("catalogue_id"),
                "pos_item_id": ln.get("pos_item_id"),
                "item_name": ln.get("item_name"),
                "item_category": ln.get("item_category"),
                "item_sub_category": ln.get("item_sub_category"),
                "item_quantity": ln.get("item_quantity"),
                "item_unit_cost": ln.get("item_unit_cost"),
                "line_value": ln["_value"],
            })
    if mismatches:
        raise ParseError(
            f"{len(mismatches)} orders whose item lines do not sum to order_subtotal, "
            f"first three: {mismatches[:3]}")
    return orders, items


# ------------------------------------------------------------- aggregate cubes

def _cube(text: str, dim_map: dict, expect_metrics: int, extra=None):
    rdr = _reader(text)
    header = next(rdr)
    metric_cols = [(i, c) for i, c in enumerate(header) if c not in DIMENSION_HEADERS]
    if len(metric_cols) != expect_metrics:
        raise ParseError(f"expected {expect_metrics} metric columns, found {len(metric_cols)}")
    idx = {c: i for i, c in enumerate(header)}
    for key in dim_map:
        if key not in idx:
            raise ParseError(f"missing dimension column {key!r}")
    out = []
    for raw in rdr:
        if not raw or not any(x.strip() for x in raw):
            continue
        row = {"business_date": parse_business_date(raw[idx["Date"]]),
               "restaurant_id": raw[idx["Restaurant ID"]]}
        for src, dest in dim_map.items():
            row[dest] = raw[idx[src]]
        if extra:
            row.update(extra)
        for i, c in metric_cols:
            row[snake(c)] = raw[i] if raw[i] != "" else None
        out.append(row)
    return out


def parse_segment_cube(text: str):
    """Outlet x date x NRL x offer sensitivity x mealtime, 58 metrics."""
    return _cube(text, {"NRL customer": "nrl_segment",
                        "Offer sensitivity": "offer_sensitivity",
                        "Mealtime": "mealtime"}, 58)


def parse_ads_cube(text: str, segment_type: str):
    """Outlet x date x one customer segment, the 14 ad metrics.
    segment_type is 'spending_potential' or 'nrl'; they are different cuts and
    neither derives the other, so both are loaded into the same table."""
    src = {"spending_potential": "Spending potential", "nrl": "NRL customer"}[segment_type]
    rows = _cube(text, {src: "segment_value"}, 14, extra={"segment_type": segment_type})
    return rows


def parse_quality_cube(text: str):
    """Outlet x date, ONLY the 28 metrics that exist in no other shape.

    Contract 1: this file has 108 physical columns and 106 distinct names, so it
    is read by POSITION. csv.DictReader on this file silently drops two columns."""
    rdr = _reader(text)
    header = next(rdr)
    if len(header) < max(QUALITY_POSITIONS) + 1:
        raise ParseError(f"quality file has only {len(header)} columns, "
                         f"need at least {max(QUALITY_POSITIONS) + 1}")
    idx = {c: i for i, c in enumerate(header)}       # first occurrence, dims only
    names = [snake(header[p]) for p in QUALITY_POSITIONS]
    if len(set(names)) != len(names):
        raise ParseError("duplicate names among the 28 quality columns")
    out = []
    for raw in rdr:
        if not raw or not any(x.strip() for x in raw):
            continue
        row = {"business_date": parse_business_date(raw[idx["Date"]]),
               "restaurant_id": raw[idx["Restaurant ID"]]}
        for name, p in zip(names, QUALITY_POSITIONS):
            row[name] = raw[p] if raw[p] != "" else None
        out.append(row)
    return out


def outlets_from(rows):
    """Build the slowly-changing outlet dimension out of whatever was just parsed.
    first_seen/last_seen come from the data, never assumed (contract 6)."""
    seen = {}
    for r in rows:
        rid = r.get("restaurant_id") or r.get("res_id")
        if not rid:
            continue
        d = r.get("business_date")
        cur = seen.setdefault(rid, {
            "restaurant_id": rid,
            "restaurant_name": r.get("res_name") or r.get("Brand name"),
            "subzone": r.get("subzone"), "city": r.get("city"),
            "first_seen_date": d, "last_seen_date": d})
        if d:
            if cur["first_seen_date"] is None or d < cur["first_seen_date"]:
                cur["first_seen_date"] = d
            if cur["last_seen_date"] is None or d > cur["last_seen_date"]:
                cur["last_seen_date"] = d
    return list(seen.values())


# --------------------------------------------------------------- shape routing

def detect_shape(text: str) -> str:
    """The report emails are all titled "Your Report is Ready for Download" and
    say nothing about which shape they are, so identify from the CSV itself.

    order      : has order_id
    quality    : the wide no-breakdown cube (>100 columns)
    segment    : mealtime, NRL and offer sensitivity all live
    ads_sp     : ads columns, Spending potential live
    ads_nrl    : ads columns, NRL live
    campaign   : Track ads
    """
    rdr = _reader(text)
    header = next(rdr)
    hset = set(header)
    if "order_id" in hset:
        return "order"
    if "Campaign type" in hset or "campaign_id" in hset:
        return "campaign"
    if len(header) > 100:
        return "quality"
    idx = {c: i for i, c in enumerate(header)}
    live = {c: set() for c in ("Mealtime", "NRL customer", "Offer sensitivity", "Spending potential")
            if c in idx}
    for n, raw in enumerate(rdr):
        if n > 400:
            break
        for c in live:
            if raw[idx[c]]:
                live[c].add(raw[idx[c]])
    def moves(c):
        return c in live and live[c] - {"all"}
    if "Ad impressions" in hset and len(header) < 30:
        if moves("Spending potential"):
            return "ads_sp"
        if moves("NRL customer"):
            return "ads_nrl"
        raise ParseError("ads file with no live segment column")
    if moves("Mealtime") and moves("NRL customer"):
        return "segment"
    raise ParseError(
        f"unrecognised report shape, {len(header)} columns. The 80-column "
        f"NRL-with-ads shape is a valid Zomato output but is never requested by "
        f"request.py (ads_nrl asks for the 14 ad metrics only), so seeing it here "
        f"means someone pulled by hand.")
