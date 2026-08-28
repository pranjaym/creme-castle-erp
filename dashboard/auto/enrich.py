#!/usr/bin/env python3
"""
Turn a RAW Petpooja item-sales export (order_summary_item) into the ENRICHED item
sheet the Creme Castle daily dashboard expects. Validated to reproduce the existing
"1 April onwards" enriched file (Alias/Category/City/Actial Date 100%, Hour 99.98%).

What it does, in order (per Pranjay, 23 Jul 2026):
  1. Keep only Zomato and Swiggy rows. Zomato_Creme Castle counts as Zomato and
     Toing by Swiggy counts as Swiggy; everything else (D2C/website) is dropped.
  2. Add the glossary layer: item_name -> Alias Name + Alias Category (streamlines
     categories), plus City / Store Type / Location Code from the outlet glossaries.
  3. Compute the business-day columns on THE ONE RULE, 04:00 IST to 03:59 IST next
     day: a sale before 04:00 belongs to the PREVIOUS day and its Hour is shown as
     +24 (01:00 -> Hour 25). Actial Date and Week follow that boundary. This is the
     same rule as the SQL business_day() in kitchen/migrations/000_foundation.sql
     and kitchen/lib/business-day.mjs. (Changed from an 07:00 boundary on 29 Jul
     2026 so the dashboard, the spine and the ERP portal share one definition. It
     is a no-op on the numbers: across 1 Apr to 27 Jul the 03:00 to 07:00 window
     holds 1 order out of 333,905 and 0 item lines, because the outlets are shut.)
  4. Report any item_name missing from the glossary, AND any restaurant_name missing
     from the outlet glossaries, so a human can add the mapping before the dashboard is
     built (never guess an alias, never guess a city).

Glossaries live as editable CSVs in ./glossary and are extended when a new item is
mapped, so the mapping is a growing, owned asset.
"""
from datetime import datetime, timedelta
import os
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
GLOSSARY_DIR = os.path.join(HERE, "glossary")

# area labels that fold into a parent platform before the Zomato/Swiggy filter
AREA_MAP = {
    "Zomato_Creme Castle": "Zomato",
    "Zomato_Creme_Castle": "Zomato",
    "Toing by Swiggy": "Swiggy",
}
KEEP_PLATFORMS = {"Zomato", "Swiggy"}

# THE ONE BUSINESS-DAY RULE: 04:00 IST to 03:59 IST next day. Kept identical to
# cc_dashboard/loaders.py, the SQL business_day() and kitchen/lib/business-day.mjs.
BUSINESS_DAY_CUTOFF_HOUR = 4


def load_glossary():
    """Return the mapping dicts. THE SPINE IS THE SOURCE OF TRUTH from 28 Aug 2026
    (F39): public.item_glossary and public.outlets are what the portal's glossary
    screens write to, so the dashboard must read the same thing or the screens would be
    decorative. The CSVs remain only as a fallback for a run with no database, and as
    the record of where the mapping originally came from."""
    try:
        return _load_glossary_from_spine()
    except Exception as e:
        print(f"  glossary: spine unavailable ({str(e)[:90]}), falling back to the CSVs")
        return _load_glossary_from_csv()


def _load_glossary_from_spine():
    import psycopg2
    dsn = os.environ.get("SPINE_DATABASE_URL")
    if not dsn:
        raise RuntimeError("SPINE_DATABASE_URL not set")
    conn = psycopg2.connect(dsn)
    try:
        cur = conn.cursor()
        cur.execute("select item_name, alias, category from public.item_glossary")
        items = cur.fetchall()
        cur.execute("""select internal_code, city, store_type, location_code
                         from public.outlets""")
        outs = cur.fetchall()
    finally:
        conn.close()
    if not items:
        raise RuntimeError("public.item_glossary is empty")
    strip = lambda x: str(x).strip() if x is not None else None
    g = {
        "item_alias": {strip(a): b for a, b, _ in items},
        "item_cat":   {strip(a): c for a, _, c in items},
        "out_city":   {strip(a): b for a, b, _, _ in outs if b},
        "out_type":   {strip(a): c for a, _, c, _ in outs if c},
        "out_loc":    {strip(a): d for a, _, _, d in outs if d},
    }
    print(f"  glossary: {len(items)} items and {len(outs)} outlets read from the spine")
    return g


def _load_glossary_from_csv():
    """The pre-28-Aug-2026 path. Kept as a fallback only."""
    g_item = pd.read_csv(os.path.join(GLOSSARY_DIR, "item_glossary.csv"))
    g_city = pd.read_csv(os.path.join(GLOSSARY_DIR, "city_glossary.csv"))
    g_out = pd.read_csv(os.path.join(GLOSSARY_DIR, "outlet_glossary.csv"))
    g_loc = pd.read_csv(os.path.join(GLOSSARY_DIR, "location_codes.csv"))
    strip = lambda s: s.astype(str).str.strip()
    return {
        "item_alias": dict(zip(strip(g_item["item_name"]), g_item["Alias"])),
        "item_cat": dict(zip(strip(g_item["item_name"]), g_item["Category"])),
        "out_city": dict(zip(strip(g_city["Outlet Name"]), g_city["City"])),
        "out_type": dict(zip(strip(g_out["restaurant_name"]), g_out["Type"])),
        "out_loc": dict(zip(strip(g_loc["Location"]), g_loc["Location Code"])),
    }


def _to_ts(x):
    """Parse a Petpooja item-report timestamp: raw CSV is 'dd/mm/yy H:MM', the .xlsb
    stores an Excel serial. Returns a datetime or None (never guessed)."""
    if isinstance(x, (int, float)):
        try:
            return datetime(1899, 12, 30) + timedelta(days=float(x))
        except (ValueError, OverflowError):
            return None
    for fmt in ("%d/%m/%y %H:%M", "%d/%m/%y %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(str(x).strip(), fmt)
        except (ValueError, AttributeError):
            continue
    return None


def enrich(raw_df, glossary=None):
    """raw_df: an order_summary_item DataFrame (raw Petpooja columns). Returns
    (enriched_df, unmapped_items, unmapped_outlets): the sorted lists of item names with
    no glossary alias and of outlet names with no city mapping. The caller should ask a
    human and add them; never guess either one."""
    g = glossary or load_glossary()
    df = raw_df.copy()

    df["_ts"] = df["date"].apply(_to_ts)
    dropped = int(df["_ts"].isna().sum())
    df = df.dropna(subset=["_ts"])

    df["area"] = df["area"].replace(AREA_MAP)
    df = df[df["area"].isin(KEEP_PLATFORMS)]

    df["Hour"] = df["_ts"].apply(
        lambda t: t.hour + 24 if t.hour < BUSINESS_DAY_CUTOFF_HOUR else t.hour)
    df["Actial Date"] = df["_ts"].apply(
        lambda t: (t - timedelta(days=1)).date()
        if t.hour < BUSINESS_DAY_CUTOFF_HOUR else t.date())
    df["Week"] = df["Actial Date"].apply(lambda d: d.isocalendar()[1])

    key = df["item_name"].astype(str).str.strip()
    df["Alias Name"] = key.map(g["item_alias"])
    df["Alias Category"] = key.map(g["item_cat"])
    out_key = df["restaurant_name"].astype(str).str.strip()
    df["City"] = out_key.map(g["out_city"])
    df["Store Type"] = out_key.map(g["out_type"])
    df["Location Code"] = out_key.map(g["out_loc"])

    unmapped = sorted(set(key[df["Alias Name"].isna()]))
    # Outlets, which this step never reported until 28 Aug 2026 (F39). A store missing
    # from the outlet glossaries gets no City, no Store Type and no Location Code, so it
    # silently drops out of every city and store-type view. CC-DL-South Campus and
    # CC-PB-Ludhiana sat like that for 40 and 17 days with nothing ever saying so.
    unmapped_outlets = sorted(set(out_key[df["City"].isna()]))
    df = df.drop(columns=["_ts"])
    if dropped:
        print(f"  enrich: skipped {dropped} rows with an unparseable date")
    return df, unmapped, unmapped_outlets


def add_item_mappings(mappings):
    """Append new item mappings to the item glossary CSV. `mappings` is a list of
    dicts with keys item_name, Alias, Category (Shelf Life optional). Idempotent:
    an item_name already present is left as-is."""
    path = os.path.join(GLOSSARY_DIR, "item_glossary.csv")
    g = pd.read_csv(path)
    have = set(g["item_name"].astype(str).str.strip())
    rows = [m for m in mappings if str(m.get("item_name", "")).strip() not in have]
    if not rows:
        return 0
    g = pd.concat([g, pd.DataFrame(rows)], ignore_index=True)
    g.to_csv(path, index=False)
    return len(rows)
