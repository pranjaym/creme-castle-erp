"""Extended metrics for v2 dashboard. Adds:
  - glance_block(): cake/dessert qty+rev with 5 comparison ranges × 3 platforms
  - dark_outlets(): detects 3+ consecutive hours of zero orders during 7am–2am
  - city_block(): city metrics with comparison ranges + platform splits
  - lux_outlet_matrix(): SKU × outlet performance for visualization
  - discount_diagnostic(): outlet disc% with proper ranges
  - sku_concentration_v2(): top SKU share with change indicators
"""
from datetime import timedelta, time
import pandas as pd
from loaders import outlet_to_city


def _safe_div(a, b):
    return float(a) / float(b) if b else 0.0


def _pct(a, b):
    return _safe_div(a, b) * 100


def _delta_pct(focal, comp):
    if comp in (0, None) or pd.isna(comp): return None
    return (focal - comp) / comp * 100


# ============================================================
# SECTION 2 — Yesterday at a Glance (extended)
# ============================================================

GLANCE_METRICS = [
    ("orders",     "Orders",              "count"),
    ("net_rev",    "Net Revenue",         "money"),
    ("aov",        "AOV",                 "money"),
    ("out_disc_pct", "Outlet Disc %",     "pct"),
    ("cake_qty",   "Cake Qty",            "count"),
    ("dessert_qty","Dessert Qty",         "count"),
    ("cake_rev",   "Cake Revenue",        "money"),
    ("dessert_rev","Dessert Revenue",     "money"),
    ("cake_qty_share", "Cake Qty %",      "pct"),
    ("cake_rev_share", "Cake Revenue %",  "pct"),
]


def _glance_day(orders, items, dt):
    """Single day, returns nested {platform: {metric: value}}."""
    o = orders[(orders["dt"] == dt) & (orders["delivered"] == 1)]
    i = items[items["dt"] == dt]
    out = {}
    for plat in ["All", "Zomato", "Swiggy"]:
        op = o if plat == "All" else o[o["platform"] == plat]
        ip = i if plat == "All" else i[i["platform"] == plat]
        n = len(op)
        gmv = op["gmv"].sum()
        outd = op["Outlet Discount"].sum()
        net = op["net_sale"].sum()
        item_qty = ip["item_quantity"].sum()
        item_rev = ip["item_total"].sum()
        cake_qty = ip[ip["Alias Category"] == "Cakes"]["item_quantity"].sum()
        cake_rev = ip[ip["Alias Category"] == "Cakes"]["item_total"].sum()
        dess_qty = ip[ip["Alias Category"] == "Desserts"]["item_quantity"].sum()
        dess_rev = ip[ip["Alias Category"] == "Desserts"]["item_total"].sum()
        out[plat] = {
            "orders": float(n),
            "net_rev": float(net),
            "aov": _safe_div(net, n),
            "out_disc_pct": _pct(outd, gmv),
            "cake_qty": float(cake_qty),
            "dessert_qty": float(dess_qty),
            "cake_rev": float(cake_rev),
            "dessert_rev": float(dess_rev),
            "cake_qty_share": _pct(cake_qty, item_qty),
            "cake_rev_share": _pct(cake_rev, item_rev),
        }
    return out


def _glance_avg(orders, items, dates):
    """Average per-day across multiple dates. Returns same shape as _glance_day."""
    if not dates: return None
    rows = [_glance_day(orders, items, d) for d in dates]
    out = {}
    for plat in ["All", "Zomato", "Swiggy"]:
        keys = rows[0][plat].keys()
        out[plat] = {k: sum(r[plat][k] for r in rows) / len(rows) for k in keys}
    return out


def glance_block(orders, items, focal_dt):
    """Returns dict with focal + 4 comparison ranges per platform.

    Comparison ranges:
      focal     - the focal date
      day_before- focal - 1 day
      last_week - focal - 7 days (same DOW)
      avg_7d    - rolling 7 days prior to focal
      avg_30d   - rolling 30 days prior to focal
    """
    by_day = orders.groupby("dt").size()
    available = set(by_day.index)
    day_before = focal_dt - timedelta(days=1)
    last_week  = focal_dt - timedelta(days=7)

    last7_dates = [focal_dt - timedelta(days=i) for i in range(1, 8) if (focal_dt - timedelta(days=i)) in available]
    last30_dates = [focal_dt - timedelta(days=i) for i in range(1, 31) if (focal_dt - timedelta(days=i)) in available]

    return {
        "focal_dt":   focal_dt,
        "focal":      _glance_day(orders, items, focal_dt),
        "day_before_dt": day_before,
        "day_before": _glance_day(orders, items, day_before) if day_before in available else None,
        "last_week_dt":  last_week,
        "last_week":  _glance_day(orders, items, last_week) if last_week in available else None,
        "avg_7d":     _glance_avg(orders, items, last7_dates),
        "avg_7d_n":   len(last7_dates),
        "avg_30d":    _glance_avg(orders, items, last30_dates),
        "avg_30d_n":  len(last30_dates),
    }


# ============================================================
# DARK OUTLET DETECTION — 3+ consecutive hours zero orders, 7am-2am
# ============================================================

def dark_outlets(orders, focal_dt, min_consecutive=3):
    """Detect outlets with 3+ consecutive hours of zero orders during 7am-2am
    operating window on the focal date.

    Returns list of dicts: {outlet, gap_start, gap_end, gap_hours, total_orders, expected_orders}
    'expected_orders' is the average for that outlet across the prior 7 same-DOW days
    at the same hour band, helping distinguish a real outage from a normally-slow window.
    """
    # Operating hours: 7am to 2am next day. Represented as: hours 7..23 plus 0..1
    op_hours = list(range(7, 24)) + [0, 1]

    # Focal day orders (delivered only — cancellations don't reflect successful operation)
    f = orders[(orders["dt"] == focal_dt) & (orders["delivered"] == 1)]
    # Same DOW prior 4 weeks for baseline expectation
    baseline_dates = [focal_dt - timedelta(days=7*i) for i in range(1, 5)]
    by_day = orders.groupby("dt").size()
    baseline_dates = [d for d in baseline_dates if d in by_day.index]

    # Per outlet, hour-by-hour
    findings = []
    for outlet in sorted(f["Outlet Name"].unique()):
        of = f[f["Outlet Name"] == outlet]
        if len(of) < 5: continue  # ignore very-low-volume outlets — too noisy
        hr_counts = of.groupby("hour").size().to_dict()

        # Build sequence of (hour, count) for operating window
        seq = [(h, hr_counts.get(h, 0)) for h in op_hours]

        # Find longest run of zeros
        best_run = []
        cur_run = []
        for h, c in seq:
            if c == 0:
                cur_run.append(h)
            else:
                if len(cur_run) > len(best_run):
                    best_run = cur_run[:]
                cur_run = []
        if len(cur_run) > len(best_run):
            best_run = cur_run[:]
        if len(best_run) < min_consecutive: continue

        # Baseline: for those same hours, what did the outlet usually do?
        baseline_total = 0
        baseline_days = 0
        for bd in baseline_dates:
            bb = orders[(orders["dt"] == bd) & (orders["delivered"] == 1) & (orders["Outlet Name"] == outlet)]
            if len(bb) < 3: continue  # skip if outlet wasn't really operating that day
            baseline_total += bb[bb["hour"].isin(best_run)].shape[0]
            baseline_days += 1
        expected = baseline_total / baseline_days if baseline_days else None

        # Skip if outlet normally idle in this window (expected < 3 orders)
        if expected is not None and expected < 3: continue

        findings.append({
            "outlet": outlet,
            "city": outlet_to_city(outlet),
            "gap_start": best_run[0],
            "gap_end": best_run[-1],
            "gap_hours": len(best_run),
            "total_orders": len(of),
            "expected_orders": expected,
        })
    findings.sort(key=lambda x: -x["gap_hours"])
    return findings


# ============================================================
# SECTION 6 — City block with multi-range + platform split
# ============================================================

def _city_day(orders, items, dt):
    """City-level metrics for a single day, broken by platform."""
    o = orders[(orders["dt"] == dt) & (orders["delivered"] == 1)]
    i = items[items["dt"] == dt]
    cities_out = {}
    for city in sorted(o["city"].unique()):
        oc = o[o["city"] == city]
        ic = i[i["city"] == city]
        result = {}
        for plat in ["All", "Zomato", "Swiggy"]:
            op = oc if plat == "All" else oc[oc["platform"] == plat]
            ip = ic if plat == "All" else ic[ic["platform"] == plat]
            n = len(op)
            gmv = op["gmv"].sum()
            outd = op["Outlet Discount"].sum()
            net = op["net_sale"].sum()
            iq = ip["item_quantity"].sum()
            ir = ip["item_total"].sum()
            cq = ip[ip["Alias Category"] == "Cakes"]["item_quantity"].sum()
            cr = ip[ip["Alias Category"] == "Cakes"]["item_total"].sum()
            result[plat] = {
                "orders": float(n),
                "net_rev": float(net),
                "aov": _safe_div(net, n),
                "out_disc_pct": _pct(outd, gmv),
                "cake_qty_share": _pct(cq, iq),
                "cake_rev_share": _pct(cr, ir),
            }
        cities_out[city] = result
    return cities_out


def _city_avg(orders, items, dates):
    if not dates: return {}
    rows = [_city_day(orders, items, d) for d in dates]
    all_cities = set().union(*(r.keys() for r in rows))
    out = {}
    for city in all_cities:
        out[city] = {}
        for plat in ["All", "Zomato", "Swiggy"]:
            days = [r[city][plat] for r in rows if city in r]
            if not days: continue
            keys = days[0].keys()
            out[city][plat] = {k: sum(d[k] for d in days) / len(days) for k in keys}
    return out


def city_block(orders, items, focal_dt):
    """Returns city × platform × metric across 5 comparison ranges."""
    by_day = orders.groupby("dt").size()
    available = set(by_day.index)
    day_before = focal_dt - timedelta(days=1)
    last_week = focal_dt - timedelta(days=7)
    last7  = [focal_dt - timedelta(days=i) for i in range(1, 8) if (focal_dt - timedelta(days=i)) in available]
    last30 = [focal_dt - timedelta(days=i) for i in range(1, 31) if (focal_dt - timedelta(days=i)) in available]

    return {
        "focal_dt":  focal_dt,
        "day_before_dt": day_before,
        "last_week_dt":  last_week,
        "focal":     _city_day(orders, items, focal_dt),
        "day_before": _city_day(orders, items, day_before) if day_before in available else {},
        "last_week": _city_day(orders, items, last_week) if last_week in available else {},
        "avg_7d":    _city_avg(orders, items, last7),
        "avg_30d":   _city_avg(orders, items, last30),
    }


# ============================================================
# SECTION 5 — Lux Cakes deep dive (visualization data)
# ============================================================

def lux_deep_dive(items, orders, focal_dt, config):
    """Build data for Lux Cakes visualization:
      - Per-SKU 30-day trend (qty)
      - SKU × Outlet matrix (last 14 days qty + 14-day prior)
      - Per-city share
      - Platform mix per SKU
    """
    sku_list = config["skus"]
    last30 = [focal_dt - timedelta(days=i) for i in range(0, 30)]
    last14_recent = [focal_dt - timedelta(days=i) for i in range(0, 14)]
    last14_prior  = [focal_dt - timedelta(days=i) for i in range(14, 28)]

    # All-time first sale per SKU (launch date detection)
    launch = {}
    for sku in sku_list:
        sub = items[items["Alias Name"] == sku]
        if len(sub) > 0:
            launch[sku] = sub["dt"].min()

    # Daily qty per SKU (last 30d) and revenue
    daily = {}
    for sku in sku_list:
        sub = items[(items["Alias Name"] == sku) & (items["dt"].isin(last30))]
        per_day = sub.groupby("dt").agg(qty=("item_quantity", "sum"), rev=("item_total", "sum")).reset_index()
        rows = []
        for d in sorted(last30):
            r = per_day[per_day["dt"] == d]
            rows.append({
                "dt": d,
                "qty": int(r["qty"].iloc[0]) if len(r) else 0,
                "rev": float(r["rev"].iloc[0]) if len(r) else 0.0,
            })
        daily[sku] = rows

    # SKU × outlet matrix (last 14d qty, prior 14d, delta)
    outlet_matrix = {}
    all_outlets = sorted(items[items["Alias Name"].isin(sku_list)]["restaurant_name"].unique())
    for sku in sku_list:
        sub = items[items["Alias Name"] == sku]
        by_outlet = {}
        for o in all_outlets:
            recent = sub[(sub["restaurant_name"] == o) & (sub["dt"].isin(last14_recent))]["item_quantity"].sum()
            prior  = sub[(sub["restaurant_name"] == o) & (sub["dt"].isin(last14_prior))]["item_quantity"].sum()
            by_outlet[o] = {
                "recent": int(recent),
                "prior":  int(prior),
                "delta":  int(recent - prior),
            }
        outlet_matrix[sku] = by_outlet

    # Per-SKU 14-day totals + platform mix + AOV
    summary = {}
    for sku in sku_list:
        sub30 = items[(items["Alias Name"] == sku) & (items["dt"].isin(last30))]
        sub14 = items[(items["Alias Name"] == sku) & (items["dt"].isin(last14_recent))]
        sub14p = items[(items["Alias Name"] == sku) & (items["dt"].isin(last14_prior))]
        zq = sub14[sub14["platform"] == "Zomato"]["item_quantity"].sum()
        sq = sub14[sub14["platform"] == "Swiggy"]["item_quantity"].sum()
        outlets_selling = sub14[sub14["item_quantity"] > 0]["restaurant_name"].nunique()
        outlets_active_overall = orders[(orders["dt"].isin(last14_recent)) & (orders["delivered"] == 1)]["Outlet Name"].nunique()
        avg_price = sub14["item_total"].sum() / sub14["item_quantity"].sum() if sub14["item_quantity"].sum() else 0
        summary[sku] = {
            "qty_14d": int(sub14["item_quantity"].sum()),
            "qty_14d_prior": int(sub14p["item_quantity"].sum()),
            "rev_14d": float(sub14["item_total"].sum()),
            "qty_30d": int(sub30["item_quantity"].sum()),
            "zomato_qty": int(zq),
            "swiggy_qty": int(sq),
            "outlets_selling": int(outlets_selling),
            "outlets_total": int(outlets_active_overall),
            "avg_price": float(avg_price),
            "launch_date": launch.get(sku),
        }

    return {
        "skus": sku_list,
        "summary": summary,
        "daily": daily,
        "outlet_matrix": outlet_matrix,
        "outlets_total": all_outlets,
    }


# ============================================================
# SECTION 9 — Discount diagnostic (proper formula + ranges)
# ============================================================

def discount_diagnostic(orders, focal_dt):
    """Outlet-level discount %, with multi-range comparison.
       disc% = Outlet Discount / GMV (matches new formula)
    """
    by_day = orders.groupby("dt").size()
    available = set(by_day.index)
    last_week = focal_dt - timedelta(days=7)
    last7  = [focal_dt - timedelta(days=i) for i in range(1, 8) if (focal_dt - timedelta(days=i)) in available]
    last30 = [focal_dt - timedelta(days=i) for i in range(1, 31) if (focal_dt - timedelta(days=i)) in available]

    def _by_outlet(dates, plat=None):
        if isinstance(dates, list):
            sub = orders[(orders["dt"].isin(dates)) & (orders["delivered"] == 1)]
        else:
            sub = orders[(orders["dt"] == dates) & (orders["delivered"] == 1)]
        if plat:
            sub = sub[sub["platform"] == plat]
        agg = sub.groupby("Outlet Name").agg(
            gmv=("gmv", "sum"),
            outd=("Outlet Discount", "sum"),
            orders=("delivered", "sum"),
        ).reset_index()
        agg["disc_pct"] = agg.apply(lambda r: _pct(r["outd"], r["gmv"]), axis=1)
        return {r["Outlet Name"]: {"disc_pct": r["disc_pct"], "orders": int(r["orders"]), "outd": float(r["outd"]), "gmv": float(r["gmv"])} for _, r in agg.iterrows()}

    # Brand-level for each platform
    def _brand_disc(dates, plat=None):
        if isinstance(dates, list):
            sub = orders[(orders["dt"].isin(dates)) & (orders["delivered"] == 1)]
        else:
            sub = orders[(orders["dt"] == dates) & (orders["delivered"] == 1)]
        if plat:
            sub = sub[sub["platform"] == plat]
        gmv = sub["gmv"].sum()
        outd = sub["Outlet Discount"].sum()
        return _pct(outd, gmv) if isinstance(dates, list) else _pct(outd, gmv)

    brand = {}
    for plat in [None, "Zomato", "Swiggy"]:
        key = plat or "All"
        brand[key] = {
            "focal":     _brand_disc(focal_dt, plat),
            "last_week": _brand_disc(last_week, plat) if last_week in available else None,
            "avg_7d":    _brand_disc(last7, plat) if last7 else None,
            "avg_30d":   _brand_disc(last30, plat) if last30 else None,
        }

    outlet = {}
    for plat in [None, "Zomato", "Swiggy"]:
        key = plat or "All"
        outlet[key] = {
            "focal":     _by_outlet(focal_dt, plat),
            "last_week": _by_outlet(last_week, plat) if last_week in available else {},
            "avg_7d":    _by_outlet(last7, plat) if last7 else {},
            "avg_30d":   _by_outlet(last30, plat) if last30 else {},
        }
    return {"brand": brand, "outlet": outlet}


# ============================================================
# SECTION 9 — Z vs S Cake Share trend (last 30 days)
# ============================================================

def cake_share_trend_30d(items, focal_dt):
    """Daily Z vs S cake quantity for last 30 days.
       Z share % = Z_cake_qty / (Z_cake_qty + S_cake_qty).
    """
    last30 = sorted([focal_dt - timedelta(days=i) for i in range(0, 30)])
    rows = []
    for d in last30:
        cake = items[(items["dt"] == d) & (items["Alias Category"] == "Cakes")]
        z = int(cake[cake["platform"] == "Zomato"]["item_quantity"].sum())
        s = int(cake[cake["platform"] == "Swiggy"]["item_quantity"].sum())
        tot = z + s
        rows.append({
            "dt": d,
            "z": z,
            "s": s,
            "total": tot,
            "z_share": _pct(z, tot),
            "s_share": _pct(s, tot),
        })
    # Compute 30-day averages
    z_total = sum(r["z"] for r in rows)
    s_total = sum(r["s"] for r in rows)
    avg_z_share = _pct(z_total, z_total + s_total)
    return {
        "rows": rows,
        "avg_z_share": avg_z_share,
        "z_total_30d": z_total,
        "s_total_30d": s_total,
    }


# ============================================================
# SECTION 10 — Category cards with multi-range comparison
# ============================================================

def category_block(items, focal_dt):
    """Category metrics (qty, rev, share) with multi-range comparison.
       Returns dict per platform with categories × ranges.
    """
    by_day = items.groupby("dt").size()
    available = set(by_day.index)
    day_before = focal_dt - timedelta(days=1)
    last_week  = focal_dt - timedelta(days=7)
    last7  = [focal_dt - timedelta(days=i) for i in range(1, 8) if (focal_dt - timedelta(days=i)) in available]
    last30 = [focal_dt - timedelta(days=i) for i in range(1, 31) if (focal_dt - timedelta(days=i)) in available]

    cats = ["Cakes", "Desserts", "Cheesecakes", "Cookies"]

    def _one(dates, plat=None):
        if isinstance(dates, list):
            sub = items[items["dt"].isin(dates)]
            divisor = len(dates) if dates else 1
        else:
            sub = items[items["dt"] == dates]
            divisor = 1
        if plat:
            sub = sub[sub["platform"] == plat]
        total_q = sub["item_quantity"].sum()
        total_r = sub["item_total"].sum()
        result = {}
        for c in cats:
            cs = sub[sub["Alias Category"] == c]
            q = cs["item_quantity"].sum() / divisor
            r = cs["item_total"].sum() / divisor
            result[c] = {
                "qty": float(q),
                "rev": float(r),
                "qty_share": _pct(cs["item_quantity"].sum(), total_q),
                "rev_share": _pct(cs["item_total"].sum(), total_r),
            }
        return result

    out = {}
    for plat in ["All", "Zomato", "Swiggy"]:
        p = None if plat == "All" else plat
        out[plat] = {
            "focal":     _one(focal_dt, p),
            "day_before": _one(day_before, p) if day_before in available else None,
            "last_week": _one(last_week, p) if last_week in available else None,
            "avg_7d":    _one(last7, p) if last7 else None,
            "avg_30d":   _one(last30, p) if last30 else None,
        }
    return out


# ============================================================
# SECTION 12 — SKU concentration with change indicators
# ============================================================

def sku_concentration_v2(items, focal_dt, discontinued=None, top_n=10):
    """Top N SKUs by qty on focal day, with comparison vs day-before, last-week,
    7-day avg, and 30-day avg. Plus concentration ratio.
    """
    if discontinued is None: discontinued = set()
    sub = items[~items["Alias Name"].isin(discontinued)]
    by_day = items.groupby("dt").size()
    available = set(by_day.index)
    day_before = focal_dt - timedelta(days=1)
    last_week  = focal_dt - timedelta(days=7)
    last7  = [focal_dt - timedelta(days=i) for i in range(1, 8) if (focal_dt - timedelta(days=i)) in available]
    last30 = [focal_dt - timedelta(days=i) for i in range(1, 31) if (focal_dt - timedelta(days=i)) in available]

    def _agg(dates):
        if isinstance(dates, list):
            s = sub[sub["dt"].isin(dates)]
            div = len(dates) if dates else 1
        else:
            s = sub[sub["dt"] == dates]
            div = 1
        g = s.groupby("Alias Name").agg(qty=("item_quantity","sum"), rev=("item_total","sum")).reset_index()
        g["qty"] = g["qty"] / div
        g["rev"] = g["rev"] / div
        return {r["Alias Name"]: {"qty": r["qty"], "rev": r["rev"]} for _, r in g.iterrows()}

    focal = _agg(focal_dt)
    db = _agg(day_before) if day_before in available else {}
    lw = _agg(last_week) if last_week in available else {}
    a7 = _agg(last7) if last7 else {}
    a30 = _agg(last30) if last30 else {}

    # Top N by qty on focal
    top = sorted(focal.items(), key=lambda x: -x[1]["qty"])[:top_n]
    rows = []
    for name, d in top:
        f_q = d["qty"]
        rows.append({
            "name": name,
            "category": items[items["Alias Name"] == name]["Alias Category"].iloc[0] if (items["Alias Name"] == name).any() else "",
            "qty_focal": f_q,
            "qty_day_before": db.get(name, {}).get("qty", 0),
            "qty_last_week":  lw.get(name, {}).get("qty", 0),
            "qty_avg_7d":     a7.get(name, {}).get("qty", 0),
            "qty_avg_30d":    a30.get(name, {}).get("qty", 0),
            "delta_db_pct":   _delta_pct(f_q, db.get(name, {}).get("qty", 0)),
            "delta_lw_pct":   _delta_pct(f_q, lw.get(name, {}).get("qty", 0)),
            "delta_7d_pct":   _delta_pct(f_q, a7.get(name, {}).get("qty", 0)),
            "delta_30d_pct":  _delta_pct(f_q, a30.get(name, {}).get("qty", 0)),
        })

    # Concentration: top10 share of total qty
    total_focal_qty = sum(d["qty"] for d in focal.values())
    top10_qty = sum(r["qty_focal"] for r in rows[:10])
    concentration_focal = _pct(top10_qty, total_focal_qty)

    total_lw_qty = sum(d["qty"] for d in lw.values())
    top10_lw_qty = sum(lw.get(r["name"], {}).get("qty", 0) for r in rows[:10])
    concentration_lw = _pct(top10_lw_qty, total_lw_qty) if total_lw_qty else None

    return {
        "rows": rows,
        "concentration_focal": concentration_focal,
        "concentration_lw": concentration_lw,
        "total_focal_qty": total_focal_qty,
    }
