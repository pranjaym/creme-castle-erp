#!/usr/bin/env python3
"""
The running history for the daily dashboard, kept as two parquet files:
  history/orders.parquet   raw order-report rows (the dashboard's load_orders reads it)
  history/items.parquet    ENRICHED, Zomato/Swiggy item rows (load_items reads it)

Parquet, not the original .xlsx/.xlsb, because the item file must be WRITTEN each day
and pyxlsb is read-only. The dashboard's loaders were patched to read these when
CC_ORDERS_PARQUET / CC_ITEMS_PARQUET are set. Seed once from the "1 April onwards"
files, then append each day (deduped) so comparisons keep their full history.
"""
from datetime import datetime, timedelta
import os
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
HIST = os.path.join(HERE, "history")
ORDERS_PARQUET = os.path.join(HIST, "orders.parquet")
ITEMS_PARQUET = os.path.join(HIST, "items.parquet")

# Enriched item columns kept in history (superset of what the dashboard needs).
ITEM_COLS = ["restaurant_name", "invoice_no", "date", "area", "status", "item_name",
             "category_name", "item_price", "item_quantity", "item_total",
             "Alias Name", "Alias Category", "Store Type", "Hour", "Actial Date",
             "City", "Location Code", "Week"]
# Dedup key must be format-stable across sources: the raw `date` is an Excel serial in
# the seed .xlsb but a 'dd/mm/yy' string from the scrape, so it CANNOT be part of the key.
# (restaurant, invoice, item) is the natural key; Actial Date (a normalised YYYY-MM-DD
# string in both paths) disambiguates and stays format-stable.
ITEM_KEY = ["restaurant_name", "invoice_no", "item_name", "Actial Date"]
# F72 (11 Oct 2026): ITEM_KEY alone merged two lines of one bill whenever they named the
# same item (two Chocolate Truffle Cakes on separate lines, or one item at two prices):
# 12 lines and Rs 3,641 over 6 to 10 Oct 2026. Lines are now told apart by price and
# quantity too, and identical repeats by their order within the pull (_line).
ITEM_LINE_KEY = ["restaurant_name", "invoice_no", "item_name", "item_price",
                 "item_quantity", "Actial Date"]
ORDER_KEY = "Aggregator Order No."


def _storage_url(name):
    base = os.environ["SPINE_SUPABASE_URL"].rstrip("/")
    bucket = os.environ.get("DASH_HISTORY_BUCKET", "dashboard-history")
    return f"{base}/storage/v1/object/{bucket}/{name}"


def pull_history():
    """Cloud runner: fetch the history parquet from Supabase Storage before a run.
    Best effort: a missing object (first ever run) just leaves the local file absent."""
    import requests
    key = os.environ.get("SPINE_SUPABASE_SERVICE_ROLE_KEY")
    if not key or not os.environ.get("SPINE_SUPABASE_URL"):
        print("pull_history skipped (Supabase env not set)")
        return
    os.makedirs(HIST, exist_ok=True)
    for name, path in [("orders.parquet", ORDERS_PARQUET), ("items.parquet", ITEMS_PARQUET)]:
        try:
            r = requests.get(_storage_url(name),
                             headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=180)
            if r.status_code == 200 and r.content:
                with open(path, "wb") as f:
                    f.write(r.content)
                print(f"pulled {name} ({len(r.content)//1024} KB)")
        except Exception as e:
            print(f"pull {name} failed: {str(e)[:100]}")


def push_history():
    """Cloud runner: upload the updated history parquet back to Supabase Storage."""
    import requests
    key = os.environ.get("SPINE_SUPABASE_SERVICE_ROLE_KEY")
    if not key or not os.environ.get("SPINE_SUPABASE_URL"):
        print("push_history skipped (Supabase env not set)")
        return
    for name, path in [("orders.parquet", ORDERS_PARQUET), ("items.parquet", ITEMS_PARQUET)]:
        if not os.path.exists(path):
            continue
        with open(path, "rb") as f:
            blob = f.read()
        r = requests.post(_storage_url(name), data=blob, headers={
            "Authorization": f"Bearer {key}", "apikey": key,
            "Content-Type": "application/octet-stream", "x-upsert": "true"}, timeout=300)
        print(f"pushed {name}: {'ok' if r.ok else r.status_code}")


def _serial_to_date(x):
    try:
        return (datetime(1899, 12, 30) + timedelta(days=float(x))).date()
    except (ValueError, TypeError, OverflowError):
        return None


def _key_str(series):
    """Canonical string form of a key column so dedup matches across sources: dates,
    ints read as floats ('123.0'), and plain strings all normalise to the same text."""
    return series.astype(str).str.replace(r"\.0$", "", regex=True).str.strip()


def _dedup(df, key_cols):
    tmp = {c: _key_str(df[c]) for c in key_cols if c in df.columns}
    keyframe = pd.DataFrame(tmp)
    mask = ~keyframe.duplicated(keep="last")
    return df[mask.values].reset_index(drop=True)


def _parquet_safe(df):
    """Petpooja exports have mixed-type object columns (a Date column with both
    timestamps and stray strings, ids that are sometimes int sometimes text). Parquet
    is strictly typed, so cast every object column to a nullable string. The dashboard's
    loaders re-parse dates and numbers on read, so nothing downstream changes."""
    df = df.copy()
    for c in df.select_dtypes(include=["object"]).columns:
        df[c] = df[c].astype("string")
    return df


def append_orders(new_df):
    base = pd.read_parquet(ORDERS_PARQUET) if os.path.exists(ORDERS_PARQUET) else None
    df = pd.concat([base, new_df], ignore_index=True) if base is not None else new_df
    before = len(df)
    df = _dedup(df, [ORDER_KEY]) if ORDER_KEY in df.columns else df.drop_duplicates(keep="last")
    _parquet_safe(df).to_parquet(ORDERS_PARQUET, index=False)
    added = len(df) - (len(base) if base is not None else 0)
    print(f"orders history: {len(df):,} rows (+{max(added,0)} new, {before-len(df)} dupes dropped)")
    return df


def _with_line(df):
    """Number identical lines within one frame: 1, 2, ... in row order."""
    keyframe = pd.DataFrame({c: _key_str(df[c]) for c in ITEM_LINE_KEY})
    line = keyframe.groupby(ITEM_LINE_KEY, sort=False, dropna=False).cumcount() + 1
    return df.assign(_line=line.values)


def merge_items(base, new_df):
    """Fold one pull into the item history (F72, 11 Oct 2026).

    A business day strictly inside the pull is complete in it (the first and last day
    of any pull are cut by the 04:00 rule), so the pull REPLACES that day wholesale:
    the history then holds exactly the latest truth for it, repeat lines included.
    On the two edge days the history keeps what it holds and takes the pull's version
    of each line, telling lines apart by ITEM_LINE_KEY plus their order (_line), so
    two identical lines of one bill both survive. Days the pull does not touch are
    left alone. Each morning's yesterday is an inside day, so every day is replaced
    whole at least once.

    Guard (the spine's GUARD 2): an inside day whose pull holds fewer than 95% of the
    lines the history already has for it is treated as an edge day, so a cut-off pull
    can add lines but never wipe good history."""
    new_day = _key_str(new_df["Actial Date"])
    base_day = _key_str(base["Actial Date"])
    days = sorted(new_day.unique())
    held, pulled = base_day.value_counts(), new_day.value_counts()
    inner = {d for d in days[1:-1] if pulled[d] >= 0.95 * held.get(d, 0)}
    edge = set(days) - inner
    untouched = base[~base_day.isin(set(days))]
    edge_rows = pd.concat([_with_line(base[base_day.isin(edge)]),
                           _with_line(new_df[new_day.isin(edge)])], ignore_index=True)
    edge_rows = _dedup(edge_rows, ITEM_LINE_KEY + ["_line"]).drop(columns="_line")
    merged = pd.concat([untouched, edge_rows, new_df[new_day.isin(inner)]], ignore_index=True)
    return merged, len(inner)


def append_items(new_enriched_df):
    keep = [c for c in ITEM_COLS if c in new_enriched_df.columns]
    new_df = new_enriched_df[keep].copy()
    base = pd.read_parquet(ITEMS_PARQUET) if os.path.exists(ITEMS_PARQUET) else None
    if base is None or new_df.empty:
        df, replaced = (new_df if base is None else base), 0
    else:
        df, replaced = merge_items(base, new_df)
    _parquet_safe(df).to_parquet(ITEMS_PARQUET, index=False)
    added = len(df) - (len(base) if base is not None else 0)
    print(f"items history: {len(df):,} rows ({added:+,} net, {replaced} day(s) replaced whole)")
    return df


def seed_from_samples(orders_xlsx, items_xlsb):
    """One-time: build the two parquet files from the '1 April onwards' exports. The
    item file is already enriched (Actial Date as an Excel serial -> converted to a date;
    already Zomato/Swiggy only)."""
    print("seeding orders history from the order .xlsx ...")
    o = pd.read_excel(orders_xlsx, sheet_name=0)
    _parquet_safe(o).to_parquet(ORDERS_PARQUET, index=False)
    print(f"  orders.parquet: {len(o):,} rows")

    print("seeding items history from the item .xlsb ...")
    xl = pd.ExcelFile(items_xlsb, engine="pyxlsb")
    sheet = next((s for s in xl.sheet_names if s.startswith("Order_Summary_Item_Report")),
                 xl.sheet_names[0])
    it = pd.read_excel(items_xlsb, engine="pyxlsb", sheet_name=sheet)
    it = it[[c for c in ITEM_COLS if c in it.columns]].copy()
    it["Actial Date"] = it["Actial Date"].apply(_serial_to_date)
    it = it.dropna(subset=["Actial Date"])
    _parquet_safe(it).to_parquet(ITEMS_PARQUET, index=False)
    print(f"  items.parquet: {len(it):,} rows")
