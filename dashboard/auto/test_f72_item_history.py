"""F72: the dashboard's item history keeps every line of a bill.

No files touched: merge_items is tested directly on small frames.
Run from this folder: python3 test_f72_item_history.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pandas as pd
import history_store as H

ok = True
def check(label, got, want):
    global ok
    good = got == want
    ok = ok and good
    print(f"  {'PASS' if good else 'FAIL'}  {label}: got {got!r}, want {want!r}")

def rows(day, inv, item="Chocolate Truffle Cake (500 Gm)", price=599.0, qty=1.0,
         status="Success", n=1):
    return [{"restaurant_name": "CC-GGN-Sector 4", "invoice_no": inv, "item_name": item,
             "item_price": price, "item_quantity": qty, "item_total": price * qty,
             "status": status, "Actial Date": day}] * n

def frame(*groups):
    return pd.DataFrame([r for g in groups for r in g])

def count(df, day, inv=None):
    m = df["Actial Date"].astype(str) == day
    if inv is not None:
        m &= df["invoice_no"].astype(str) == inv
    return int(m.sum())

# History as the parquet holds it (dates as strings, prices as floats).
base = frame(rows("2026-10-01", "1"), rows("2026-10-02", "2"),
             rows("2026-10-03", "3"),                                  # edge day of the pull
             rows("2026-10-04", "4"),                                  # inner, will gain a repeat
             rows("2026-10-05", "5"), rows("2026-10-05", "55", price=349.0))  # inner, amended
# A pull covering 3 to 6 Oct: 3 and 6 are edge days, 4 and 5 inside.
new = frame(rows("2026-10-03", "3", status="Delivered"),               # same line, new status
            rows("2026-10-03", "33", n=2),                             # two identical lines
            rows("2026-10-04", "4", n=2),                              # the repeat F72 lost
            rows("2026-10-05", "5"), rows("2026-10-05", "55", price=399.0),  # price amended
            rows("2026-10-06", "6"))
new["Actial Date"] = pd.to_datetime(new["Actial Date"]).dt.date        # as enrich makes it

merged, replaced = H.merge_items(base, new)
print("days the pull does not touch:")
check("1 and 2 Oct untouched", (count(merged, "2026-10-01"), count(merged, "2026-10-02")), (1, 1))
print("inner days are replaced whole:")
check("two days replaced", replaced, 2)
check("4 Oct keeps both identical lines", count(merged, "2026-10-04", "4"), 2)
check("5 Oct holds only the amended price", sorted(merged.loc[
    merged["invoice_no"].astype(str) == "55", "item_price"].tolist()), [399.0])
print("edge days merge, keeping repeat lines:")
check("3 Oct line 3 once, new status", merged.loc[merged["invoice_no"].astype(str) == "3",
                                                  "status"].tolist(), ["Delivered"])
check("3 Oct both identical lines of bill 33", count(merged, "2026-10-03", "33"), 2)
check("6 Oct added", count(merged, "2026-10-06"), 1)

print("a second identical pull changes nothing:")
again, _ = H.merge_items(merged, new)
check("same row count", len(again), len(merged))

print("guard: a cut-off pull cannot wipe a held inside day:")
held = frame(rows("2026-10-07", "x"), *[rows("2026-10-08", f"b{i}") for i in range(21)],
             rows("2026-10-09", "y"))
cut = frame(rows("2026-10-07", "x"), rows("2026-10-08", "b0"), rows("2026-10-09", "y"))
cut["Actial Date"] = pd.to_datetime(cut["Actial Date"]).dt.date
out, replaced = H.merge_items(held, cut)
check("8 Oct not replaced", replaced, 0)
check("8 Oct keeps all 21 held lines", count(out, "2026-10-08"), 21)

print("\nALL PASS" if ok else "\nFAILURES ABOVE")
sys.exit(0 if ok else 1)
