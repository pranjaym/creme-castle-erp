#!/usr/bin/env python3
"""One-off: compare Father's Day (Jun 21, 2026) vs Mother's Day (May 10, 2026).
Reuses the existing pickled orders/items and the full metrics/render pipeline,
but pins focal_dt=Jun 21 and comp_dt=May 10 (instead of focal-7).
The 7-day baseline is still the 7 days immediately prior to focal (Jun 14-20)
to give a 'normal Sunday' reference frame."""
import sys, os, pickle, time, re
from datetime import date, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import metrics, metrics_v2, briefings, render

t0 = time.time()
with open("/tmp/cc_orders.pkl", "rb") as f:
    orders = pickle.load(f)
with open("/tmp/cc_items.pkl", "rb") as f:
    items = pickle.load(f)
with open("/tmp/cc_discontinued.pkl", "rb") as f:
    discontinued = pickle.load(f)
print(f"[{time.time()-t0:.1f}s] data loaded from pickles")

# --- Pinned dates ---
focal_dt = date(2026, 6, 21)   # Father's Day
comp_dt  = date(2026, 5, 10)   # Mother's Day

by_day = orders.groupby("dt").size()
item_dates = set(items["dt"].unique())
for d, label in [(focal_dt, "Father's Day"), (comp_dt, "Mother's Day")]:
    n_orders = int(by_day.get(d, 0))
    has_items = d in item_dates
    print(f"  {label:12} ({d}): {n_orders:,} orders, items={'yes' if has_items else 'NO'}")

# 7-day baseline = 7 days immediately preceding focal_dt
last7 = [focal_dt - timedelta(days=i) for i in range(1, 8)]
last7 = [d for d in last7 if d in by_day.index]
print(f"7-day baseline: {len(last7)} days ({last7[-1]} → {last7[0]})")

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
    "focal_dow": "Father's Day (Sun)",
    "comp_dow":  "Mother's Day (Sun)",
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

# Banner to make context clear (comparison is NOT last week here)
html = html.replace("<title>", "<title>[Father's vs Mother's Day] ", 1)
banner = (
    '<div style="background:#fde2e7;border-left:4px solid #ec4899;padding:12px 18px;'
    'margin:0 0 16px 0;font:14px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#831843">'
    '<b>One-off occasion comparison:</b> Focal = <b>Father\'s Day, Sun Jun 21 2026</b>. '
    'Comparison = <b>Mother\'s Day, Sun May 10 2026</b> '
    '(<b>not</b> "last week" — wherever the dashboard says "vs LW" or "comp", read it as '
    '"vs Mother\'s Day"). 7-day baseline = the 7 days immediately before Father\'s Day '
    '(Jun 14-20) as a normal-week reference. All other sections render normally.'
    '</div>'
)
html = re.sub(r'(<body[^>]*>)', r'\1' + banner, html, count=1)

OUTPUT_PATH = os.path.join(HERE, "cc_fathersday_vs_mothersday.html")
with open(OUTPUT_PATH, "w") as f:
    f.write(html)
print(f"[OK] Generated: {OUTPUT_PATH} ({len(html)/1024:.1f} KB) in {time.time()-t0:.1f}s")
