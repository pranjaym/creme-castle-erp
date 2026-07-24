"""Metric aggregations. All take dataframes + a date, return dicts."""
from datetime import timedelta
import pandas as pd
from loaders import outlet_to_city

def safe_div(a, b):
    return float(a) / float(b) if b else 0.0

def pct_delta(focal, comp):
    if comp in (0, None): return None
    return (focal - comp) / comp * 100


def topline(orders, items, dt):
    """Brand and per-platform topline for one date.
    GMV = My amount + Container Charges
    Discount = Outlet Discount + Aggregator Discount
    Net Sale = GMV - Discount
    """
    o = orders[(orders["dt"] == dt) & (orders["delivered"] == 1)]
    i = items[items["dt"] == dt]
    out = {}
    for plat in ["Zomato", "Swiggy", "All"]:
        op = o if plat == "All" else o[o["platform"] == plat]
        ip = i if plat == "All" else i[i["platform"] == plat]
        n_orders = len(op)
        gmv = op["gmv"].sum()
        agg = op["Aggregator Discount"].sum()
        outd = op["Outlet Discount"].sum()
        disc = op["discount"].sum()
        net = op["net_sale"].sum()
        item_qty = ip["item_quantity"].sum()
        item_rev = ip["item_total"].sum()
        cake_qty = ip[ip["Alias Category"] == "Cakes"]["item_quantity"].sum()
        cake_rev = ip[ip["Alias Category"] == "Cakes"]["item_total"].sum()
        out[plat] = {
            "orders": int(n_orders),
            "gmv": float(gmv), "net_sale": float(net), "net_rev": float(net),
            "discount": float(disc),
            "out_disc": float(outd), "agg_disc": float(agg),
            "aov": safe_div(net, n_orders),
            "disc_pct": safe_div(disc, gmv) * 100,
            "out_disc_pct": safe_div(outd, gmv) * 100,
            "agg_disc_pct": safe_div(agg, gmv) * 100,
            "tot_disc_pct": safe_div(disc, gmv) * 100,
            "agg_funding_pct": safe_div(agg, agg + outd) * 100,
            "items_per_order": safe_div(item_qty, n_orders),
            "cake_share_qty": safe_div(cake_qty, item_qty) * 100,
            "cake_share_rev": safe_div(cake_rev, item_rev) * 100,
        }
    return out


def topline_avg(orders, items, dates):
    """Average per-day across multiple dates."""
    if not dates: return None
    rows = [topline(orders, items, d) for d in dates]
    out = {}
    for plat in ["Zomato", "Swiggy", "All"]:
        keys = rows[0][plat].keys()
        out[plat] = {k: sum(r[plat][k] for r in rows) / len(rows) for k in keys}
    return out


def per_outlet(orders, items, dt):
    """One row per outlet for one date.
    Includes Z and S broken out separately so outlet-level platform crashes are visible.
    """
    od = orders[(orders["dt"] == dt) & (orders["delivered"] == 1)]
    oa = orders[orders["dt"] == dt]
    it = items[items["dt"] == dt]
    rows = {}
    for outlet in sorted(set(orders["Outlet Name"].unique())):
        oo = od[od["Outlet Name"] == outlet]
        ob = oa[oa["Outlet Name"] == outlet]
        ii = it[it["restaurant_name"] == outlet]
        n_orders = len(oo)
        n_cancel = (ob["Status"] == "Cancelled").sum()
        if n_orders == 0 and n_cancel == 0: continue
        gmv = oo["gmv"].sum()
        outd = oo["Outlet Discount"].sum()
        agg = oo["Aggregator Discount"].sum()
        disc = oo["discount"].sum()
        net = oo["net_sale"].sum()
        item_qty = ii["item_quantity"].sum()
        cake_qty = ii[ii["Alias Category"] == "Cakes"]["item_quantity"].sum()

        # Per-platform breakouts
        oz = oo[oo["platform"] == "Zomato"]
        os_ = oo[oo["platform"] == "Swiggy"]
        z_orders = len(oz); s_orders = len(os_)
        z_net = oz["net_sale"].sum(); s_net = os_["net_sale"].sum()
        z_gmv = oz["gmv"].sum(); s_gmv = os_["gmv"].sum()
        z_disc = oz["discount"].sum(); s_disc = os_["discount"].sum()

        rows[outlet] = {
            "outlet": outlet, "city": outlet_to_city(outlet),
            "orders": int(n_orders),
            "z_orders": int(z_orders), "s_orders": int(s_orders),
            "z_net_sale": float(z_net), "s_net_sale": float(s_net),
            "z_aov": safe_div(z_net, z_orders), "s_aov": safe_div(s_net, s_orders),
            "z_disc_pct": safe_div(z_disc, z_gmv) * 100,
            "s_disc_pct": safe_div(s_disc, s_gmv) * 100,
            "gmv": float(gmv), "net_sale": float(net), "net_rev": float(net),
            "discount": float(disc),
            "out_disc": float(outd), "agg_disc": float(agg),
            "aov": safe_div(net, n_orders),
            "disc_pct": safe_div(disc, gmv) * 100,
            "out_disc_pct": safe_div(outd, gmv) * 100,
            "tot_disc_pct": safe_div(disc, gmv) * 100,
            "cake_share_qty": safe_div(cake_qty, item_qty) * 100,
            "cancel": int(n_cancel),
            "cancel_pct": safe_div(n_cancel, n_orders + n_cancel) * 100,
        }
    return rows


def per_outlet_avg(orders, items, dates):
    """Per-outlet averages across multiple dates."""
    if not dates: return {}
    rows = [per_outlet(orders, items, d) for d in dates]
    all_outlets = set().union(*(r.keys() for r in rows))
    out = {}
    for outlet in all_outlets:
        days = [r[outlet] for r in rows if outlet in r]
        if not days: continue
        nk = [k for k, v in days[0].items() if isinstance(v, (int, float))]
        agg = {"outlet": outlet, "city": outlet_to_city(outlet)}
        for k in nk:
            agg[k] = sum(d[k] for d in days) / len(days)
        out[outlet] = agg
    return out


def cities(out_focal, out_comp, out_avg):
    cs = sorted({r["city"] for r in out_focal.values()})
    res = {}
    for c in cs:
        f = [r for r in out_focal.values() if r["city"] == c]
        cm = [r for r in out_comp.values() if r["city"] == c]
        av = [r for r in out_avg.values() if r["city"] == c]
        f_orders = sum(r["orders"] for r in f)
        f_rev    = sum(r["net_rev"] for r in f)
        f_gmv    = sum(r["gmv"] for r in f)
        f_outd   = sum(r["out_disc"] for r in f)
        c_orders = sum(r["orders"] for r in cm)
        c_rev    = sum(r["net_rev"] for r in cm)
        a_orders = sum(r["orders"] for r in av)
        a_rev    = sum(r["net_rev"] for r in av)
        res[c] = {
            "city": c, "outlets": len(f),
            "orders": f_orders, "net_rev": f_rev,
            "aov": safe_div(f_rev, f_orders),
            "out_disc_pct": safe_div(f_outd, f_gmv) * 100,
            "comp_orders": c_orders, "comp_rev": c_rev,
            "avg_orders": a_orders, "avg_rev": a_rev,
            "d_orders_lw": pct_delta(f_orders, c_orders),
            "d_rev_lw":    pct_delta(f_rev, c_rev),
            "d_orders_7d": pct_delta(f_orders, a_orders),
            "d_rev_7d":    pct_delta(f_rev, a_rev),
        }
    return res


def categories(items, dt):
    i = items[items["dt"] == dt]
    out = {}
    for plat in ["Zomato", "Swiggy", "All"]:
        ip = i if plat == "All" else i[i["platform"] == plat]
        tq = ip["item_quantity"].sum()
        tr = ip["item_total"].sum()
        cats = {}
        for cat in ["Cakes", "Desserts", "Cheesecakes", "Cookies"]:
            cp = ip[ip["Alias Category"] == cat]
            qty = int(cp["item_quantity"].sum())
            rev = float(cp["item_total"].sum())
            cats[cat] = {
                "qty": qty, "rev": rev,
                "qty_share": safe_div(qty, tq) * 100,
                "rev_share": safe_div(rev, tr) * 100,
                "avg_price": safe_div(rev, qty),
            }
        cakes = ip[ip["Alias Category"] == "Cakes"]
        cq = int(cakes["item_quantity"].sum())
        pq = int(cakes[cakes["item_price"] >= 699]["item_quantity"].sum())
        cats["_premium_cake_share"] = safe_div(pq, cq) * 100
        out[plat] = cats
    return out


def top_skus(items, dt, dt_comp, top_n=40, discontinued=None):
    """Returns top SKUs by qty for the focal day, with comp-day comparison.
    Discontinued items are excluded so the SKU movers list isn't polluted by
    aberrations from items we've stopped selling."""
    discontinued = discontinued or set()
    i_f = items[(items["dt"] == dt) & (~items["Alias Name"].isin(discontinued))]
    i_c = items[(items["dt"] == dt_comp) & (~items["Alias Name"].isin(discontinued))]
    skus = (i_f.groupby("Alias Name")["item_quantity"].sum()
            .sort_values(ascending=False).head(top_n).index.tolist())
    rows = []
    for sku in skus:
        sf = i_f[i_f["Alias Name"] == sku]
        sc = i_c[i_c["Alias Name"] == sku]
        f_qty = int(sf["item_quantity"].sum())
        c_qty = int(sc["item_quantity"].sum())
        f_rev = float(sf["item_total"].sum())
        cat = sf["Alias Category"].iloc[0] if f_qty else ""
        z = int(sf[sf["platform"] == "Zomato"]["item_quantity"].sum())
        s = int(sf[sf["platform"] == "Swiggy"]["item_quantity"].sum())
        rows.append({
            "sku": sku, "category": cat,
            "qty": f_qty, "z_qty": z, "s_qty": s,
            "rev": f_rev,
            "avg_price": safe_div(f_rev, f_qty),
            "comp_qty": c_qty,
            "delta_pct": pct_delta(f_qty, c_qty),
        })
    return rows


def hour_pattern(items, dt, dt_comp):
    """Brand and outlet-level hourly order distribution."""
    def hourly(s):
        g = (s.groupby(["restaurant_name", "Hour", "invoice_no"])
              .size().reset_index(name="n"))
        return g[g["Hour"] >= 0]
    f = hourly(items[items["dt"] == dt])
    c = hourly(items[items["dt"] == dt_comp])
    brand_f = f.groupby("Hour").size().to_dict()
    brand_c = c.groupby("Hour").size().to_dict()
    outlet_h = {}
    for outlet in items[items["dt"] == dt]["restaurant_name"].unique():
        sub = f[f["restaurant_name"] == outlet]
        outlet_h[outlet] = sub.groupby("Hour").size().to_dict()
    return outlet_h, {int(k): int(v) for k, v in brand_f.items()}, {int(k): int(v) for k, v in brand_c.items()}


def discount_bands(orders, dt):
    o = orders[(orders["dt"] == dt) & (orders["delivered"] == 1)].copy()
    o["odp"] = o.apply(lambda r: safe_div(r["Outlet Discount"], r["gmv"]) * 100, axis=1)
    bands = [(-0.01, 0), (0, 10), (10, 20), (20, 30), (30, 50), (50, 100)]
    labels = ["0%", "1-10%", "11-20%", "21-30%", "31-50%", ">50%"]
    out = {}
    for plat in ["Zomato", "Swiggy"]:
        op = o[o["platform"] == plat]
        out[plat] = {"labels": labels,
                     "counts": [int(((op["odp"] > lo) & (op["odp"] <= hi)).sum()) for lo, hi in bands]}
    return out


def trend_14d(orders, items, focal_dt):
    last14 = sorted([d for d in orders["dt"].unique() if 0 <= (focal_dt - d).days < 14])
    rows = []
    for d in last14:
        od = orders[(orders["dt"] == d) & (orders["delivered"] == 1)]
        ix = items[items["dt"] == d]
        z = (od["platform"] == "Zomato").sum()
        s = (od["platform"] == "Swiggy").sum()
        net = od["net_sale"].sum()
        gmv = od["gmv"].sum()
        disc = od["discount"].sum()
        cr = ix[ix["Alias Category"] == "Cakes"]["item_total"].sum()
        ir = ix["item_total"].sum()
        rows.append({
            "dt": str(d), "dow": d.strftime("%a"),
            "z_orders": int(z), "s_orders": int(s),
            "rev": float(net),
            "aov": safe_div(net, len(od)),
            "disc_pct": safe_div(disc, gmv) * 100,
            "out_disc_pct": safe_div(disc, gmv) * 100,
            "cake_share_rev": safe_div(cr, ir) * 100,
        })
    return rows


def rank_shifts(out_f, out_c, min_orders=10):
    """Rank outlets by orders for focal and comp days; compute rank movement.
    Only includes outlets with min_orders on either day to filter noise.
    """
    # Eligible set: outlet must have >= min_orders on at least one day
    eligible = set()
    for o, r in out_f.items():
        if r["orders"] >= min_orders:
            eligible.add(o)
    for o, r in out_c.items():
        if r["orders"] >= min_orders:
            eligible.add(o)

    f_orders = {o: out_f.get(o, {}).get("orders", 0) for o in eligible}
    c_orders = {o: out_c.get(o, {}).get("orders", 0) for o in eligible}

    # Rank descending — most orders = rank 1
    f_rank = {o: r for r, (o, _) in enumerate(
        sorted(f_orders.items(), key=lambda kv: -kv[1]), start=1)}
    c_rank = {o: r for r, (o, _) in enumerate(
        sorted(c_orders.items(), key=lambda kv: -kv[1]), start=1)}

    rows = []
    for o in eligible:
        fr = f_rank.get(o)
        cr = c_rank.get(o)
        if fr is None or cr is None:
            continue
        delta = cr - fr  # positive = moved up (lower rank number)
        rows.append({
            "outlet": o,
            "city": out_f.get(o, out_c.get(o, {})).get("city", ""),
            "f_rank": fr, "c_rank": cr, "delta": delta,
            "f_orders": f_orders[o], "c_orders": c_orders[o],
            "abs_delta": abs(delta),
        })
    rows.sort(key=lambda r: -r["abs_delta"])
    return rows


def sku_concentration(items, dt, dt_comp, discontinued=None):
    """How concentrated is yesterday's volume in top SKUs?
    Returns top-5, top-10, top-20 share of orders and revenue, focal vs comp.
    Discontinued items remain in the totals (so concentration math is honest)
    but are excluded from the 'new yesterday / not sold yesterday' callouts.
    """
    discontinued = discontinued or set()

    def shares(items_dt):
        if items_dt.empty:
            return {"top5_qty": 0, "top10_qty": 0, "top20_qty": 0,
                    "top5_rev": 0, "top10_rev": 0, "top20_rev": 0,
                    "n_skus_active": 0, "total_qty": 0, "total_rev": 0}
        agg = items_dt.groupby("Alias Name").agg(
            qty=("item_quantity", "sum"),
            rev=("item_total", "sum")).reset_index()
        total_qty = agg["qty"].sum()
        total_rev = agg["rev"].sum()
        agg_q = agg.sort_values("qty", ascending=False)
        agg_r = agg.sort_values("rev", ascending=False)
        n_active = (agg["qty"] > 0).sum()
        return {
            "top5_qty":  safe_div(agg_q.head(5)["qty"].sum(),  total_qty) * 100,
            "top10_qty": safe_div(agg_q.head(10)["qty"].sum(), total_qty) * 100,
            "top20_qty": safe_div(agg_q.head(20)["qty"].sum(), total_qty) * 100,
            "top5_rev":  safe_div(agg_r.head(5)["rev"].sum(),  total_rev) * 100,
            "top10_rev": safe_div(agg_r.head(10)["rev"].sum(), total_rev) * 100,
            "top20_rev": safe_div(agg_r.head(20)["rev"].sum(), total_rev) * 100,
            "n_skus_active": int(n_active),
            "total_qty": int(total_qty),
            "total_rev": float(total_rev),
        }

    f = shares(items[items["dt"] == dt])
    c = shares(items[items["dt"] == dt_comp])
    f_set = set(items[items["dt"] == dt]["Alias Name"].unique()) - discontinued
    c_set = set(items[items["dt"] == dt_comp]["Alias Name"].unique()) - discontinued
    new_yesterday = f_set - c_set
    gone_yesterday = c_set - f_set
    return {
        "focal": f, "comp": c,
        "new_skus": sorted(new_yesterday),
        "dropped_skus": sorted(gone_yesterday),
    }


def kpi_matrix(orders, items, focal_dt):
    """Build a 5-period × 4-metric × 3-platform table.

    Periods:
      - Yesterday (focal)
      - Day before (focal - 1)
      - Same DOW last week (focal - 7)
      - 7-day trailing avg (days [focal-7..focal-1] excluding focal)
      - 30-day trailing avg (days [focal-30..focal-1] excluding focal)

    Metrics: Orders, Net Sales, Discount, AOV
    Platforms: Total / Zomato / Swiggy
    """
    from datetime import timedelta as _td

    def _topline_for_dates(dates):
        """Returns dict[platform] -> dict of summed/averaged metrics across dates."""
        rows = [topline(orders, items, d) for d in dates]
        out = {}
        for plat in ["All", "Zomato", "Swiggy"]:
            n = len(rows)
            if n == 0:
                out[plat] = {"orders": 0, "net_sale": 0, "discount": 0, "aov": 0,
                             "disc_pct": 0, "n_days": 0}
                continue
            avg_orders   = sum(r[plat]["orders"]    for r in rows) / n
            avg_net_sale = sum(r[plat]["net_sale"]  for r in rows) / n
            avg_discount = sum(r[plat]["discount"]  for r in rows) / n
            tot_orders   = sum(r[plat]["orders"]    for r in rows)
            tot_net_sale = sum(r[plat]["net_sale"]  for r in rows)
            tot_gmv      = sum(r[plat]["gmv"]       for r in rows)
            tot_disc     = sum(r[plat]["discount"]  for r in rows)
            out[plat] = {
                "orders": avg_orders,
                "net_sale": avg_net_sale,
                "discount": avg_discount,
                "aov": safe_div(tot_net_sale, tot_orders),
                "disc_pct": safe_div(tot_disc, tot_gmv) * 100,
                "n_days": n,
            }
        return out

    available = set(orders["dt"].unique())

    yesterday   = focal_dt
    day_before  = focal_dt - _td(days=1)
    lw_same_dow = focal_dt - _td(days=7)

    last7  = [focal_dt - _td(days=i) for i in range(1, 8)]
    last7  = [d for d in last7 if d in available]
    last30 = [focal_dt - _td(days=i) for i in range(1, 31)]
    last30 = [d for d in last30 if d in available]

    periods = [
        ("Yesterday",      [yesterday]),
        ("Day before",     [day_before]    if day_before in available else []),
        ("Same DOW LW",    [lw_same_dow]   if lw_same_dow in available else []),
        ("7-day avg",      last7),
        ("30-day avg",     last30),
    ]

    matrix = {}
    for label, dates in periods:
        matrix[label] = _topline_for_dates(dates) if dates else None
    return matrix


# =====================================================================
# Belgian Chocolate Cake — pricing experiment (Chivas Regal effect)
# =====================================================================
def belgian_pricing_experiment(items, orders, focal_dt, config):
    """Compare Test (₹899 real) vs Control (₹699 with strikethrough) since
    experiment start. Returns:
      - pre/post per-outlet-per-day qty + conversion + revenue for each group
      - daily trend (qty per outlet per day) for chart
      - per-outlet breakdown for the focal day
    """
    from datetime import timedelta as _td
    sku = config["sku_name"]
    start = config["start_date"]
    test_set = set(config["test_outlets"])

    sku_items = items[items["Alias Name"] == sku].copy()
    if sku_items.empty:
        return None

    # Outlets that actually carry Belgian, split into test vs control
    carrying = set(sku_items["restaurant_name"].unique())
    test_carrying    = sorted(test_set & carrying)
    control_carrying = sorted(carrying - test_set)

    def _block(start_dt, end_dt, outlet_set):
        """Compute metrics for an outlet group across a date window (inclusive)."""
        if not outlet_set: return None
        days = (end_dt - start_dt).days + 1
        sub_items = sku_items[
            (sku_items["dt"] >= start_dt) & (sku_items["dt"] <= end_dt) &
            (sku_items["restaurant_name"].isin(outlet_set))
        ]
        sub_orders = orders[
            (orders["dt"] >= start_dt) & (orders["dt"] <= end_dt) &
            (orders["delivered"] == 1) &
            (orders["Outlet Name"].isin(outlet_set))
        ]
        n_outlets = len(outlet_set)
        qty = int(sub_items["item_quantity"].sum())
        rev = float(sub_items["item_total"].sum())
        n_orders_total = len(sub_orders)
        n_orders_with = sub_items["invoice_no"].nunique()
        return {
            "n_outlets": n_outlets, "n_days": days,
            "qty": qty, "rev": rev,
            "qty_per_outlet_per_day": safe_div(qty, n_outlets * days),
            "rev_per_outlet_per_day": safe_div(rev, n_outlets * days),
            "n_orders_total": n_orders_total,
            "n_orders_with": n_orders_with,
            "conversion_pct": safe_div(n_orders_with, n_orders_total) * 100,
            "avg_realised_price": safe_div(rev, qty),
        }

    pre_window  = (start - _td(days=14), start - _td(days=1))
    post_window = (start, focal_dt)

    pre_test     = _block(*pre_window,  test_carrying)
    pre_control  = _block(*pre_window,  control_carrying)
    post_test    = _block(*post_window, test_carrying)
    post_control = _block(*post_window, control_carrying)

    # Daily trend: avg qty per outlet per day, for the chart
    # Window: 7 days before start_date through focal_dt
    chart_start = start - _td(days=7)
    chart_dates = []
    d = chart_start
    while d <= focal_dt:
        chart_dates.append(d); d += _td(days=1)

    daily_test = []
    daily_control = []
    for d in chart_dates:
        t = sku_items[(sku_items["dt"] == d) & (sku_items["restaurant_name"].isin(test_carrying))]
        c = sku_items[(sku_items["dt"] == d) & (sku_items["restaurant_name"].isin(control_carrying))]
        daily_test.append(safe_div(int(t["item_quantity"].sum()), len(test_carrying)))
        daily_control.append(safe_div(int(c["item_quantity"].sum()), len(control_carrying)))

    # Per-outlet on focal day
    focal_per_outlet = []
    for outlet in sorted(carrying):
        s = sku_items[(sku_items["dt"] == focal_dt) & (sku_items["restaurant_name"] == outlet)]
        # Trailing 7-day avg per outlet
        prev7 = sku_items[(sku_items["dt"] >= focal_dt - _td(days=7)) &
                          (sku_items["dt"] < focal_dt) &
                          (sku_items["restaurant_name"] == outlet)]
        focal_per_outlet.append({
            "outlet": outlet,
            "group": "Test (₹899)" if outlet in test_set else "Control (₹699)",
            "qty_focal": int(s["item_quantity"].sum()),
            "rev_focal": float(s["item_total"].sum()),
            "qty_7d_avg": prev7["item_quantity"].sum() / 7.0,
        })

    return {
        "sku": sku, "start_date": start,
        "test_outlets": test_carrying, "control_outlets": control_carrying,
        "test_outlets_missing": sorted(test_set - carrying),
        "pre_window": pre_window, "post_window": post_window,
        "pre_test": pre_test, "pre_control": pre_control,
        "post_test": post_test, "post_control": post_control,
        "chart_dates": [str(d) for d in chart_dates],
        "chart_test": daily_test, "chart_control": daily_control,
        "focal_per_outlet": focal_per_outlet,
    }


# =====================================================================
# New product launches — Lux Cakes and Mango Seasonal
# =====================================================================
def _launch_metrics(items, orders, focal_dt, sku_filter, label):
    """Generic launch tracker. sku_filter is a function (item_name -> bool).
    Returns:
      - per-SKU summary: launch date, total qty, top outlet
      - outlets that have NEVER sold any item from this set
      - daily trend since launch
      - focal-day-specific metrics
    """
    from datetime import timedelta as _td
    matching = items[items["Alias Name"].apply(sku_filter)].copy()
    all_outlets = sorted({o for o in orders["Outlet Name"].unique() if o.startswith("CC-")})

    if matching.empty:
        return {
            "label": label, "active": False,
            "skus": [], "outlets_with_sales": [], "outlets_no_sales": all_outlets,
            "daily": [], "focal_total": 0, "focal_outlets": 0,
            "total_qty_since_launch": 0,
        }

    launch_dt = matching["dt"].min()
    sku_summary = []
    for sku in sorted(matching["Alias Name"].unique()):
        sub = matching[matching["Alias Name"] == sku]
        first = sub["dt"].min()
        sub_focal = sub[sub["dt"] == focal_dt]
        sub_7d = sub[(sub["dt"] >= focal_dt - _td(days=7)) & (sub["dt"] < focal_dt)]
        outlet_counts = sub.groupby("restaurant_name")["item_quantity"].sum().sort_values(ascending=False)
        top_outlet = outlet_counts.index[0] if not outlet_counts.empty else "—"
        top_outlet_qty = int(outlet_counts.iloc[0]) if not outlet_counts.empty else 0
        z_qty = int(sub[sub["platform"]=="Zomato"]["item_quantity"].sum())
        s_qty = int(sub[sub["platform"]=="Swiggy"]["item_quantity"].sum())
        sku_summary.append({
            "sku": sku, "launch_dt": str(first),
            "days_live": (focal_dt - first).days + 1,
            "total_qty": int(sub["item_quantity"].sum()),
            "total_rev": float(sub["item_total"].sum()),
            "n_outlets": int(sub["restaurant_name"].nunique()),
            "z_qty": z_qty, "s_qty": s_qty,
            "focal_qty": int(sub_focal["item_quantity"].sum()),
            "qty_7d_avg": sub_7d["item_quantity"].sum() / 7.0,
            "top_outlet": top_outlet, "top_outlet_qty": top_outlet_qty,
        })
    sku_summary.sort(key=lambda x: -x["total_qty"])

    # Per-outlet: who's selling, who isn't
    outlet_qty = matching.groupby("restaurant_name")["item_quantity"].sum().to_dict()
    outlets_with_sales = []
    for o in all_outlets:
        q = int(outlet_qty.get(o, 0))
        if q > 0:
            sub = matching[matching["restaurant_name"] == o]
            outlets_with_sales.append({
                "outlet": o, "qty": q,
                "n_skus": int(sub["Alias Name"].nunique()),
                "first_sale": str(sub["dt"].min()),
            })
    outlets_with_sales.sort(key=lambda x: -x["qty"])
    outlets_no_sales = [o for o in all_outlets if outlet_qty.get(o, 0) == 0]

    # Daily trend since launch
    chart_dates = []
    d = launch_dt
    while d <= focal_dt:
        chart_dates.append(d); d = d + _td(days=1)
    daily = []
    for d in chart_dates:
        sub = matching[matching["dt"] == d]
        daily.append({"dt": str(d), "qty": int(sub["item_quantity"].sum()),
                      "rev": float(sub["item_total"].sum()),
                      "n_outlets": int(sub["restaurant_name"].nunique())})

    focal_sub = matching[matching["dt"] == focal_dt]
    return {
        "label": label, "active": True,
        "launch_dt": str(launch_dt),
        "skus": sku_summary,
        "outlets_with_sales": outlets_with_sales,
        "outlets_no_sales": outlets_no_sales,
        "daily": daily,
        "focal_total": int(focal_sub["item_quantity"].sum()),
        "focal_outlets": int(focal_sub["restaurant_name"].nunique()),
        "total_qty_since_launch": int(matching["item_quantity"].sum()),
        "total_rev_since_launch": float(matching["item_total"].sum()),
    }


def lux_cakes_metrics(items, orders, focal_dt, config):
    skus = set(config["skus"])
    return _launch_metrics(items, orders, focal_dt,
                           lambda x: isinstance(x, str) and x in skus,
                           config["label"])


def mango_seasonal_metrics(items, orders, focal_dt, config):
    keyword = config["keyword"].lower()
    return _launch_metrics(items, orders, focal_dt,
                           lambda x: isinstance(x, str) and keyword in x.lower(),
                           config["label"])
