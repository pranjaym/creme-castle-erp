#!/usr/bin/env python3
"""Step 3 — variant: Combined Fri-Sat-Sun (weekend) dashboard.

Treats the three days (Jun 5, 6, 7) as one synthetic 'focal day' (Jun 7)
and the prior weekend (May 29, 30, 31) as the synthetic comparison day
(May 31). Baseline = average across the 4 prior weekends (Fri-Sun totals).

This works by relabelling the `dt` column on a copy of the orders/items
dataframes, then reusing the existing metrics/render pipeline unchanged.
"""
import sys, os, pickle, time, copy
from datetime import date, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import pandas as pd
import metrics, metrics_v2, briefings, render

t0 = time.time()
with open("/tmp/cc_orders.pkl", "rb") as f:
    orders_raw = pickle.load(f)
with open("/tmp/cc_items.pkl", "rb") as f:
    items_raw = pickle.load(f)
with open("/tmp/cc_discontinued.pkl", "rb") as f:
    discontinued = pickle.load(f)
print(f"[{time.time()-t0:.1f}s] data loaded from pickles")

# --- Define weekends ---
def weekend_days(sunday):
    """Returns [Fri, Sat, Sun] for a given Sunday date."""
    return [sunday - timedelta(days=2), sunday - timedelta(days=1), sunday]

focal_sun = date(2026, 6, 7)
comp_sun  = date(2026, 5, 31)
focal_days = weekend_days(focal_sun)     # Jun 5, 6, 7
comp_days  = weekend_days(comp_sun)      # May 29, 30, 31

# Last 4 weekends prior to comp_sun for baseline
prior_sundays = [comp_sun - timedelta(days=7*i) for i in range(1, 5)]  # May 24, 17, 10, 3
prior_weekends = {s: weekend_days(s) for s in prior_sundays}

print(f"Focal weekend (Fri-Sat-Sun): {focal_days[0]} → {focal_days[2]}")
print(f"Comp weekend  (Fri-Sat-Sun): {comp_days[0]} → {comp_days[2]}")
print(f"Baseline: {len(prior_sundays)} prior weekends (each Fri-Sun cumulative)")

# Build remap: every weekend's Fri+Sat gets relabelled to its Sunday so the
# three days collapse into one row keyed by the Sunday's date.
remap = {}
for d in focal_days[:2]:
    remap[d] = focal_sun
for d in comp_days[:2]:
    remap[d] = comp_sun
for sun, days in prior_weekends.items():
    for d in days[:2]:
        remap[d] = sun

def relabel(df, col="dt"):
    out = df.copy()
    out[col] = out[col].map(lambda d: remap.get(d, d))
    return out

orders = relabel(orders_raw, "dt")
items  = relabel(items_raw,  "dt")
print(f"[{time.time()-t0:.1f}s] relabelled — focal day now contains {(orders['dt']==focal_sun).sum():,} order rows (vs {(orders_raw['dt']==focal_sun).sum():,} for just Sun)")

# --- focal/comp dates are now the Sundays (which carry all 3 days of data) ---
focal_dt = focal_sun
comp_dt  = comp_sun
last7    = prior_sundays  # the 4 prior weekend Sundays (each = combined Fri-Sun)

print(f"[{time.time()-t0:.1f}s] computing metrics...")
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

print(f"[{time.time()-t0:.1f}s] v2 metrics...")
glance_block = metrics_v2.glance_block(orders, items, focal_dt)
city_block   = metrics_v2.city_block(orders, items, focal_dt)
disc_diag    = metrics_v2.discount_diagnostic(orders, focal_dt)
cat_block    = metrics_v2.category_block(items, focal_dt)
sku_conc_v2  = metrics_v2.sku_concentration_v2(items, focal_dt, discontinued=discontinued, top_n=10)
cake_share_trend = metrics_v2.cake_share_trend_30d(items, focal_dt)

import experiments_config as ec
lux_deep = metrics_v2.lux_deep_dive(items, orders, focal_dt, ec.LUX_CAKES)
mango = metrics.mango_seasonal_metrics(items, orders, focal_dt, ec.MANGO_SEASONAL)

print(f"[{time.time()-t0:.1f}s] building briefings...")
brfs = briefings.build(focal_dt, top_f, top_c, top_a, out_f, out_c, out_a, cities, orders=orders)
print(f"  -> {len(brfs)} signals")

data = {
    "focal_dt": focal_dt, "comp_dt": comp_dt,
    "focal_dow": f"Fri-Sat-Sun (Jun 5-7)",
    "comp_dow":  f"Fri-Sat-Sun (May 29-31)",
    "top_f": top_f, "top_c": top_c, "top_a": top_a,
    "kpi_matrix": kpi_mat,
    "out_f": out_f, "out_c": out_c, "out_a": out_a,
    "cities": cities, "cat_f": cat_f, "cat_c": cat_c,
    "skus": skus, "trend": trend,
    "rank_shifts": rank_shifts,
    "sku_concentration": sku_conc,
    "mango": mango,
    "hour_outlets": hour_outlets, "hour_brand_f": hour_brand_f, "hour_brand_c": hour_brand_c,
    "bands_f": bands_f, "bands_c": bands_c,
    "briefings": brfs,
    "glance_block": glance_block,
    "city_block": city_block,
    "disc_diag": disc_diag,
    "cat_block": cat_block,
    "sku_concentration_v2": sku_conc_v2,
    "lux_deep": lux_deep,
    "cake_share_trend": cake_share_trend,
}

print(f"[{time.time()-t0:.1f}s] rendering...")
html = render.render(data)

# Tweak the title so it's obvious this is a weekend cumulative view
html = html.replace(
    "<title>", "<title>[Weekend] ", 1
)
banner = (
    '<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 18px;'
    'margin:0 0 16px 0;font:14px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#78350f">'
    '<b>Combined weekend view:</b> Focal = <b>Fri-Sat-Sun, Jun 5-7</b> '
    '(shown as 2026-06-07). Comparison = <b>Fri-Sat-Sun, May 29-31</b> '
    '(shown as 2026-05-31). 7-day baseline = average of past 4 weekends (Fri-Sun cumulatives, '
    'May 1-3, May 8-10, May 15-17, May 22-24). '
    'All totals are 3-day cumulatives; AOV / discount % / shares are weighted across the 3 days. '
    'The 14-day trend chart shows weekend Sundays as 3× spikes (each represents a Fri-Sun total).'
    '</div>'
)
# Insert banner right after <body>
import re
html = re.sub(r'(<body[^>]*>)', r'\1' + banner, html, count=1)

OUTPUT_PATH = os.path.join(HERE, "cc_weekend.html")
with open(OUTPUT_PATH, "w") as f:
    f.write(html)
print(f"[OK] Generated: {OUTPUT_PATH} ({len(html)/1024:.1f} KB) in {time.time()-t0:.1f}s")
