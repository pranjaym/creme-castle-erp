#!/usr/bin/env python3
"""Creme Castle daily ratings: build payloads from the spine.

Changes from the v2 prototype:
  - Outlet identity is restaurant_id, displayed as the INTERNAL name (glossary.py).
  - Escalation is two tiers. Tier 1 (act today) is foreign object / illness /
    expiry / allergen only, about 1 every 3 days. Tier 2 (quality alert) is
    spoilage and staleness, which used to swamp tier 1 at ~1/day.
  - DAILY carries orders_all AND orders_delivered so the headline order count
    ties to other reports while rated % is computed on orders that could be rated.
  - Reads the spine directly, no CSV hop.
"""
import argparse, json, os, pathlib, re
from collections import defaultdict
from datetime import date, timedelta
import psycopg2, psycopg2.extras
import glossary

HERE = pathlib.Path(__file__).parent
ENV = pathlib.Path.home()/"creme-castle-erp"/"dashboard"/"auto"/".env"
for _l in ENV.read_text().splitlines():
    if _l.strip() and not _l.startswith("#") and "=" in _l:
        _k, _v = _l.split("=", 1)
        os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))

# ---------------------------------------------------------------- categories
# Categories come from categories.json next to this file (decided with Pranjay,
# 6 Nov 2026): an ordered category list, exact-name overrides, then keyword rules
# applied top to bottom. They are FORMAT categories for reading ratings, finer than
# the spine item_glossary's product categories. Anything no rule catches returns
# "Uncategorised" and is listed at the foot of the mail, never guessed (Pranjay's
# decision of 28 Aug 2026, when a Rs 99 Evil Eye Rakhi was being counted as a dessert).
import unicodedata
UNCATEGORISED = "Uncategorised"
_CATS = json.loads((HERE/"categories.json").read_text(encoding="utf-8"))
CATEGORY_ORDER = _CATS["categories"]
def _norm(name):
    s = unicodedata.normalize("NFKC", str(name or "")).replace("\u2019", "'").replace("\u2018", "'")
    s = re.sub(r"[^\x20-\x7e]", " ", s)
    return re.sub(r"\s+", " ", s).strip().lower()
_OVERRIDES = {_norm(k): v for k, v in _CATS["overrides"].items()}
_RULES = [(r["category"], re.compile(r["match"], re.I),
           re.compile(r["and"], re.I) if r.get("and") else None) for r in _CATS["rules"]]
for _c in [v for v in _OVERRIDES.values()] + [r[0] for r in _RULES]:
    assert _c in CATEGORY_ORDER, f"categories.json names an unknown category: {_c}"
def category_of(name):
    n = _norm(name)
    if n in _OVERRIDES: return _OVERRIDES[n]
    for cat, rx, rx2 in _RULES:
        if rx.search(n) and (rx2 is None or rx2.search(n)): return cat
    return UNCATEGORISED

# ---------------------------------------------------------------- themes
# TIER 1 only: a physical contaminant, an illness, or a labelling/compliance
# failure. Smell and spoilage are deliberately NOT here; they are freshness.
TIER1 = [
    r"\bhair\b", r"\binsect", r"\bworm", r"\bfungus", r"\bmoul?d\b", r"\bcockroach",
    r"\bfly\b", r"\bkidda", r"\bkeeda", r"\bplastic\b", r"\bglass\b", r"\bstapler",
    r"\bstone\b", r"\bexpir", r"\ballerg", r"\bsugar[- ]?free\b",
    r"\bfood pois", r"\bvomit", r"\bdiarr", r"\bfell ill\b", r"\bstomach\b",
    r"\btummy\b", r"someone has eaten", r"\bglove",
]
THEMES = [
    ("Hygiene / foreign object", TIER1),
    ("Wrong / missing item", [
        r"\bwrong\b", r"\bmissing\b", r"\bnot receiv", r"\bdidn'?t (get|receive)",
        r"\bdifferent (item|cake|product|flavou?r)", r"\bnot deliver", r"\bincomplete\b",
        r"\bhalf (the|of)", r"\bempty\b"]),
    ("Packaging / handling", [
        r"\bpack", r"\bspill", r"\bbroken\b", r"\bbreak", r"\bcrush", r"\bdamag",
        r"\bleak", r"\bbox\b", r"\bsmash", r"\btilt", r"\bupside", r"\bmess", r"\breused"]),
    ("Freshness / staleness", [
        r"\bstale\b", r"\bsour\b", r"\bold\b", r"\bdry\b", r"\bhard\b", r"\bsoggy\b",
        r"\brefrigerat", r"\bfrozen\b", r"\bnot fresh", r"\bday old", r"\bmelt",
        r"\bsmell", r"\bstink", r"\bspoil", r"\brotten\b", r"\bfoul\b", r"\bcurd"]),
    ("Looks unlike the picture", [
        r"\bpicture\b", r"\bphoto\b", r"\bimage\b", r"\bshown\b", r"\bnot the same\b",
        r"\bdoesn'?t look", r"\blook(s|ed)? (like|different|nothing)", r"\bpresentation\b",
        r"\bdesign\b", r"\bmisshap"]),
    ("Portion / value", [
        r"\bsmall\b", r"\bsize\b", r"\bquantity\b", r"\bexpensive\b", r"\bprice\b",
        r"\boverprice", r"\bworth\b", r"\bwaste of money", r"\btiny\b", r"\bless\b"]),
    ("Delivery / service", [
        r"\blate\b", r"\bdelay", r"\brider\b", r"\bdelivery boy", r"\bcold\b",
        r"\brude\b", r"\bbehaviou?r", r"\brefund", r"\bcustomer (care|service)"]),
    ("Taste / quality", [
        r"\btaste", r"\bflavou?r", r"\bbland\b", r"\bsweet\b", r"\bsugar", r"\bquality\b",
        r"\bhorrible\b", r"\bawful\b", r"\bdisgust", r"\bworst\b", r"\bcream", r"\bbad\b"]),
]
UNLABELLED = "Rating only, no reason given"
THEME_ORDER = [t[0] for t in THEMES] + [UNLABELLED]
TAG_TO_THEME = {
    "Poor packaging or spillage": "Packaging / handling",
    "Wrong item(s) delivered": "Wrong / missing item",
    "Item(s) missing or not delivered": "Wrong / missing item",
    "Poor taste or quality": "Taste / quality",
}
_c = [(n, [re.compile(p, re.I) for p in ps]) for n, ps in THEMES]
_t1 = [re.compile(p, re.I) for p in TIER1]
_t2 = [re.compile(p, re.I) for p in
       (r"\bstale\b", r"\bsour\b", r"\bspoil", r"\brotten\b", r"\bsmell", r"\bfoul\b", r"\bcurd", r"\bnot fresh")]

def theme_of(review, tag):
    if review:
        for name, pats in _c:
            if any(p.search(review) for p in pats):
                return name
    return TAG_TO_THEME.get(tag, UNLABELLED)
def tier1_of(rev): return bool(rev) and any(p.search(rev) for p in _t1)
def tier2_of(rev): return bool(rev) and not tier1_of(rev) and any(p.search(rev) for p in _t2)

ITEM_RE = re.compile(r"^\s*(\d+)\s*[xX]\s*(.+?)\s*$")
def parse_items(s):
    out = []
    for part in str(s or "").split(","):
        part = part.strip()
        if not part: continue
        m = ITEM_RE.match(part)
        out.append(m.group(2).strip() if m else part)
    return out
def parse_qty(s):
    # quantities in the same order as parse_items, for the order lines under + on
    # the Item Ratings table ("2 x Chocochip Cookie" shows as 2x)
    out = []
    for part in str(s or "").split(","):
        part = part.strip()
        if not part: continue
        m = ITEM_RE.match(part)
        out.append(int(m.group(1)) if m else 1)
    return out

def fetch(days):
    conn = psycopg2.connect(os.environ["SPINE_DATABASE_URL"], connect_timeout=30, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("select max(order_date) d from landing.zomato_order_details where superseded_at is null")
    end = cur.fetchone()["d"]; start = end - timedelta(days=days-1)
    cur.execute("""select order_date, restaurant_id, zomato_order_id, order_placed_at,
      nullif(rating,'')::numeric rating, coalesce(review,'') review,
      coalesce(customer_complaint_tag,'') tag, items_in_order, order_status
      from landing.zomato_order_details
      where superseded_at is null and order_date between %s and %s""", (start, end))
    rows = cur.fetchall()
    # The shared item glossary (public.item_glossary, edited on the portal at
    # /glossary/items). From 6 Nov 2026 the mail ties every Zomato item name to its
    # menu_alias (two spellings, one product) and menu_category, the same table the
    # sales dashboard reads. A name with no row keeps its raw spelling and is listed at
    # the foot of the mail; its category then comes from categories.json, never guessed.
    cur.execute("select item_name, menu_alias, menu_category from public.item_glossary")
    items_gl = {_norm(r["item_name"]): (r["menu_alias"] or r["item_name"], r["menu_category"]) for r in cur.fetchall()}
    conn.close()
    return rows, start, end, items_gl

def build(days=45):
    rows, start, end, items_gl = fetch(days)
    missing = {}
    def alias_of(name):
        hit = items_gl.get(_norm(name))
        if hit: return hit[0]
        missing[name] = missing.get(name, 0) + 1
        return name
    gl, gaps = glossary.load({r["restaurant_id"] for r in rows})
    if gaps:
        print(f"  WARNING unmapped restaurant_id(s): {', '.join(gaps)}")
    DELIVERED = {"Delivered", "Picked up"}

    daily = defaultdict(lambda: [0, 0, 0, 0, 0, 0, 0])   # all, delivered, r1..r5
    city_of = {}
    for r in rows:
        g = gl[r["restaurant_id"]]; o = g["name"]; city_of[o] = g["city"]
        d = daily[(r["order_date"].isoformat(), o)]
        d[0] += 1
        if r["order_status"] in DELIVERED:
            d[1] += 1
            if r["rating"] is not None:
                s = int(round(float(r["rating"])))
                if 1 <= s <= 5: d[1 + s] += 1
    DAILY = [[k[0], k[1]] + v for k, v in sorted(daily.items())]

    RATED = []
    for r in rows:
        if r["rating"] is None or r["order_status"] not in DELIVERED: continue
        rev = re.sub(r"\s+", " ", re.sub(r"[$%]{2,}", " ", r["review"] or "")).strip() or None
        tag = (r["tag"] or "").strip() or None
        RATED.append({"d": r["order_date"].isoformat(),
                      "t": r["order_placed_at"].strftime("%H:%M") if r["order_placed_at"] else "",
                      "o": gl[r["restaurant_id"]]["name"], "id": r["zomato_order_id"],
                      "r": int(round(float(r["rating"]))), "i": [alias_of(n) for n in parse_items(r["items_in_order"])],
                      "v": rev, "th": theme_of(rev, tag),
                      "e": 1 if tier1_of(rev) else 0, "q": 1 if tier2_of(rev) else 0})
        q = parse_qty(r["items_in_order"])
        if any(n > 1 for n in q): RATED[-1]["iq"] = q   # only when a line has 2 or more
    RATED.sort(key=lambda x: (x["d"], x["t"]))
    # Category of an alias: the glossary's menu_category where the alias has one,
    # else the rules in categories.json (a new name with no glossary row yet).
    alias_cat = {}
    for key, (al, mc) in items_gl.items():
        if mc: alias_cat.setdefault(_norm(al), mc)
    CAT = {n: (alias_cat.get(_norm(n)) or category_of(n)) for n in sorted({n for row in RATED for n in row["i"]})}
    uncat = sorted(n for n, c in CAT.items() if c == UNCATEGORISED)
    if uncat:
        print(f"  {len(uncat)} item name(s) could not be categorised (listed in the mail): "
              + ", ".join(uncat[:8]) + (" ..." if len(uncat) > 8 else ""))
    unglossed = sorted(missing, key=lambda n: -missing[n])
    if unglossed:
        print(f"  {len(unglossed)} rated item name(s) have no glossary row (listed in the mail): "
              + ", ".join(unglossed[:8]) + (" ..." if len(unglossed) > 8 else ""))
    OUTLETS = {o: city_of[o] for o in sorted(city_of)}
    meta = {"platform": "Zomato", "days": len({d[0] for d in DAILY}), "outlets": len(OUTLETS),
            "orders": sum(d[2] for d in DAILY), "delivered": sum(d[3] for d in DAILY),
            "rated": len(RATED), "from": min(d[0] for d in DAILY), "to": max(d[0] for d in DAILY),
            "unmapped": gaps, "uncategorised": uncat, "unglossed": unglossed,
            "glossary_rows": len(items_gl), "source": "landing.zomato_order_details"}
    meta["last_rated"] = max((r["d"] for r in RATED), default=None)
    return DAILY, RATED, CAT, OUTLETS, meta

def render(tpl, out, DAILY, RATED, CAT, OUTLETS, meta):
    j = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    html = (pathlib.Path(tpl).read_text()
            .replace("__DAILY__", j(DAILY)).replace("__RATED__", j(RATED))
            .replace("__CAT__", j(CAT)).replace("__OUTLETS__", j(OUTLETS))
            .replace("__THEMES__", j(THEME_ORDER)).replace("__META__", j(meta)))
    pathlib.Path(out).write_text(html, encoding="utf-8")
    return out

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=45)
    ap.add_argument("--tpl", default=str(HERE/"template.html"))
    ap.add_argument("--out", default=str(HERE/"out"/"CC_Daily_Ratings.html"))
    a = ap.parse_args()
    pathlib.Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    D, R, C, O, M = build(a.days)
    render(a.tpl, a.out, D, R, C, O, M)
    print(f"Built {a.out}")
    print(f"  {M['orders']:,} orders ({M['delivered']:,} delivered) - {M['rated']:,} rated "
          f"({M['rated']/M['delivered']*100:.1f}% of delivered) - {M['days']} days - {M['outlets']} outlets")
    print(f"  tier 1 escalations: {sum(r['e'] for r in R)}   tier 2 quality alerts: {sum(r['q'] for r in R)}")
