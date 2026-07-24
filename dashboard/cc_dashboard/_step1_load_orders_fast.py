#!/usr/bin/env python3
"""Step 1 (fast variant): load orders via python-calamine — significantly faster
than openpyxl on large xlsx files. Pickles to /tmp like the original step1."""
import sys, os, pickle, time, glob
from datetime import datetime, timedelta
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pandas as pd
from loaders import find_orders_path, load_discontinued, outlet_to_city

t0 = time.time()
path = find_orders_path()
print(f"Loading orders (calamine) from {os.path.basename(path)}...")
df = pd.read_excel(path, sheet_name=0, engine="calamine")
print(f"  raw rows: {len(df):,} in {time.time()-t0:.1f}s")

df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
df = df.dropna(subset=["Date"])
df = df[df["Outlet Name"].astype(str).str.startswith("CC-")]
df["dt"] = df["Date"].dt.date
df["platform"] = df["Order From"].replace({"Toing by Swiggy": "Swiggy"})
df["city"] = df["Outlet Name"].apply(outlet_to_city)
df["hour"] = df["Date"].dt.hour
for c in ["My amount", "Aggregator Discount", "Outlet Discount",
          "Container Charges", "Total"]:
    df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
df["gmv"]      = df["My amount"] + df["Container Charges"]
df["discount"] = df["Outlet Discount"]
df["net_sale"] = df["gmv"] - df["Outlet Discount"]
df["delivered"] = (df["Status"] == "Delivered").astype(int)
print(f"  -> {len(df):,} rows, {df['dt'].min()} to {df['dt'].max()}")
print(f"orders loaded in {time.time()-t0:.1f}s")

discontinued = load_discontinued()
with open("/tmp/cc_orders.pkl", "wb") as f:
    pickle.dump(df, f)
with open("/tmp/cc_discontinued.pkl", "wb") as f:
    pickle.dump(discontinued, f)
print(f"pickled in {time.time()-t0:.1f}s total")
