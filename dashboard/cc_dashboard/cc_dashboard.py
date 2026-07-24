#!/usr/bin/env python3
"""CC Daily Dashboard — entry point.

Run: python3 cc_dashboard.py
Reads two files (orders + items), writes cc_daily.html.
"""
import os
from datetime import timedelta
from loaders import load_orders, load_items, load_discontinued
import metrics
import metrics_v2
import briefings
import render

HERE = os.path.dirname(os.path.abspath(__file__))
OUTPUT_PATH = os.path.join(HERE, "cc_daily.html")


def main():
    print("=" * 60)
    print("CC Daily Dashboard")
    print("=" * 60)

    orders = load_orders()
    items  = load_items()
    discontinued = load_discontinued()

    # Pick focal date: max date with items present and >= 500 orders
    by_day = orders.groupby("dt").size()
    item_dates = set(items["dt"].unique())
    candidates = [d for d in by_day.index if by_day[d] >= 500 and d in item_dates]
    focal_dt = max(candidates)
    comp_dt  = focal_dt - timedelta(days=7)
    print(f"\nFocal date: {focal_dt} ({focal_dt.strftime('%A')})")
    print(f"Comparison: {comp_dt} ({comp_dt.strftime('%A')})")

    last7 = [focal_dt - timedelta(days=i) for i in range(1, 8)]
    last7 = [d for d in last7 if d in by_day.index]
    print(f"7-day baseline: {len(last7)} days")

    print("\nComputing metrics...")
    top_f = metrics.topline(orders, items, focal_dt)
    top_c = metrics.topline(orders, items, comp_dt)
    top_a = metrics.topline_avg(orders, items, last7)
    kpi_mat = metrics.kpi_matrix(orders, items, focal_dt)

    out_f = metrics.per_outlet(orders, items, focal_dt)
    out_c = metrics.per_outlet(orders, items, comp_dt)
    out_a = metrics.per_outlet_avg(orders, items, last7)

    cities = metrics.cities(out_f, out_c, out_a)
    cat_f  = metrics.categories(items, focal_dt)
    cat_c  = metrics.categories(items, comp_dt)
    skus   = metrics.top_skus(items, focal_dt, comp_dt, top_n=40, discontinued=discontinued)
    hour_outlets, hour_brand_f, hour_brand_c = metrics.hour_pattern(items, focal_dt, comp_dt)
    bands_f = metrics.discount_bands(orders, focal_dt)
    bands_c = metrics.discount_bands(orders, comp_dt)
    trend  = metrics.trend_14d(orders, items, focal_dt)

    rank_shifts = metrics.rank_shifts(out_f, out_c)
    sku_conc    = metrics.sku_concentration(items, focal_dt, comp_dt, discontinued=discontinued)

    # ---- V2 metrics ----
    print("Computing v2 metrics...")
    glance_block = metrics_v2.glance_block(orders, items, focal_dt)
    city_block   = metrics_v2.city_block(orders, items, focal_dt)
    disc_diag    = metrics_v2.discount_diagnostic(orders, focal_dt)
    cat_block    = metrics_v2.category_block(items, focal_dt)
    sku_conc_v2  = metrics_v2.sku_concentration_v2(items, focal_dt, discontinued=discontinued, top_n=10)
    cake_share_trend = metrics_v2.cake_share_trend_30d(items, focal_dt)

    print("Building briefings...")
    brfs = briefings.build(focal_dt, top_f, top_c, top_a, out_f, out_c, out_a, cities, orders=orders)
    print(f"  -> {len(brfs)} signals")
    for b in brfs[:5]:
        print(f"    [{b['level']:8}] {b['title']}")

    data = {
        "focal_dt": focal_dt, "comp_dt": comp_dt,
        "focal_dow": focal_dt.strftime("%A"), "comp_dow": comp_dt.strftime("%A"),
        "top_f": top_f, "top_c": top_c, "top_a": top_a,
        "kpi_matrix": kpi_mat,
        "out_f": out_f, "out_c": out_c, "out_a": out_a,
        "cities": cities, "cat_f": cat_f, "cat_c": cat_c,
        "skus": skus, "trend": trend,
        "rank_shifts": rank_shifts,
        "sku_concentration": sku_conc,
        "hour_outlets": hour_outlets, "hour_brand_f": hour_brand_f, "hour_brand_c": hour_brand_c,
        "bands_f": bands_f, "bands_c": bands_c,
        "briefings": brfs,
        # V2 blocks
        "glance_block": glance_block,
        "city_block": city_block,
        "disc_diag": disc_diag,
        "cat_block": cat_block,
        "sku_concentration_v2": sku_conc_v2,
        "cake_share_trend": cake_share_trend,
    }

    print("\nRendering...")
    html = render.render(data)
    with open(OUTPUT_PATH, "w") as f:
        f.write(html)
    print(f"\n[OK] Generated: {OUTPUT_PATH} ({len(html)/1024:.1f} KB)")


if __name__ == "__main__":
    main()
