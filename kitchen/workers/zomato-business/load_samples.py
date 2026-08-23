"""Load the four sample files into the spine, then report. Safe to re-run:
a second run must report zero new and zero changed, which is the proof that the
supersede logic is doing nothing when nothing has moved.

    python3 load_samples.py
"""
import os, sys
import parse as P, load as L

HERE = os.path.dirname(os.path.abspath(__file__))
L.load_env_file(os.path.join(HERE, "..", "..", ".env.local"))
S = os.path.expanduser(
    "~/Library/Mobile Documents/com~apple~CloudDocs/Downloads Drive/erp-plan/data-samples/")
def read(n): return open(S + n, encoding="utf-8-sig").read()

conn = L.connect(); conn.autocommit = False
try:
    with conn.cursor() as cur:
        orders, items = P.parse_order_file(read("zomato_orderlevel_20260818_20260819.csv"))
        run = L.open_run(cur, "business_order", "2026-08-18", "2026-08-19")
        print("orders      ", L.load_shape(cur, "order", orders, run))
        print("order_items ", L.load_shape(cur, "order_item", items, run))
        L.close_run(cur, run, len(orders) + len(items))

        seg = P.parse_segment_cube(read("zomato_agg_NRLxMealtime_20260814_20260820.csv"))
        run = L.open_run(cur, "business_segment", "2026-08-14", "2026-08-20")
        print("segment     ", L.load_shape(cur, "segment", seg, run))
        L.close_run(cur, run, len(seg))

        ads = P.parse_ads_cube(read("zomato_agg_ads_spendingpotential_20260814_20260820.csv"),
                               "spending_potential")
        run = L.open_run(cur, "business_ads_segment", "2026-08-14", "2026-08-20")
        print("ads_segment ", L.load_shape(cur, "ads_segment", ads, run))
        L.close_run(cur, run, len(ads))

        q = P.parse_quality_cube(read("zomato_agg_nobreakdown_20260814_20260820.csv"))
        run = L.open_run(cur, "business_quality", "2026-08-14", "2026-08-20")
        print("quality     ", L.load_shape(cur, "quality", q, run))
        print("outlets     ", L.upsert_outlets(cur, P.outlets_from(q + orders)))
        L.close_run(cur, run, len(q))
    conn.commit(); print("\ncommitted   (new, changed, unchanged)")
except Exception as e:
    conn.rollback(); print("ROLLED BACK:", type(e).__name__, e); sys.exit(1)
finally:
    conn.close()
