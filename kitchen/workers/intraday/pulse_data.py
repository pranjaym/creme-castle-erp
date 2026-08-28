#!/usr/bin/env python3
"""
Every number the intraday dashboard shows, computed in one place.

The metric definitions are NOT invented here. They are lifted verbatim from
Pranjay's existing CC Spot Check (cc_spotcheck/config.py and metrics.py), because a
second tool quoting a "sales" figure a few percent away from the first one is worse
than no second tool at all:

    Net Sales     = My amount + Container Charge - (Outlet Disc + Agg Disc)
    Disc Denom    = My amount + Container Charge
    AOV           = Net Sales / Orders
    Outlet Disc % = Outlet Disc / Disc Denom
    Total Disc %  = (OD + Agg) / Disc Denom
    Cancelled orders are excluded from every sales figure and counted separately.
    Business day starts 07:00. Same-DOW baseline = last 4, outlier dates excluded.

Parity proved against a real spot check dashboard generated at the 12:00 cutoff on
28 August 2026: Net Sales and AOV matched to the rupee (Rs 6.6L, Rs 672).
"""
import datetime as dt
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DAY_START = dt.time(7, 0)          # cc_spotcheck BUSINESS_DAY_START_HOUR = 7
SAME_DOW_LOOKBACK = 4
LAST_DAYS_LOOKBACK = 3

# cc_spotcheck OUTLIER_DATES: days too abnormal to average into a baseline. They are
# still shown when they fall in the window, marked, but never averaged.
OUTLIER_DATES = {
    dt.date(2026, 5, 9), dt.date(2026, 5, 10), dt.date(2026, 2, 14),
    dt.date(2025, 2, 14), dt.date(2025, 5, 10), dt.date(2025, 5, 11),
}
HIDDEN_CITIES = {"Lucknow"}


def load_groups():
    cfg = json.load(open(os.path.join(HERE, "categories.json"), encoding="utf-8"))
    return cfg["groups"], cfg.get("overlap_note", {})


def _src(day, today):
    """Today comes from the live pulse, any other day from the settled table. Both
    views expose identical columns on purpose, so every caller is source blind."""
    return ("intraday.v_orders_now" if day == today else "intraday.v_settled_orders",
            "intraday.v_items_now" if day == today else "intraday.v_settled_items")


def summary(cur, day, cutoff, today, platform=None, extra_where="", params=()):
    """cc_spotcheck.metrics.summary(), in SQL, for one day cut at one time of day."""
    orders_src, _ = _src(day, today)
    pf = "and platform = %s" if platform else ""
    cur.execute(f"""
        select count(*)                                            as received,
               count(*) filter (where status <> 'Cancelled')       as orders,
               coalesce(sum(net_sales)   filter (where status <> 'Cancelled'), 0) as net_sales,
               coalesce(sum(disc_denom)  filter (where status <> 'Cancelled'), 0) as denom,
               coalesce(sum(outlet_discount_num) filter (where status <> 'Cancelled'), 0) as od,
               coalesce(sum(agg_discount) filter (where status <> 'Cancelled'), 0) as ad
        from {orders_src}
        where business_date = %s
          and placed_at >= %s and placed_at <= %s {pf} {extra_where}
    """, (day, dt.datetime.combine(day, DAY_START),
          dt.datetime.combine(day, cutoff)) + ((platform,) if platform else ()) + params)
    r = cur.fetchone()
    received, orders, net, denom, od, ad = (r[0], r[1], float(r[2]), float(r[3]),
                                            float(r[4]), float(r[5]))
    cancelled = received - orders
    return {
        "received": received, "orders": orders, "cancelled": cancelled,
        "net_sales": net, "outlet_disc": od, "agg_disc": ad, "denom": denom,
        "cancel_rate": (cancelled / received * 100) if received else 0.0,
        "aov": (net / orders) if orders else 0.0,
        "outlet_disc_pct": (od / denom * 100) if denom else 0.0,
        "total_disc_pct": ((od + ad) / denom * 100) if denom else 0.0,
    }


def dow_dates(day, cur):
    """The last SAME_DOW_LOOKBACK same-weekday days the settled table actually has."""
    want = [day - dt.timedelta(days=7 * i) for i in range(1, SAME_DOW_LOOKBACK + 1)]
    cur.execute("select distinct business_date from landing.petpooja_online_orders "
                "where business_date = any(%s)", (want,))
    have = {r[0] for r in cur.fetchall()}
    return [d for d in want if d in have]


def recent_dates(day, cur):
    want = [day - dt.timedelta(days=i) for i in range(1, LAST_DAYS_LOOKBACK + 1)]
    cur.execute("select distinct business_date from landing.petpooja_online_orders "
                "where business_date = any(%s)", (want,))
    have = {r[0] for r in cur.fetchall()}
    return [d for d in want if d in have]


def dow_average(cur, days, cutoff, today, platform=None):
    """Mean of the same-DOW days, OUTLIER DATES EXCLUDED, as cc_spotcheck does. If
    every candidate is an outlier the average is taken over all of them rather than
    returning nothing, and the caller is told."""
    usable = [d for d in days if d not in OUTLIER_DATES] or days
    stats = [summary(cur, d, cutoff, today, platform) for d in usable]
    if not stats:
        return None, []
    keys = ["received", "orders", "cancelled", "net_sales", "outlet_disc", "agg_disc",
            "denom"]
    avg = {k: sum(s[k] for s in stats) / len(stats) for k in keys}
    avg["cancel_rate"] = (avg["cancelled"] / avg["received"] * 100) if avg["received"] else 0
    avg["aov"] = (avg["net_sales"] / avg["orders"]) if avg["orders"] else 0
    avg["outlet_disc_pct"] = (avg["outlet_disc"] / avg["denom"] * 100) if avg["denom"] else 0
    avg["total_disc_pct"] = ((avg["outlet_disc"] + avg["agg_disc"]) / avg["denom"] * 100) if avg["denom"] else 0
    return avg, usable


# ------------------------------------------------------------------ categories --

def category_rollup(cur, day, cutoff, today, groups):
    """Item value by group, for one day cut at one time.

    Item value is the item line total, GROSS of order level discounts. It does not
    foot to order level Net Sales and the report says so where it is shown."""
    _, items_src = _src(day, today)
    cur.execute(f"""
        select category_name,
               count(distinct invoice_no)          as orders,
               coalesce(sum(qty), 0)               as units,
               coalesce(sum(item_value), 0)        as value
        from {items_src}
        where business_date = %s and status <> 'Cancelled'
          and placed_at >= %s and placed_at <= %s
        group by 1
    """, (day, dt.datetime.combine(day, DAY_START), dt.datetime.combine(day, cutoff)))
    rows = cur.fetchall()
    lookup = {}
    for gname, cats in groups.items():
        for c in cats:
            lookup[c] = gname
    out, other_cats = {}, []
    for cat, orders, units, value in rows:
        g = lookup.get(cat, "Other")
        if g == "Other" and cat:
            other_cats.append(cat)
        b = out.setdefault(g, {"orders": 0, "units": 0.0, "value": 0.0, "cats": {}})
        b["orders"] += orders          # per-group order counts overlap across groups
        b["units"] += float(units)
        b["value"] += float(value)
        b["cats"][cat] = {"orders": orders, "units": float(units), "value": float(value)}
    return out, sorted(set(other_cats))


def group_orders(cur, day, cutoff, today, cats):
    """Distinct orders CONTAINING anything from these categories. Not the sum of the
    per-category order counts, which double counts a basket holding two of them."""
    if not cats:
        return 0
    _, items_src = _src(day, today)
    cur.execute(f"""
        select count(distinct invoice_no) from {items_src}
        where business_date = %s and status <> 'Cancelled'
          and placed_at >= %s and placed_at <= %s and category_name = any(%s)
    """, (day, dt.datetime.combine(day, DAY_START),
          dt.datetime.combine(day, cutoff), cats))
    return cur.fetchone()[0]


def top_items_in(cur, day, cutoff, today, cats, limit=8):
    if not cats:
        return []
    _, items_src = _src(day, today)
    cur.execute(f"""
        select item_name, category_name, coalesce(sum(qty),0) units,
               coalesce(sum(item_value),0) value, count(distinct invoice_no) in_orders
        from {items_src}
        where business_date = %s and status <> 'Cancelled'
          and placed_at >= %s and placed_at <= %s and category_name = any(%s)
        group by 1,2 order by 4 desc limit %s
    """, (day, dt.datetime.combine(day, DAY_START),
          dt.datetime.combine(day, cutoff), cats, limit))
    return cur.fetchall()


# ---------------------------------------------------------------- other splits --

def by_dimension(cur, day, cutoff, today, dim, hidden=()):
    orders_src, _ = _src(day, today)
    cur.execute(f"""
        select {dim},
               count(*) filter (where status <> 'Cancelled')       as orders,
               coalesce(sum(net_sales) filter (where status <> 'Cancelled'), 0) as net,
               coalesce(sum(disc_denom) filter (where status <> 'Cancelled'), 0) as denom,
               coalesce(sum(outlet_discount_num) filter (where status <> 'Cancelled'), 0) as od,
               count(*) filter (where status = 'Cancelled')        as cancelled,
               count(*)                                            as received
        from {orders_src}
        where business_date = %s and placed_at >= %s and placed_at <= %s
        group by 1 order by 3 desc
    """, (day, dt.datetime.combine(day, DAY_START), dt.datetime.combine(day, cutoff)))
    return [r for r in cur.fetchall() if r[0] not in hidden]


def hourly(cur, day, cutoff, today):
    src = "intraday.v_pulse_hourly" if day == today else "intraday.v_settled_hourly"
    cur.execute(f"""
        select extract(hour from hour)::int, orders, sales
        from {src} where business_date = %s
          and hour >= %s and hour <= %s order by 1
    """, (day, dt.datetime.combine(day, DAY_START), dt.datetime.combine(day, cutoff)))
    return {r[0]: (r[1], float(r[2])) for r in cur.fetchall()}
