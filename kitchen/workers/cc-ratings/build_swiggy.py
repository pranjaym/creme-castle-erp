#!/usr/bin/env python3
"""Creme Castle daily ratings, SWIGGY page: build payloads from the spine.

Decided with Pranjay 13 Nov 2026: Zomato and Swiggy get two separate HTML pages
in the evening ratings mail, never one blended page or one average (Zomato
ratings are partly asked for by manager calls, Swiggy shows the customer no
number, so the two measure different things). This file builds the Swiggy one
in exactly the payload shape build.py makes for Zomato, so the same
template.html renders both; META["platform"] tells the page which it is.

Sources (all landing tables from the daily Swiggy Daily-MTD file):
  swiggy_item_sales      one row per item line of a completed order: the order's
                         day, time, basket and quantities. Distinct order_id per
                         outlet-day = delivered orders.
  swiggy_cancellations   cancelled orders (never in item_sales), added to give
                         all orders.
  swiggy_item_feedback   the rating, exploded per item row. A Swiggy rating is
                         per ORDER (verified: never two stars or two comments in
                         one order), so it collapses to one row per order.
  core.mv_swiggy_outlet_codes   Swiggy restaurant_id to our outlet name, pinned
                         by order-id evidence, never by Swiggy's own name (F40).
Ratings sit on the ORDER's day (from item_sales), so a rating that arrives late
lands on the day the customer ordered, as on the Zomato page.
"""
import argparse, os, pathlib, re
from collections import defaultdict, OrderedDict
from datetime import timedelta
import psycopg2, psycopg2.extras
import build, glossary

HERE = pathlib.Path(__file__).parent

def fetch(days):
    conn = psycopg2.connect(os.environ["SPINE_DATABASE_URL"], connect_timeout=30, keepalives=1,
                            keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("select max(business_date) d from landing.swiggy_item_sales where superseded_at is null")
    end = cur.fetchone()["d"]; start = end - timedelta(days=days-1)
    cur.execute("""select business_date, restaurant_id, order_id, ordered_time, item_name,
        coalesce(nullif(item_quantity,'')::numeric,1)::int qty
      from landing.swiggy_item_sales
      where superseded_at is null and business_date between %s and %s
      order by order_id, id""", (start, end))
    sales = cur.fetchall()
    cur.execute("""select business_date, restaurant_id, count(distinct order_id) n
      from landing.swiggy_cancellations
      where superseded_at is null and business_date between %s and %s group by 1,2""", (start, end))
    cancels = cur.fetchall()
    cur.execute("""select order_id, restaurant_id, business_date, item_name,
        nullif(restaurant_rating,'')::numeric rating, coalesce(comments,'') comments
      from landing.swiggy_item_feedback
      where superseded_at is null and business_date >= %s
      order by order_id, id""", (start,))
    feedback = cur.fetchall()
    cur.execute("""select max(business_date) d from landing.swiggy_item_feedback
      where superseded_at is null""")
    last_rated = cur.fetchone()["d"]
    cur.execute("select restaurant_id, code from core.mv_swiggy_outlet_codes")
    codes = {r["restaurant_id"]: r["code"] for r in cur.fetchall()}
    cur.execute("select item_name, menu_alias, menu_category from public.item_glossary")
    items_gl = {build._norm(r["item_name"]): (r["menu_alias"] or r["item_name"], r["menu_category"])
                for r in cur.fetchall()}
    conn.close()
    return sales, cancels, feedback, last_rated, codes, items_gl, start, end

def hhmm(v):
    # ordered_time lands as text, "2026-10-20 00:00:30"; keep HH:MM
    if not v: return ""
    if hasattr(v, "strftime"): return v.strftime("%H:%M")
    m = re.search(r"(\d{1,2}):(\d{2})", str(v))
    return f"{int(m.group(1)):02d}:{m.group(2)}" if m else ""

def build_swiggy(days=45):
    sales, cancels, feedback, last_rated, codes, items_gl, start, end = fetch(days)
    missing = {}
    def alias_of(name):
        hit = items_gl.get(build._norm(name))
        if hit: return hit[0]
        missing[name] = missing.get(name, 0) + 1
        return name

    # City by outlet name from the same outlet glossary the Zomato page uses, so
    # both pages file a store under the same city chip.
    zgl, _ = glossary.load()
    city_by_name = {v["name"]: v["city"] for v in zgl.values()}
    gaps = sorted({r["restaurant_id"] for r in sales} - set(codes))
    if gaps:
        print(f"  WARNING Swiggy restaurant_id(s) with no outlet code: {', '.join(gaps)}")
    def outlet(rid): return codes.get(rid) or f"UNMAPPED-SWIGGY-{rid}"

    # one entry per completed order: day, time, outlet, basket in order with quantities
    orders = {}
    for r in sales:
        o = orders.get(r["order_id"])
        if o is None:
            o = orders[r["order_id"]] = dict(d=r["business_date"], rid=r["restaurant_id"],
                                             t=r["ordered_time"], basket=OrderedDict())
        nm = alias_of(r["item_name"])
        o["basket"][nm] = o["basket"].get(nm, 0) + (r["qty"] or 1)

    # one rating per order (first item row carries it; all rows agree)
    rating = {}
    for r in feedback:
        if r["rating"] is None or r["order_id"] in rating: continue
        rating[r["order_id"]] = r

    daily = defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0])   # all, delivered, r1..r5
    city_of = {}
    for oid, o in orders.items():
        name = outlet(o["rid"]); city_of[name] = city_by_name.get(name, "?")
        d = daily[(o["d"].isoformat(), name)]
        d[0] += 1; d[1] += 1
        fb = rating.get(oid)
        if fb:
            s = int(round(float(fb["rating"])))
            if 1 <= s <= 5: d[1 + s] += 1
    for c in cancels:
        name = outlet(c["restaurant_id"]); city_of.setdefault(name, city_by_name.get(name, "?"))
        daily[(c["business_date"].isoformat(), name)][0] += c["n"]
    DAILY = [[k[0], k[1]] + v for k, v in sorted(daily.items())]

    RATED, orphan = [], 0
    for oid, fb in rating.items():
        o = orders.get(oid)
        if o is None:          # rated order outside the window's sales (ordered before start)
            orphan += 1; continue
        s = int(round(float(fb["rating"])))
        if not 1 <= s <= 5: continue
        rev = re.sub(r"\s+", " ", re.sub(r"[$%]{2,}", " ", fb["comments"] or "")).strip() or None
        names = list(o["basket"].keys()); qty = list(o["basket"].values())
        row = {"d": o["d"].isoformat(), "t": hhmm(o["t"]),
               "o": outlet(o["rid"]), "id": oid, "r": s, "i": names, "p": "S",
               "v": rev, "th": build.theme_of(rev, None),
               "e": 1 if build.tier1_of(rev) else 0, "q": 1 if build.tier2_of(rev) else 0}
        if any(n > 1 for n in qty): row["iq"] = qty
        RATED.append(row)
    RATED.sort(key=lambda x: (x["d"], x["t"]))

    alias_cat = {}
    for key, (al, mc) in items_gl.items():
        if mc: alias_cat.setdefault(build._norm(al), mc)
    CAT = {n: (alias_cat.get(build._norm(n)) or build.category_of(n))
           for n in sorted({n for row in RATED for n in row["i"]})}
    uncat = sorted(n for n, c in CAT.items() if c == build.UNCATEGORISED)
    unglossed = sorted(missing, key=lambda n: -missing[n])
    OUTLETS = {o: city_of[o] for o in sorted(city_of)}
    meta = {"platform": "Swiggy", "days": len({d[0] for d in DAILY}), "outlets": len(OUTLETS),
            "orders": sum(d[2] for d in DAILY), "delivered": sum(d[3] for d in DAILY),
            "rated": len(RATED), "from": min(d[0] for d in DAILY), "to": max(d[0] for d in DAILY),
            "last_rated": last_rated.isoformat() if last_rated else None,
            "unmapped": gaps, "uncategorised": uncat, "unglossed": unglossed,
            "glossary_rows": len(items_gl),
            "source": "landing.swiggy_item_sales + swiggy_item_feedback + swiggy_cancellations"}
    if orphan:
        print(f"  {orphan} rated Swiggy order(s) fall before the window and are left out")
    return DAILY, RATED, CAT, OUTLETS, meta

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=45)
    ap.add_argument("--tpl", default=str(HERE/"template.html"))
    ap.add_argument("--out", default=str(HERE/"out"/"CC_Daily_Ratings_Swiggy.html"))
    a = ap.parse_args()
    pathlib.Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    D, R, C, O, M = build_swiggy(a.days)
    build.render(a.tpl, a.out, D, R, C, O, M)
    print(f"Built {a.out}")
    print(f"  {M['orders']:,} orders ({M['delivered']:,} delivered) - {M['rated']:,} rated "
          f"({M['rated']/max(M['delivered'],1)*100:.1f}% of delivered) - {M['days']} days - "
          f"{M['outlets']} outlets - newest rating {M['last_rated']}")
    print(f"  tier 1 escalations: {sum(r['e'] for r in R)}   tier 2 quality alerts: {sum(r['q'] for r in R)}")
