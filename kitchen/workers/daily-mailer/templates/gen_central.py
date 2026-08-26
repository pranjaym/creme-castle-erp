#!/usr/bin/env python3
"""Build the central (network) dashboard template v1 for approval.

Same locked design rules as the store v3 and area v2 templates:
labelled day block then labelled 7-day block, every number listing the
orders/stores behind it, charts with real axes, verdicts with goals,
compact single-line rows, complaint filters built from ORDER tags.
"""
import html, json, os
from datetime import date, datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
D = json.load(open(os.path.join(HERE, "central_15aug.json")))
A = json.load(open(os.path.join(HERE, "all_15aug.json")))
CSS = open(os.path.join(HERE, "area.css")).read()
CSS += """
.chip{display:inline-block;font-size:12px;font-weight:600;border-radius:999px;padding:1px 9px;margin-top:4px}
.chip.okc{color:var(--ok-fg);background:var(--ok-bg)}
.chip.watch{color:var(--warn-fg);background:var(--warn-bg)}
.chartgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px}
.lead{font-size:13px;color:var(--muted);margin-bottom:6px;max-width:820px}
.wrap{max-width:1060px}
.context{grid-template-columns:repeat(auto-fit,minmax(215px,1fr))}
.tile .delta{min-height:2.4em}
"""

DATE = D["date"]
DT = datetime.strptime(DATE, "%Y-%m-%d").date()
DSHORT = DT.strftime("%-d %b")
DLONG = DT.strftime("%A, %-d %B %Y")
WSTART = datetime.strptime(D["week_start"], "%Y-%m-%d").date()
WKLABEL = "Last 7 days (%s to %s)" % (WSTART.strftime("%-d %b"), DSHORT)

e = html.escape
def inr(v):
    return "-" if v is None else "&#8377;" + format(int(round(v)), ",d").replace(",", ",")
def inr_in(v):
    """Indian grouping."""
    if v is None: return "-"
    n = int(round(v)); s = str(abs(n)); 
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:]); head = head[:-2]
        if head: parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if n < 0 else "") + "&#8377;" + s
def lakh(v):
    return "-" if v is None else "&#8377;%.2fL" % (v / 100000.0)
def n0(v):
    if v is None: return "-"
    n = int(round(v)); s = str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:]); head = head[:-2]
        if head: parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if n < 0 else "") + s
def n1(v):
    return "-" if v is None else "%.1f" % v
def n2(v):
    return "-" if v is None else "%.2f" % v
def basket(t, n=52):
    t = t or "-"
    if len(t) <= n: return e(t)
    return '<span title="%s">%s&hellip;</span>' % (e(t), e(t[:n-1]))
def flag(txt, bad):
    return '<span class="flag">%s</span>' % txt if bad else txt
def good(txt):
    return '<span class="goodv">%s</span>' % txt
def chip(ok, text):
    return '<span class="chip %s">%s %s</span>' % ("okc" if ok else "watch",
                                                   "&#10003;" if ok else "&#9650;", text)
def tag(reason):
    r = (reason or "").lower()
    cls = ("packing" if ("packag" in r or "spill" in r) else
           "taste" if ("taste" in r or "quality" in r) else
           "missing" if "missing" in r else
           "wrong" if "wrong" in r else
           "stock" if "stock" in r else "other")
    return '<span class="rchip r-%s">%s</span>' % (cls, e(reason or ""))

# ---------- chart with real axes (same geometry as the area template) ----------
def chart(series, labels, title, unit="", lo=None, hi=None, w=430, h=124, tips=None, dec=1):
    vals = [v for v in series if v is not None]
    if not vals: return '<p class="note">No data for these days.</p>'
    LO = lo if lo is not None else min(vals)
    HI = hi if hi is not None else max(vals)
    if HI == LO: HI = LO + 1
    L, R, T, B = 52, 14, 10, 22
    n = len(series)
    X = lambda i: L + i * (w - L - R) / max(n - 1, 1)
    Y = lambda v: T + (HI - v) * (h - T - B) / (HI - LO)
    def fmt(v):
        return ("%d" % round(v) if abs(HI - LO) >= 5 else ("%." + str(dec) + "f") % v) + unit
    out = ['<div class="chart"><div class="charttitle">%s</div>' % e(title),
           '<svg width="%d" height="%d" viewBox="0 0 %d %d" role="img" aria-label="%s">' % (w, h, w, h, e(title))]
    for tv in (LO, (LO + HI) / 2.0, HI):
        out.append('<line x1="%d" y1="%.1f" x2="%d" y2="%.1f" stroke="#EDE3E5"/>' % (L, Y(tv), w - R, Y(tv)))
        out.append('<text x="%d" y="%.1f" font-size="10" fill="#7E6B6E" text-anchor="end">%s</text>'
                   % (L - 5, Y(tv) + 3.5, fmt(tv)))
    for i, la in enumerate(labels):
        anch = "start" if i == 0 else ("end" if i == n - 1 else "middle")
        out.append('<text x="%.1f" y="%d" font-size="10" fill="#7E6B6E" text-anchor="%s">%s</text>'
                   % (X(i), h - 6, anch, e(la)))
    pts = " ".join("%.1f,%.1f" % (X(i), Y(v)) for i, v in enumerate(series) if v is not None)
    out.append('<polyline points="%s" fill="none" stroke="#DB5436" stroke-width="2" stroke-linejoin="round"/>' % pts)
    for i, v in enumerate(series):
        if v is None: continue
        tp = (tips or labels)[i]
        out.append('<circle cx="%.1f" cy="%.1f" r="2.8" fill="#DB5436"><title>%s: %s</title></circle>'
                   % (X(i), Y(v), e(tp), fmt(v)))
    out.append('</svg></div>')
    return "".join(out)

def sec(num, title, body, lead=None):
    return ('<section><div class="sec-head"><span class="num">%s</span><h2>%s</h2></div>%s<div class="card">%s</div></section>'
            % (num, title, ('<p class="lead">%s</p>' % lead) if lead else "", body))
def pblock(label, inner):
    return '<div class="pblock"><div class="ptitle">%s</div>%s</div>' % (label, inner)
def table(cols, rows, empty="Nothing to list.", tid=None, cls=""):
    if not rows: return '<p class="note">%s</p>' % empty
    th = "".join("<th>%s</th>" % c for c in cols)
    body = []
    for r in rows:
        attrs = ""
        if isinstance(r, tuple):
            r, attrs = r
        body.append("<tr%s>%s</tr>" % (attrs, "".join("<td>%s</td>" % c for c in r)))
    return ('<div class="scroll-x"><table%s%s><thead><tr>%s</tr></thead><tbody>%s</tbody></table></div>'
            % (' id="%s"' % tid if tid else "", ' class="%s"' % cls if cls else "", th, "".join(body)))
def fold(label, count, inner, open_=False):
    if not count: return '<p class="note">None.</p>'
    return ('<details class="fold"%s><summary>%s (%d) &rsaquo; tap to open</summary>%s</details>'
            % (" open" if open_ else "", label, count, inner))
def note(t):
    return '<p class="note">%s</p>' % t

# ---------- derived numbers ----------
stores = A["stores"]
lev = A["levers"]; segd, segw = lev["seg_day"], lev["seg_wk"]
adsd, adsw = lev["ads_day"], lev["ads_wk"]
reasons = A["reasons_wk"]

def score(s):
    d = s["day"]
    if d["cpct"] is None and d["rpct"] is None and d["online"] is None: return None
    return (d["cpct"] or 0) + (d["rpct"] or 0) + (100 - (d["online"] or 100))
for s in stores:
    s["score"] = score(s)
    w = s["wk"]
    s["wscore"] = ((100.0 * (w["comps"] or 0) / w["orders"] + 100.0 * (w["rej"] or 0) / w["orders"]
                    + (100 - (w["online"] or 100))) if w["orders"] else None)
ranked = sorted([s for s in stores if s["score"] is not None],
                key=lambda s: (s["score"], -(s["day"]["rating"] or 0), -(s["day"]["orders"] or 0)))
for i, s in enumerate(ranked): s["rank"] = i + 1
wranked = sorted([s for s in stores if s["wscore"] is not None],
                 key=lambda s: (s["wscore"], -(s["wk"]["rating"] or 0), -(s["wk"]["orders"] or 0)))
for i, s in enumerate(wranked): s["wrank"] = i + 1
by_code = {s["code"]: s for s in stores}

def ssum(f, xs=None):
    return sum((f(s) or 0) for s in (xs if xs is not None else stores))

orders_day = ssum(lambda s: s["day"]["orders"]); orders_wk = ssum(lambda s: s["wk"]["orders"])
comps_day = ssum(lambda s: s["day"]["comps"]); comps_wk = ssum(lambda s: s["wk"]["comps"])
srej_day = ssum(lambda s: s["day"]["srej"]); srej_wk = ssum(lambda s: s["wk"]["srej"])
fr_wk = ssum(lambda s: s["wk"]["fr"])
money_by_store = {m["code"]: m for m in D["money_stores"]}
money_wk = sum(m["total_wk"] for m in D["money_stores"])
cpct_day = 100.0 * comps_day / orders_day if orders_day else None
cpct_wk = 100.0 * comps_wk / orders_wk if orders_wk else None

# areas
areas = {}
for s in stores:
    areas.setdefault(s["am"] or "Unassigned", []).append(s)
arows = []
for am, xs in areas.items():
    do = ssum(lambda s: s["day"]["orders"], xs); dc = ssum(lambda s: s["day"]["comps"], xs)
    wo = ssum(lambda s: s["wk"]["orders"], xs); wc = ssum(lambda s: s["wk"]["comps"], xs)
    arows.append(dict(am=am, stores=len(xs),
        d_orders=do, d_comps=dc, d_cpct=(100.0*dc/do if do else None),
        d_srej=ssum(lambda s: s["day"]["srej"], xs), d_off=ssum(lambda s: s["day"]["offmin"], xs),
        d_rating=(sum((s["day"]["rating"] or 0) for s in xs if s["day"]["rating"]) /
                  max(len([s for s in xs if s["day"]["rating"]]), 1)) or None,
        w_orders=wo, w_comps=wc, w_cpct=(100.0*wc/wo if wo else None),
        w_srej=ssum(lambda s: s["wk"]["srej"], xs), w_off=ssum(lambda s: s["wk"]["offmin"], xs),
        w_fr=ssum(lambda s: s["wk"]["fr"], xs),
        w_money=sum(money_by_store.get(s["code"], {}).get("total_wk", 0) for s in xs),
        w_wait=(sum((s["wk"]["wait"] or 0) for s in xs if s["wk"]["wait"]) /
                max(len([s for s in xs if s["wk"]["wait"]]), 1)) or None))

today = lambda r: r.get("today") is True
earlier = lambda r: r.get("today") is not True
rejT = [r for r in D["rejections"] if today(r)]; rejW = [r for r in D["rejections"] if earlier(r)]
compT = [r for r in D["complaints"] if today(r)]; compW = [r for r in D["complaints"] if earlier(r)]
lowT = [r for r in D["low_ratings"] if today(r)]; lowW = [r for r in D["low_ratings"] if earlier(r)]
COMPW_CAP = 120
compW_shown = compW[:COMPW_CAP]
LOWW_CAP = 100
lowW_shown = lowW[:LOWW_CAP]

trend = D["trend"]
tl = [datetime.strptime(t["d"], "%Y-%m-%d").date() for t in trend]
labels = [d.strftime("%d") for d in tl]
tips = [d.strftime("%a %-d %b") for d in tl]

H = []
add = H.append

inr = inr_in
avg_day_orders = round(orders_wk / 7.0)
wait_day = trend[-1]["wait"]; wait_wk_vals = [t["wait"] for t in trend if t["wait"] is not None]
wait_wk = sum(wait_wk_vals) / len(wait_wk_vals) if wait_wk_vals else None
waits3_wk = ssum(lambda s: s["wk"]["waits3"]); delivered_wk = ssum(lambda s: s["wk"]["delivered"])
pct3 = 100.0 * waits3_wk / delivered_wk if delivered_wk else None
online_day = trend[-1]["online"]; offmin_day = ssum(lambda s: s["day"]["offmin"])

add('<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1">'
    '<title>Network Daily v1: all stores</title><style>%s</style></head><body><div class="wrap">' % CSS)
add('<div class="brand">Creme Castle &middot; Network Daily &middot; Zomato &middot; TEMPLATE v1 FOR APPROVAL</div>')
add('<h1>The whole network</h1>')
add('<div class="sub"><b>%s</b> &nbsp;&middot;&nbsp; %d stores, %d areas</div>' % (DLONG, len(stores), len(arows)))
add('<div class="revision-note">Settled data only (2 days behind by design). Central&rsquo;s question is not '
    '&ldquo;what happened here&rdquo; but &ldquo;where do I put pressure, and which lever do I pull&rdquo;, so every '
    'number below names its outlet AND its area manager, and every lever lists the stores behind it.</div>')

# ---- context tiles, each with a verdict ----
tiles = [
    ("Orders", n0(orders_day), "%s a day across the week" % n0(avg_day_orders),
     chip(orders_day >= avg_day_orders,
          "%+d%% on the week&rsquo;s daily average"
          % round(100.0 * (orders_day - avg_day_orders) / avg_day_orders))),
    ("Net sales", lakh(segd["net_sales"]), "subtotal %s" % lakh(segd["subtotal"]),
     chip(segd["net_sales"] >= segw["net_sales"] / 7.0,
          "%+d%% on the week&rsquo;s daily average"
          % round(100.0 * (segd["net_sales"] - segw["net_sales"] / 7.0) / (segw["net_sales"] / 7.0)))),
    ("Complaints (Zomato's count)", "%s <small>(%s%%)</small>" % (n0(comps_day), n2(cpct_day)),
     "%s order rows carry a complaint flag: section 6" % n0(len(compT)),
     chip(cpct_day <= cpct_wk, "against %s%% for the week" % n2(cpct_wk))),
    ("Store rejections (Zomato's count)", n0(srej_day), "%s order rows name a store reason: section 5" % n0(len(rejT)),
     chip(srej_day == 0, "%s in the week, goal is zero" % n0(srej_wk))),
    ("Rider wait", "%s min" % n1(wait_day), "%s min across the week" % n1(wait_wk),
     chip((wait_day or 9) < 1.5, "goal is under 1.5 min")),
    ("Online", "%s%%" % n2(online_day), "%s min offline network-wide" % n0(offmin_day),
     chip(offmin_day == 0, "goal is 100%: offline is a closed shop")),
    ("Money lost, week", inr(money_wk), "stockouts + refunds",
     chip(money_wk == 0, "goal is zero: every rupee ties to an order")),
    ("False ready, week", n0(fr_wk), "%s%% of delivered orders" % n1(100.0 * fr_wk / delivered_wk if delivered_wk else 0),
     chip(fr_wk == 0, "goal is zero, the button means food is out")),
]
add('<div class="context">')
for label, val, delta, ch in tiles:
    add('<div class="tile"><div class="label">%s</div><div class="value">%s</div>'
        '<div class="delta">%s</div>%s</div>' % (label, val, delta, ch))
add('</div>')

# ---- attention ----
att = []
dip = D["online_dips"][0] if D["online_dips"] else None
if dip:
    att.append('<b>%s (%s&rsquo;s area) lost %s minutes of trading</b>: online %s%% on %s. '
               'Section 4 shows its week; this is the single largest controllable loss on the page.'
               % (e(dip["code"]), e(dip["am"]), n0(dip["offmin_day"]), n2(dip["online_day"]), DSHORT))
hot = sorted([s for s in stores if (s["day"]["comps"] or 0) >= 3],
             key=lambda s: -(s["day"]["cpct"] or 0))
if hot:
    s = hot[0]
    att.append('<b>%s (%s&rsquo;s area) is the day&rsquo;s complaint hotspot</b>: %s complaints on %s orders '
               '(%s%%, against %s%% for the network). Section 6 lists every one of them.'
               % (e(s["code"]), e(s["am"]), n0(s["day"]["comps"]), n0(s["day"]["orders"]),
                  n1(s["day"]["cpct"]), n2(cpct_day)))
worst_area = sorted(arows, key=lambda a: -(a["d_cpct"] or 0))[0]
att.append('<b>%s&rsquo;s area has the day&rsquo;s worst complaint rate</b> (%s%% on %s orders across %d stores) '
           'and %s&rsquo;s the best (%s%%). Section 2 puts the five side by side.'
           % (e(worst_area["am"]), n2(worst_area["d_cpct"]), n0(worst_area["d_orders"]), worst_area["stores"],
              e(sorted(arows, key=lambda a: (a["d_cpct"] if a["d_cpct"] is not None else 99))[0]["am"]),
              n2(sorted(arows, key=lambda a: (a["d_cpct"] if a["d_cpct"] is not None else 99))[0]["d_cpct"])))
frs = D["fr_stores"]
if frs:
    f = frs[0]
    att.append('<b>&ldquo;Ready&rdquo; is being pressed before the food exists</b>: %s orders network-wide this week, '
               'worst is %s (%s&rsquo;s area) with %s, %s%% of everything it delivered. Section 9 names them.'
               % (n0(fr_wk), e(f["code"]), e(f["am"]), n0(f["fr_wk"]), n1(f["pct"])))
ms = D["money_stores"]
if ms:
    m = ms[0]
    att.append('<b>%s of trade was lost to rejections and refunds this week</b>; the largest single loser is %s '
               '(%s&rsquo;s area) at %s. Section 10 splits it per store.'
               % (inr(money_wk), e(m["code"]), e(m["am"]), inr(m["total_wk"])))
best = ranked[0]
att.append('<b>Good news to pass on:</b> %s (%s&rsquo;s area) is the best-run store of the day: %s orders, '
           '%s complaints, %s%% online.'
           % (e(best["code"]), e(best["am"]), n0(best["day"]["orders"]), n0(best["day"]["comps"]),
              n2(best["day"]["online"])))
add('<div class="actions"><h2>What deserves central attention</h2><ol>%s</ol></div>'
    % "".join("<li>%s</li>" % a for a in att[:6]))

# ---- 1. the network's own week ----
charts = "".join([
    chart([t["orders"] for t in trend], labels, "Orders per day", "", tips=tips, dec=0),
    chart([t["cpct"] for t in trend], labels, "Complaints as a % of orders", "%", tips=tips, dec=2),
    chart([t["online"] for t in trend], labels, "Online %% (average of the %d stores)" % len(stores), "%",
          lo=min(97, min(t["online"] for t in trend)) - 0.2, hi=100, tips=tips, dec=1),
    chart([t["wait"] for t in trend], labels, "Rider wait, minutes (order data starts 12 Aug)", "",
          lo=0, tips=tips, dec=1),
    chart([t["rating"] for t in trend], labels, "Average food rating", "", tips=tips, dec=2),
    chart([t["discount_pct"] for t in trend], labels, "Discount as a % of subtotal", "%", tips=tips, dec=1),
])
add(sec("1", "The network&rsquo;s own 7 days",
        pblock(WKLABEL, '<div class="chartgrid">%s</div>' % charts
               + note("Day of the month along the bottom, the full date on hover. Rider wait is blank before "
                      "12 Aug because the order-level feed does not reach further back; nothing is estimated. "
                      "Ratings and complaints for the newest days still rise for a few days after the fact.")),
        lead="Six lines, one idea each. This is the only place on the page where the network is a single number: "
             "everything below it names stores."))

# ---- 2. area versus area ----
acols = ["#", "Area manager", "Stores", "Orders", "Complaints", "Complaints %", "Rejections", "Offline", "Rating"]
ad_rows = []
for i, a in enumerate(sorted(arows, key=lambda a: (a["d_cpct"] if a["d_cpct"] is not None else 99))):
    ad_rows.append([i + 1, e(a["am"]), a["stores"], n0(a["d_orders"]), n0(a["d_comps"]),
                    flag(n2(a["d_cpct"]), (a["d_cpct"] or 0) > cpct_day),
                    flag(n0(a["d_srej"]), a["d_srej"] > 0),
                    flag("%s min" % n0(a["d_off"]), a["d_off"] > 0), n1(a["d_rating"])])
aw_cols = ["#", "Area manager", "Stores", "Orders", "Complaints %", "Rejections", "Offline",
           "Rider wait", "False ready", "Money lost"]
aw_rows = []
for i, a in enumerate(sorted(arows, key=lambda a: (a["w_cpct"] if a["w_cpct"] is not None else 99))):
    aw_rows.append([i + 1, e(a["am"]), a["stores"], n0(a["w_orders"]),
                    flag(n2(a["w_cpct"]), (a["w_cpct"] or 0) > cpct_wk),
                    flag(n0(a["w_srej"]), a["w_srej"] > 0),
                    "%s min" % n0(a["w_off"]),
                    flag(n1(a["w_wait"]), (a["w_wait"] or 0) >= 1.5),
                    flag(n0(a["w_fr"]), a["w_fr"] > 0), inr(a["w_money"])])
add(sec("2", "Area versus area",
        pblock(DSHORT, table(acols, ad_rows) + note("Ranked by complaint rate, best first. Red marks a number "
               "above the network&rsquo;s own figure for the same day, not a target miss."))
        + pblock(WKLABEL, table(aw_cols, aw_rows)
                 + note("Area manager names open that area&rsquo;s page, where every one of these numbers breaks "
                        "into stores and then into orders.")),
        lead="Five areas, one row each. This is the level central actually acts at: a store is reached through "
             "its area manager."))

# ---- 3. all stores ----
scols = ["#", "Store", "AM", "Orders", "vs avg", "Online %", "Rej", "Comp", "Rating", "Wait", "False ready wk", "Lost wk"]
def srow(s, rank_key):
    d = s["day"]
    p = (round(100.0 * (d["orders"] - d["avgord"]) / d["avgord"])
         if d["orders"] is not None and d["avgord"] else None)
    vs = "-" if p is None else (good("+%d%%" % p) if p >= 10 else
                                ('<span class="flag">%d%%</span>' % p if p <= -15 else "%+d%%" % p))
    return [s.get(rank_key, "-"), e(s["code"]), e(s["am"] or ""), n0(d["orders"]), vs,
            flag(n2(d["online"]), (d["online"] if d["online"] is not None else 100) < 99.9),
            flag(n0(d["srej"]), (d["srej"] or 0) > 0),
            flag(n0(d["comps"]), (d["comps"] or 0) >= 3),
            n1(d["rating"]) if d["rating"] else "-",
            flag(n1(d["wait"]), (d["wait"] or 0) >= 2),
            flag(n0(s["wk"]["fr"]), (s["wk"]["fr"] or 0) >= 40),
            inr(money_by_store.get(s["code"], {}).get("total_wk", 0))]
day_rows = [srow(s, "rank") for s in ranked] + [srow(s, "rank") for s in stores if "rank" not in s]
wcols = ["#", "Store", "AM", "Orders", "Per day", "Online %", "Rej", "Comp", "Comp %", "Rating", "Wait", "False ready", "Lost"]
w_rows = []
for s in wranked:
    w = s["wk"]
    w_rows.append([s["wrank"], e(s["code"]), e(s["am"] or ""), n0(w["orders"]),
                   n0(w["orders"] / 7.0) if w["orders"] else "-",
                   flag(n2(w["online"]), (w["online"] if w["online"] is not None else 100) < 99.9),
                   flag(n0(w["srej"]), (w["srej"] or 0) > 0), n0(w["comps"]),
                   flag(n2(100.0 * (w["comps"] or 0) / w["orders"]) if w["orders"] else "-",
                        bool(w["orders"]) and 100.0 * (w["comps"] or 0) / w["orders"] > (cpct_wk or 0)),
                   n1(w["rating"]) if w["rating"] else "-",
                   flag(n1(w["wait"]), (w["wait"] or 0) >= 2),
                   flag(n0(w["fr"]), (w["fr"] or 0) >= 40),
                   inr(money_by_store.get(s["code"], {}).get("total_wk", 0))])
add(sec("3", "All %d stores" % len(stores),
        pblock("%s, ranked worst-first" % DSHORT,
               table(scols, day_rows)
               + note("Ranked by clean-day score: complaints % + rejections % + offline penalty, lower is better "
                      "(ties by rating, then orders). Red marks a number worth a question, not a verdict. Store "
                      "names open the store page for the same day."))
        + pblock(WKLABEL, fold("The same 41 stores ranked over the 7 days", len(w_rows), table(wcols, w_rows))
                 + note("The week ranking is the one to use for a conversation about habits; the day ranking is "
                        "for a conversation about yesterday.")),
        lead="One line per store. Worst first, because the top of this table is the work."))

# ---- 4. outlets not fully online ----
cards = []
for dp in D["online_dips"]:
    ser = [p["online"] for p in dp["series"]]
    labs = [p["d"][-2:] for p in dp["series"]]
    tps = [datetime.strptime(p["d"], "%Y-%m-%d").strftime("%a %-d %b") for p in dp["series"]]
    lo = min(90, min(ser)) - 1
    cards.append('<div class="minicard"><div class="mtitle">%s <small>&middot; %s</small></div>'
                 '<div class="mval">%s%% <small>on %s</small></div>'
                 '<div class="mnote">%s min offline that day &middot; %s min across the week</div>%s</div>'
                 % (e(dp["code"]), e(dp["am"]), n2(dp["online_day"]), DSHORT,
                    n0(dp["offmin_day"]), n0(dp["offmin_wk"]),
                    chart(ser, labs, "Online % per day (day of month)", "%", lo=lo, hi=100,
                          w=280, h=96, tips=tps, dec=1)))
off_lost = sum(dp["offmin_day"] for dp in D["online_dips"])
add(sec("4", "Outlets not fully online",
        pblock("%s dips, each with its own 7-day line" % DSHORT,
               ('<div class="minigrid">%s</div>' % "".join(cards)) if cards
               else '<p class="note">Every store was fully online on this day.</p>')
        + note("%d of %d stores dipped, %s minutes of trading lost between them on this day alone. "
               "Zomato reports total minutes offline per day, never the clock times, so the page cannot say "
               "when it happened; the store can." % (len(cards), len(stores), n0(off_lost))),
        lead="A store that is offline sells nothing and is invisible in every other number on this page. "
             "This is the first section to read."))

# ---- 5. rejected orders ----
rcols = ["Store", "AM", "Time", "Reason", "What the customer had ordered", "Value lost"]
rw = [[e(r["code"]), e(r["am"]), e(r["time"]), tag(r["reason"]), basket(r["basket"]), inr(r["value"])]
      for r in rejT]
rwk = [[e(r["code"]), e(r["am"]), e(r["dlabel"]), e(r["time"]), tag(r["reason"]), basket(r["basket"]),
        inr(r["value"])] for r in rejW]
rej_val_day = sum((r["value"] or 0) for r in rejT); rej_val_wk = sum((r["value"] or 0) for r in D["rejections"])
add(sec("5", "Rejected orders",
        pblock(DSHORT, table(rcols, rw, "No store-caused rejections on this day.")
               + note("%s of trade turned away on this day." % inr(rej_val_day)))
        + pblock(WKLABEL,
                 fold("Rejections earlier this week", len(rwk),
                      table(["Store", "AM", "Day", "Time", "Reason", "What the customer had ordered", "Value lost"], rwk))
                 + note("%s across the 7 days, every rupee of it an order a customer tried to place. Only "
                        "store-caused rejections are listed, in the order feed&rsquo;s own words: <b>items out of "
                        "stock, kitchen is full, restaurant is closed, timeout, unavailable to accept</b>. Customer "
                        "and rider cancellations are excluded."
                        % inr(rej_val_wk))
                 + note("Two counts again, as with complaints. Zomato&rsquo;s daily report counts %s store "
                        "rejections for the week; %s order rows carry one of those reasons. The list is the shorter "
                        "of the two because only orders that reached the store appear in the order feed. Both are "
                        "true; never add them together." % (n0(srej_wk), n0(len(D["rejections"]))))),
        lead="A rejection is a customer who wanted to buy and was told no. Each row is one of them."))

# ---- 6. complaints ----
def comp_rows(rs, with_day):
    out = []
    for r in rs:
        row = [e(r["code"]), e(r["am"])]
        if with_day: row.append(e(r["dlabel"]))
        row += [e(r["time"]), tag(r["tag"]), basket(r["basket"]),
                inr(r["refund"]) if r["refund"] else "-"]
        out.append((row, ' data-reason="%s"' % e(r["tag"] or "")))
    return out
tag_counts = {}
for r in compW_shown:
    tag_counts[r["tag"]] = tag_counts.get(r["tag"], 0) + 1
chips = "".join('<button class="rfilter" data-reason="%s" type="button">%s: <b>%d</b></button>'
                % (e(t), e(t), c) for t, c in sorted(tag_counts.items(), key=lambda kv: -kv[1]))
chips += '<button class="rfilter on" data-reason="" type="button">Show all</button>'
zsum = ('<div class="scroll-x"><table><thead><tr><th>Zomato&rsquo;s own reason counts, 7 days</th><th>Complaints</th></tr>'
        '</thead><tbody>%s</tbody></table></div>'
        % "".join("<tr><td>%s</td><td>%s</td></tr>" % (k, n0(v)) for k, v in
                  sorted([("Delivered late", reasons["late"]), ("Poor taste or quality", reasons["quality"]),
                          ("Poor packaging or spillage", reasons["packaging"]), ("Wrong items", reasons["wrong"]),
                          ("Items missing", reasons["missing"])], key=lambda kv: -kv[1])))
add(sec("6", "Complaints",
        pblock(DSHORT,
               fold("Every order with an issue on %s" % DSHORT, len(compT),
                    table(["Store", "AM", "Time", "Tag on the order", "What was in the order", "Refunded"],
                          comp_rows(compT, False)), open_=len(compT) <= 40))
        + pblock(WKLABEL,
                 '<div class="rfilters">%s</div>' % chips
                 + fold("Complaints earlier this week (newest %d of %d)" % (len(compW_shown), len(compW)),
                        len(compW_shown),
                        table(["Store", "AM", "Day", "Time", "Tag on the order", "What was in the order", "Refunded"],
                              comp_rows(compW_shown, True), tid="cw"))
                 + note("Filters are built from the tags these ORDER rows actually carry, so a chip always returns "
                        "rows. The newest %d are listed here; each store page carries its own full list."
                        % len(compW_shown))
                 + '<div class="pblock" style="margin-top:8px"><div class="ptitle">Zomato&rsquo;s own count, for '
                   'comparison only</div>%s%s</div>'
                   % (zsum,
                      note("Two counts, two sources, both true. Zomato&rsquo;s official complaint figure comes "
                           "from their daily report (%s for the week); the tables above list every order where a "
                           "customer raised something (%s for the week). Zomato tags a reason on only some of them, "
                           "so the tag counts are smaller than their daily totals, and %s of the %s orders on %s "
                           "carry no tag at all. Nothing is hidden: the untagged orders are in the list too. Never "
                           "add the two sources together."
                           % (n0(reasons["comps"]), n0(D["complaints_total"]),
                              n0(sum(1 for r in compT if r["tag"] == "reason not tagged by Zomato")),
                              n0(len(compT)), DSHORT)))),
        lead="Two vocabularies exist and they are never mixed: the tags on the order rows drive the tables and the "
             "filters; Zomato&rsquo;s daily report is shown separately at the bottom as a read-only summary."))

# ---- 7. low ratings ----
lcols = ["Store", "AM", "Time", "Stars", "What was in the order", "Complaint tag if any"]
lw = [[e(r["code"]), e(r["am"]), e(r["time"]), e(r["rating"]), basket(r["basket"]),
       tag(r["tag"]) if r["tag"] else "-"] for r in lowT]
lwk = [[e(r["code"]), e(r["am"]), e(r["dlabel"]), e(r["time"]), e(r["rating"]), basket(r["basket"]),
        tag(r["tag"]) if r["tag"] else "-"] for r in lowW_shown]
add(sec("7", "1, 2 and 3-star orders",
        pblock(DSHORT, fold("Low-rated orders on %s" % DSHORT, len(lw), table(lcols, lw),
                            open_=len(lw) <= 40))
        + pblock(WKLABEL,
                 fold("Low-rated orders earlier this week (newest %d of %d)" % (len(lwk), len(lowW)), len(lwk),
                      table(["Store", "AM", "Day", "Time", "Stars", "What was in the order", "Complaint tag if any"],
                            lwk))
                 + note("%s low-rated orders in the 7 days. Only a small share of orders are rated at all, so treat "
                        "each row as one specific customer, never as a percentage. Ratings for the newest days keep "
                        "arriving for several days afterwards." % n0(D["low_ratings_total"]))),
        lead="A rating is the only place the customer speaks in their own time. These are the ones who were "
             "unhappy enough to say so."))

# ---- 8. rider wait ----
wrows = []
for w in D["wait_stores"]:
    if w["delivered_wk"] == 0: continue
    wrows.append([e(w["code"]), e(w["am"]),
                  flag(n1(w["wait_day"]), (w["wait_day"] or 0) >= 2),
                  flag(n1(w["wait_wk"]), (w["wait_wk"] or 0) >= 2),
                  n0(w["waits3_wk"]), n0(w["delivered_wk"]),
                  flag("%s%%" % n1(w["pct3"]), (w["pct3"] or 0) >= 15)])
add(sec("8", "Where riders wait",
        pblock("Worst first, %s" % WKLABEL.lower(),
               table(["Store", "AM", "Wait on %s" % DSHORT, "Wait, week", "Orders kept 3+ min", "Delivered",
                      "Share 3+ min"], wrows)
               + note("Network average %s min, %s of %s delivered orders kept a rider waiting 3 minutes or more "
                      "(%s%%). Goal is under 1.5 minutes average and under 3%% of orders. Rider wait is the verified "
                      "speed measure: Zomato&rsquo;s kitchen preparation time is excluded permanently because it "
                      "only tracks how fast the tablet button is pressed."
                      % (n1(wait_wk), n0(waits3_wk), n0(delivered_wk), n1(pct3)))),
        lead="Every minute a rider stands in a store is a minute the order is late and the rider is not paid. "
             "This is the one speed number the data can prove."))

# ---- 9. false ready ----
frrows = [[e(f["code"]), e(f["am"]), n0(f["fr_day"]), n0(f["fr_wk"]), n0(f["delivered_wk"]),
           flag("%s%%" % n1(f["pct"]), (f["pct"] or 0) >= 5)] for f in D["fr_stores"]]
frorders = [[e(r["code"]), e(r["am"]), e(r["dlabel"]), e(r["time"]), "%s sec" % n0(r["ready_secs"]),
             "%s min" % n1(r["waited_min"]), basket(r["basket"])] for r in D["fr_orders"]]
add(sec("9", "&ldquo;Ready&rdquo; pressed before the food was ready",
        pblock("By store, worst first",
               table(["Store", "AM", "On %s" % DSHORT, "This week", "Delivered", "Share of orders"], frrows,
                     "No false ready-presses this week.")
               + note("%s orders network-wide this week, %s%% of everything delivered." %
                      (n0(fr_wk), n1(100.0 * fr_wk / delivered_wk if delivered_wk else 0))))
        + pblock("The worst 25 orders of the week",
                 fold("Order by order", len(frorders),
                      table(["Store", "AM", "Day", "Time", "Marked ready after", "Rider then waited",
                             "What was in the order"], frorders))
                 + note("These are orders marked ready within a minute of being accepted where the rider then "
                        "waited 3 minutes or more. Both facts come from the order&rsquo;s own timestamps.")),
        lead="Pressing ready early makes the store&rsquo;s Zomato numbers look good and makes the rider wait. "
             "It is a habit, and habits are a central conversation, not a store one."))

# ---- 10. money lost ----
mrows = [[e(m["code"]), e(m["am"]), inr(m["stockout_wk"]), n0(m["rej_wk"]), inr(m["refunds_wk"]),
          n0(m["comp_wk"]), "<b>%s</b>" % inr(m["total_wk"])] for m in D["money_stores"]]
add(sec("10", "Money lost, by store",
        pblock(WKLABEL,
               table(["Store", "AM", "Turned-away orders", "Rejections", "Refunds", "Complaints", "Total lost"],
                     mrows, "Nothing lost to rejections or refunds this week.")
               + note("%s across %d stores. Every rupee here ties to an order listed in sections 5 and 6. "
                      "Nothing on this line is an estimate, and offline minutes are NOT included: what a closed "
                      "store would have sold cannot be measured, only guessed."
                      % (inr(money_wk), len(mrows)))),
        lead="The only place on the page where operational failure is priced."))

# ---- 11. central levers ----
disc_pct_day = 100.0 * segd["discount"] / segd["subtotal"] if segd["subtotal"] else None
disc_pct_wk = 100.0 * segw["discount"] / segw["subtotal"] if segw["subtotal"] else None
roi_wk = adsw["ad_sales"] / adsw["spend"] if adsw["spend"] else None
roi_day = adsd["ad_sales"] / adsd["spend"] if adsd["spend"] else None
open_pct = 100.0 * segw["menu_opens"] / segw["impressions"] if segw["impressions"] else None
conv_pct = 100.0 * segw["orders"] / segw["menu_opens"] if segw["menu_opens"] else None
lever_tiles = [
    ("Discounts given, %s" % DSHORT, lakh(segd["discount"]), "%s%% of subtotal" % n1(disc_pct_day),
     chip(disc_pct_day <= disc_pct_wk, "against %s%% for the week" % n1(disc_pct_wk))),
    ("Discounts given, week", lakh(segw["discount"]), "%s%% of subtotal" % n1(disc_pct_wk),
     chip(False, "%s of margin, the largest single lever on this page" % lakh(segw["discount"]))),
    ("Ad spend, week", lakh(adsw["spend"]), "%s ad-attributed orders" % n0(adsw["ad_orders"]),
     chip((roi_wk or 0) >= 4, "%sx return on the week" % n1(roi_wk))),
    ("Orders with an offer", "%s%%" % n1(100.0 * segw["offer_orders"] / segw["orders"] if segw["orders"] else 0),
     "%s of %s orders in the week" % (n0(segw["offer_orders"]), n0(segw["orders"])),
     chip(False, "nine orders in ten carry a discount")),
]
funnel = ('<div class="minigrid" style="grid-template-columns:repeat(3,1fr)">'
          '<div class="minicard"><div class="mtitle">Impressions</div><div class="mval">%s</div>'
          '<div class="mnote">the menu was shown this many times</div></div>'
          '<div class="minicard"><div class="mtitle">Menu opens</div><div class="mval">%s</div>'
          '<div class="mnote">%s%% of impressions: the listing itself is the first lever</div></div>'
          '<div class="minicard"><div class="mtitle">Orders</div><div class="mval">%s</div>'
          '<div class="mnote">%s%% of menu opens: price, offer and rating decide here</div></div></div>'
          % (n0(segw["impressions"]), n0(segw["menu_opens"]), n2(open_pct),
             n0(segw["orders"]), n1(conv_pct)))
ltiles = "".join('<div class="tile"><div class="label">%s</div><div class="value">%s</div>'
                 '<div class="delta">%s</div>%s</div>' % t for t in lever_tiles)
lrows = []
for l in sorted(D["lever_stores"], key=lambda x: -(x["disc_wk"] or 0)):
    lrows.append([e(l["code"]), e(l["am"]), inr(l["sub_wk"]), inr(l["disc_wk"]),
                  flag("%s%%" % n1(l["disc_pct_wk"]), (l["disc_pct_wk"] or 0) > (disc_pct_wk or 0)),
                  "%s%%" % n1(l["offer_pct_wk"]), inr(l["spend_wk"]),
                  flag(n1(l["roi_wk"]), (l["roi_wk"] or 99) < 4),
                  n0(l["impr_wk"]), "%s%%" % n2(l["open_pct_wk"]), "%s%%" % n1(l["conv_pct_wk"])])
base_spend = sorted(t["spend"] or 0 for t in trend)[len(trend) // 2]
spend_days = "".join(
    "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>"
    % (datetime.strptime(t["d"], "%Y-%m-%d").strftime("%a %-d %b"), inr(t["spend"]),
       n1(t["roi"]),
       "the weekly charge lands" if (t["spend"] or 0) > 3 * base_spend
       else ("the tail of it" if (t["spend"] or 0) > 1.5 * base_spend else ""))
    for t in trend)
add(sec("11", "Central levers (never shown to a store or an area manager)",
        '<div class="context" style="margin:2px 0 8px">%s</div>' % ltiles
        + pblock("The funnel, %s" % WKLABEL.lower(),
                 funnel + note("Impressions and menu opens are Zomato&rsquo;s own counts of its listing pages. "
                               "Per store, the last three columns of the table below."))
        + pblock("Where the discount and the ad money went, %s" % WKLABEL.lower(),
                 table(["Store", "AM", "Subtotal", "Discount", "Disc %", "Orders w/ offer", "Ad spend", "ROI",
                        "Impressions", "Menu opens", "Opens &#8594; orders"], lrows)
                 + note("Red discount % marks a store discounting harder than the network. Red ROI marks under 4x. "
                        "Ad ROI is Zomato&rsquo;s own attribution and is directional, not audited."))
        + pblock("Why the daily ad number cannot be read (verified 26 Aug 2026)",
                 '<div class="scroll-x"><table><thead><tr><th>Day</th><th>Ad spend</th><th>ROI</th>'
                 '<th></th></tr></thead><tbody>%s</tbody></table></div>' % spend_days
                 + note("Ad spend is not posted daily. It arrives in a lump, on a Sunday in most weeks, with a "
                        "smaller tail on the Monday, while ad-attributed sales stay flat through the spike. The "
                        "same shape repeats on 19 and 26 July and on 9, 16 and 23 August. So a single day&rsquo;s "
                        "ad spend and a single day&rsquo;s ROI are meaningless: only the 7-day figure is. That is "
                        "why the tiles above quote the week and the day tile has been left out.")),
        lead="Discounts, ads and the funnel. This is the block that separates the central page from the area page: "
             "these are the numbers only central can move, and each one lists the stores it came from."))

# ---- foot ----
add('<footer><p>Every figure on this page comes from the spine functions <b>dash_all</b> and '
    '<b>dash_central_detail</b> and is reproducible by query. Kitchen preparation time is excluded permanently '
    '(verified 23 Aug 2026: it measures tablet button-pressing, not kitchen work). Rider wait is the verified '
    'speed measure, identical across two independent Zomato feeds.</p>'
    '<p>The page shows settled data only, two days behind, because Zomato keeps revising fresher days: ratings '
    'and complaint counts on a day still move for several days after it. Online time and rejections do not move. '
    'Nothing on this page is an estimate and no number is produced by AI.</p>'
    '<p>Hover any shortened item list to read it in full. Store and area manager names open their own pages.</p>'
    '</footer>')

add('</div><script>'
    'document.querySelectorAll(".rfilter").forEach(function(b){b.addEventListener("click",function(){'
    'document.querySelectorAll(".rfilter").forEach(function(x){x.classList.remove("on")});'
    'b.classList.add("on");var r=b.dataset.reason;'
    'document.querySelectorAll("#cw tbody tr").forEach(function(tr){'
    'tr.style.display=(!r||tr.dataset.reason===r)?"":"none"})})});'
    '</script></body></html>')

out = os.path.expanduser("~/Library/Mobile Documents/com~apple~CloudDocs/Downloads Drive/erp-plan/"
                         "central-dashboard-template-v1.html")
open(out, "w").write("\n".join(H))
print("wrote", out, len("\n".join(H)), "bytes")
