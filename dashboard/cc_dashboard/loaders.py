"""Load orders and items. Returns clean DataFrames.

File detection rules (in order):
- ITEMS file: any .xlsb in the upload dir; if multiple, pick most recently modified
- ORDERS file: any .xlsx in the upload dir whose name contains "order" or "transaction"
  (case-insensitive); if multiple, pick most recently modified

The upload directory is determined in this order:
  1. UPLOAD_DIR environment variable (if set)
  2. /mnt/user-data/uploads (Claude.ai context)
  3. ./uploads relative to this script (default for local use)
"""
from datetime import datetime, timedelta
import glob
import os
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))


def _resolve_upload_dir():
    env = os.environ.get("UPLOAD_DIR")
    if env:
        return env
    claude_path = "/mnt/user-data/uploads"
    if os.path.isdir(claude_path):
        return claude_path
    return os.path.join(HERE, "uploads")


UPLOAD_DIR = _resolve_upload_dir()


def _newest(paths):
    if not paths: return None
    return max(paths, key=os.path.getmtime)


def find_orders_path():
    candidates = []
    for p in glob.glob(os.path.join(UPLOAD_DIR, "*.xlsx")):
        name = os.path.basename(p).lower()
        if "order" in name or "transaction" in name:
            candidates.append(p)
    p = _newest(candidates)
    if not p:
        raise FileNotFoundError(
            f"No orders file found in {UPLOAD_DIR}. "
            f"Expected an .xlsx file with 'order' or 'transaction' in the name.")
    return p


def find_items_path():
    candidates = glob.glob(os.path.join(UPLOAD_DIR, "*.xlsb"))
    p = _newest(candidates)
    if not p:
        raise FileNotFoundError(
            f"No items file found in {UPLOAD_DIR}. Expected a .xlsb file.")
    return p


EXCLUDED = ["Kunafa Dream Cake", "Apple Pie", "Strawberry Custard Tub",
            "Carrot Cake Slice", "Dubai Viral Kunafa"]

CITY_MAP = {"DL":"Delhi","ND":"Noida","GGN":"Gurugram","FBD":"Faridabad",
            "GZB":"Ghaziabad","UP":"Meerut","JP":"Jaipur","CHD":"Chandigarh",
            "LKO":"Lucknow"}

def is_excluded(name):
    return isinstance(name, str) and any(p in name for p in EXCLUDED)

def outlet_to_city(name):
    if not isinstance(name, str): return "Unknown"
    parts = name.split("-")
    return CITY_MAP.get(parts[1], "Unknown") if len(parts) >= 2 else "Unknown"


# THE ONE BUSINESS-DAY RULE: 04:00 IST to 03:59 IST next day. Same rule as the SQL
# business_day() in kitchen/migrations/000_foundation.sql and kitchen/lib/business-day.mjs,
# so the dashboard, the spine and the ERP portal all mean the same thing by "27 July".
# Timestamps in the Petpooja reports are already IST local, so no zone shift is needed.
BUSINESS_DAY_CUTOFF_HOUR = 4


def business_day(ts_series):
    """The business day (a date) for a series of IST sale timestamps. A sale at
    01:30 belongs to the previous day, which is how the outlets and the aggregators
    account for a night. Orders used to be stamped with the plain calendar date here
    while items were stamped with a 07:00 rule, so one dashboard row mixed two
    different 24-hour windows (fixed 29 Jul 2026)."""
    return (ts_series - pd.Timedelta(hours=BUSINESS_DAY_CUTOFF_HOUR)).dt.date


def load_orders():
    # Automation path: read the running order history parquet if CC_ORDERS_PARQUET is
    # set (raw order columns). Otherwise the original manual path (newest .xlsx upload).
    src = os.environ.get("CC_ORDERS_PARQUET")
    if src:
        print(f"Loading orders from {os.path.basename(src)} (history)...")
        df = pd.read_parquet(src)
    else:
        path = find_orders_path()
        print(f"Loading orders from {os.path.basename(path)}...")
        df = pd.read_excel(path, sheet_name=0)
    df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
    df = df.dropna(subset=["Date"])
    df = df[df["Outlet Name"].astype(str).str.startswith("CC-")]
    df["dt"] = business_day(df["Date"])
    df["platform"] = df["Order From"].replace({"Toing by Swiggy": "Swiggy"})
    df["city"] = df["Outlet Name"].apply(outlet_to_city)
    df["hour"] = df["Date"].dt.hour
    for c in ["My amount", "Aggregator Discount", "Outlet Discount",
              "Container Charges", "Total"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    # Pranjay's canonical formula (confirmed May 2026):
    #   GMV       = My amount + Container Charges
    #   Discount  = Outlet Discount ONLY (aggregator discount excluded)
    #   Net Sales = GMV - Outlet Discount
    #   Disc%     = Outlet Discount / GMV
    df["gmv"]      = df["My amount"] + df["Container Charges"]
    df["discount"] = df["Outlet Discount"]
    df["net_sale"] = df["gmv"] - df["Outlet Discount"]
    df["delivered"] = (df["Status"] == "Delivered").astype(int)
    print(f"  -> {len(df):,} rows, {df['dt'].min()} to {df['dt'].max()}")
    return df


def load_discontinued():
    """Read the project-knowledge discontinued items list. Returns a set of
    item names to exclude from briefings/highlight outputs (but kept in totals).
    Looks first in /mnt/user-data/uploads/, then in this script's dir."""
    candidates = [
        os.path.join(UPLOAD_DIR, "discontinued_items.csv"),
        os.path.join(os.path.dirname(__file__), "discontinued_items.csv"),
    ]
    for p in candidates:
        if os.path.exists(p):
            df = pd.read_csv(p)
            names = set(df["Item_Name"].dropna().astype(str).str.strip().tolist())
            print(f"Loaded {len(names)} discontinued items from {os.path.basename(p)}")
            return names
    print("No discontinued_items.csv found — proceeding with empty list.")
    return set()


def load_items():
    # Automation path: read the running enriched item history parquet if CC_ITEMS_PARQUET
    # is set. Otherwise the original manual path (newest .xlsb upload).
    src = os.environ.get("CC_ITEMS_PARQUET")
    if src:
        print(f"Loading items from {os.path.basename(src)} (history)...")
        df = pd.read_parquet(src)
    else:
        path = find_items_path()
        print(f"Loading items from {os.path.basename(path)}...")
        # The sheet name is "Order_Summary_Item_Report_<numeric_id>" — id changes per export.
        xl = pd.ExcelFile(path, engine="pyxlsb")
        sheet = next((s for s in xl.sheet_names if s.startswith("Order_Summary_Item_Report")),
                     xl.sheet_names[0])
        df = pd.read_excel(path, engine="pyxlsb", sheet_name=sheet)
    # "Actial Date" (sic) is an Excel serial in the .xlsb, an actual date in the parquet.
    if pd.api.types.is_numeric_dtype(df["Actial Date"]):
        df["dt"] = df["Actial Date"].apply(
            lambda x: (datetime(1899, 12, 30) + timedelta(days=float(x))).date()
            if pd.notna(x) else None)
    else:
        df["dt"] = pd.to_datetime(df["Actial Date"], errors="coerce").dt.date
    df = df.dropna(subset=["dt"])
    df = df[df["restaurant_name"].astype(str).str.startswith("CC-")]
    df["platform"] = df["area"].replace({"Toing by Swiggy": "Swiggy"})
    df["city"] = df["restaurant_name"].apply(outlet_to_city)
    df = df[df["status"] == "Success"]
    df = df[~df["Alias Name"].apply(is_excluded)]
    for c in ["item_price", "item_quantity", "item_total"]:
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
    df["Hour"] = pd.to_numeric(df["Hour"], errors="coerce").fillna(-1).astype(int)
    print(f"  -> {len(df):,} rows")
    return df
