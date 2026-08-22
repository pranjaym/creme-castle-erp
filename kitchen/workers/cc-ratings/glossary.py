#!/usr/bin/env python3
"""Outlet glossary: Zomato restaurant_id -> internal Creme Castle outlet name.

At RUN TIME this reads outlets.json only. The scheduled job runs under launchd,
which cannot reliably reach iCloud Drive, so the Excel master is never touched
on a scheduled run. Refresh deliberately with --refresh when the master changes.

Identity is restaurant_id, never the Zomato subzone: Zomato relabelled 306520
from "Alpha 2" to "Gamma 2" on 25 Jul 2026 and 22521042 from "Sector 21" to
"Moti Bagh". Keying on their name splits one store's history in two.
"""
import json, pathlib, sys

HERE = pathlib.Path(__file__).parent
LOCAL = HERE/"outlets.json"
MASTER = (pathlib.Path.home()/"Library"/"Mobile Documents"/"com~apple~CloudDocs"/
          "Downloads Drive"/"erp-plan"/"Outlet Master.xlsx")

# Pranjay's corrections, 20 Aug 2026. These WIN over the master file.
# 22521042: master says CC-GGN-Udyog Vihar (Gurgaon); the feed places it in Moti
# Bagh, Delhi NCR. The master is stale and needs fixing at source.
OVERRIDES = {
    "22871646": dict(name="CC-PB-Ludhiana",     city="Ludhiana"),
    "22521042": dict(name="CC-DL-South Campus", city="Delhi"),
}

def refresh():
    import pandas as pd
    m = pd.read_excel(MASTER, "Sheet1")
    m = m[m["Zomato RID"].notna()].copy()
    m["rid"] = m["Zomato RID"].astype("int64").astype(str)
    g = {r.rid: dict(name=str(getattr(r, "_3")).strip(), city=str(r.City).strip(),
                     type=str(r.Type).strip(), mapped=True) for r in m.itertuples()}
    for rid, o in OVERRIDES.items():
        g[rid] = dict(name=o["name"], city=o["city"],
                      type=g.get(rid, {}).get("type", "Dark Store"), mapped=True)
    LOCAL.write_text(json.dumps({"_note": "Frozen from Outlet Master.xlsx. Refresh with --refresh.",
                                 "outlets": g}, indent=1, ensure_ascii=False))
    return g

def load(feed_ids=None):
    g = json.loads(LOCAL.read_text())["outlets"]
    gaps = []
    if feed_ids:
        for rid in sorted(feed_ids):
            if rid not in g:
                g[rid] = dict(name=f"UNMAPPED-{rid}", city="?", type="?", mapped=False)
                gaps.append(rid)
    return g, gaps

if __name__ == "__main__":
    if "--refresh" in sys.argv:
        print(f"refreshed {len(refresh())} outlets from {MASTER.name}")
    else:
        g, _ = load(); print(f"{len(g)} outlets in {LOCAL.name}")
