#!/usr/bin/env python3
"""Step 2: load items, pickle to /tmp."""
import sys, os, pickle, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from loaders import load_items

t0 = time.time()
items = load_items()
print(f"items loaded in {time.time()-t0:.1f}s")
with open("/tmp/cc_items.pkl", "wb") as f:
    pickle.dump(items, f)
print(f"pickled in {time.time()-t0:.1f}s total")
