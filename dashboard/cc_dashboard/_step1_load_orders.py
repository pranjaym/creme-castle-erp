#!/usr/bin/env python3
"""Step 1: load orders + discontinued, pickle to /tmp."""
import sys, os, pickle, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from loaders import load_orders, load_discontinued

t0 = time.time()
orders = load_orders()
print(f"orders loaded in {time.time()-t0:.1f}s")
discontinued = load_discontinued()
with open("/tmp/cc_orders.pkl", "wb") as f:
    pickle.dump(orders, f)
with open("/tmp/cc_discontinued.pkl", "wb") as f:
    pickle.dump(discontinued, f)
print(f"pickled in {time.time()-t0:.1f}s total")
