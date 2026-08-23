"""Offline tests for parse.py, run against the real sample files in
erp-plan/data-samples/. No network, no database.

    python3 test_parse.py
"""
import os, sys, csv, io
import parse as P

S = os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/Downloads Drive/erp-plan/data-samples/")
def read(n): return open(S + n, encoding="utf-8-sig").read()

fails = []
def check(label, got, want):
    ok = got == want
    print(("  ok   " if ok else "  FAIL ") + f"{label}: got {got!r}" + ("" if ok else f", want {want!r}"))
    if not ok: fails.append(label)

print("contract 2, timestamps are IST not UTC")
dt = P.parse_ist("2026-08-19 22:10:01 +0000 UTC")
check("hour preserved", dt.hour, 22)
check("tz is +05:30", dt.utcoffset().total_seconds(), 19800.0)
check("mealtime at 22:10", P.mealtime_of(dt), "Dinner")
check("mealtime at 02:00", P.mealtime_of(P.parse_ist("2026-08-19 02:00:00 +0000 UTC")), "Late night")
check("mealtime at 07:00", P.mealtime_of(P.parse_ist("2026-08-19 07:00:00 +0000 UTC")), "Breakfast")

print("\ncontract, mixed date formats in one file")
check("m/d/yy",   str(P.parse_business_date("07/01/26")), "2026-07-01")
check("m/d/yyyy", str(P.parse_business_date("7/27/2026")), "2026-07-27")
check("monthly",  str(P.parse_business_date("Apr 2026")), "2026-04-01")
check("yyyymmdd", str(P.parse_business_date("20260818")), "2026-08-18")

print("\ncontract 3, item names containing square brackets")
tricky = ("[map[catalogue_id:1 item_category:Brownies item_name:Overload Brownie [1 Pc] "
          "item_quantity:2 item_sub_category:Brownies item_unit_cost:129.0000 pos_item_id:9]]")
lines = P.parse_items(tricky)
check("one line parsed", len(lines), 1)
check("bracketed name intact", lines[0]["item_name"], "Overload Brownie [1 Pc]")

print("\norder level file")
orders, items = P.parse_order_file(read("zomato_orderlevel_20260818_20260819.csv"))
check("order rows", len(orders), 4718)
check("item lines", len(items), 6497)
check("every order has a business_date", sum(1 for o in orders if o["business_date"]), 4718)
check("every order has a mealtime", sum(1 for o in orders if o["mealtime"]), 4718)
check("line_count sums to item rows", sum(o["line_count"] for o in orders), len(items))
check("pos_item_id present on every line", sum(1 for i in items if i["pos_item_id"]), 6497)
subtotal = sum(float(o["order_subtotal"]) for o in orders if o["order_subtotal"])
check("subtotal matches dashboard", round(subtotal), 2536226)   # 12.6L + 12.76L

print("\nsegment cube")
seg = P.parse_segment_cube(read("zomato_agg_NRLxMealtime_20260814_20260820.csv"))
check("rows", len(seg), 4725)
check("58 metrics + 5 dims", len(seg[0]), 63)
check("mealtime levels", len({r["mealtime"] for r in seg}), 5)
check("nrl levels", len({r["nrl_segment"] for r in seg}), 3)

print("\nads cube")
ads = P.parse_ads_cube(read("zomato_agg_ads_spendingpotential_20260814_20260820.csv"), "spending_potential")
check("rows", len(ads), 945)
check("segment values", sorted({r["segment_value"] for r in ads}), ["Economical", "Premium", "Standard"])
check("segment_type stamped", ads[0]["segment_type"], "spending_potential")

print("\nquality cube, read positionally")
q = P.parse_quality_cube(read("zomato_agg_nobreakdown_20260814_20260820.csv"))
check("rows", len(q), 315)
check("28 metrics + 2 dims", len(q[0]), 30)
check("all-orders spillage kept", "poor_packaging_or_spillage" in q[0], True)
check("all-orders others kept", "others_complaints" in q[0], True)
check("kitchen block kept", "average_kitchen_preparation_time" in q[0], True)
# the trap: a name-keyed reader loses two columns
d = list(csv.DictReader(io.StringIO(read("zomato_agg_nobreakdown_20260814_20260820.csv"))))
check("DictReader would lose 2 columns", 108 - len(d[0]), 2)

print("\noutlet dimension")
o = P.outlets_from(q)
check("outlets", len(o), 45)
check("first_seen populated", all(x["first_seen_date"] for x in o), True)

print()
print("FAILURES:", fails if fails else "none")
sys.exit(1 if fails else 0)
