#!/usr/bin/env python3
"""The 7:30 daily dashboard mailer (Pranjay's spec, 24 Aug 2026).

48 mails from one data pull:
  41 store mails   -> the store's own page, to its store email
   5 area mails    -> the area page + that AM's store pages attached
   1 central mail A -> all 5 area pages + the network page
   1 central mail B -> all 41 store pages in one mail
Central mails go to the central team with Pranjay in CC.

Data: the spine functions dash_all / dash_store_detail / dash_store_reasons,
the same ones the portal /daily module reads. The mail covers the LATEST
LOADED day (dash_latest_date) and says so plainly; it never claims
"yesterday".

Exit codes follow the house pattern: 0 sent (wrapper stamps success),
75 defer (transient problem, a later slot retries), 1 hard failure (alert
mail already sent). CC_MAILER_TEST=1 sends a 4-mail sample to Pranjay only.
"""
from __future__ import annotations
import json
import os
import re
import smtplib
import ssl
import sys
import traceback
from datetime import date, datetime
from email.message import EmailMessage

import psycopg2

import render as R

HERE = os.path.dirname(os.path.abspath(__file__))
TEST = os.environ.get("CC_MAILER_TEST") == "1"
OWNER = "pranjay@cremecastle.in"
CENTRAL = ["pawan.g@cremecastle.in", "rishabh.k@cremecastle.in", "bhagwan@cremecastle.in"]
AM_EMAIL = {"Ajay": "ajay.rana@cremecastle.in", "Gopal": "gopal.ch@cremecastle.in",
            "Sanjeev": "sanjeev.sejwal@cremecastle.in", "Mukesh": "am.chandigarh@cremecastle.in",
            "Santosh": "am.jaipur@cremecastle.in"}


def load_env():
    env = {}
    for p in [os.path.join(HERE, "../../../dashboard/auto/.env"),
              os.path.join(HERE, "../../.env.local")]:
        p = os.path.abspath(p)
        if os.path.exists(p):
            for line in open(p):
                m = re.match(r"([A-Z_]+)=(.*)", line.strip())
                if m and m.group(1) not in env:
                    env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env


def fetch_all(cur, d):
    cur.execute("select public.dash_all(%s::date)", (d,))
    data = cur.fetchone()[0]
    # score + rank, same arithmetic as the portal's lib/daily.ts
    for s in data["stores"]:
        day, wk = s["day"], s["wk"]
        if day.get("cpct") is None and day.get("rpct") is None and day.get("online") is None:
            s["dayScore"] = None
        else:
            s["dayScore"] = (day.get("cpct") or 0) + (day.get("rpct") or 0) + (100 - (day.get("online") or 100))
        s["wkScore"] = (
            (100 * (wk.get("comps") or 0)) / wk["orders"] + (100 * (wk.get("rej") or 0)) / wk["orders"]
            + (100 - (wk.get("online") or 100))
        ) if wk.get("orders") else None
    for key, rkey, rat, orders in [("dayScore", "dayRank", lambda s: s["day"].get("rating") or 0, lambda s: s["day"].get("orders") or 0),
                                   ("wkScore", "wkRank", lambda s: s["wk"].get("rating") or 0, lambda s: s["wk"].get("orders") or 0)]:
        ranked = sorted([s for s in data["stores"] if s.get(key) is not None],
                        key=lambda s: (s[key], -rat(s), -orders(s)))
        for i, s in enumerate(ranked):
            s[rkey] = i + 1
    return data


def area_aggs(stores):
    by = {}
    for s in stores:
        by.setdefault(s.get("am") or "Unassigned", []).append(s)
    out = []
    for am, xs in by.items():
        def tot(sel):
            return sum((sel(s) or 0) for s in xs)
        d_orders, d_comps = tot(lambda s: s["day"].get("orders")), tot(lambda s: s["day"].get("comps"))
        w_orders, w_comps = tot(lambda s: s["wk"].get("orders")), tot(lambda s: s["wk"].get("comps"))
        out.append({
            "am": am, "stores": len(xs),
            "day": {"orders": d_orders, "comps": d_comps,
                    "cpct": (100.0 * d_comps / d_orders) if d_orders else None,
                    "srej": tot(lambda s: s["day"].get("srej")), "offmin": tot(lambda s: s["day"].get("offmin"))},
            "wk": {"orders": w_orders, "comps": w_comps,
                   "cpct": (100.0 * w_comps / w_orders) if w_orders else None,
                   "srej": tot(lambda s: s["wk"].get("srej")), "offmin": tot(lambda s: s["wk"].get("offmin")),
                   "fr": tot(lambda s: s["wk"].get("fr")), "stockout": tot(lambda s: s["wk"].get("stockout")),
                   "refunds": tot(lambda s: s["wk"].get("refunds"))},
        })
    return sorted(out, key=lambda a: a["day"]["cpct"] if a["day"]["cpct"] is not None else 99)


def date_label(iso):
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%A, %d %B %Y")


def store_page(s, detail, reasons, all_stores, dlabel):
    day, wk = s["day"], s["wk"]
    trend = detail.get("trend") or []
    tdays = [datetime.strptime(t["d"], "%Y-%m-%d").strftime("%a %d") for t in trend]

    attention = []
    top = sorted([("packaging and spillage", reasons.get("packaging") or 0),
                  ("taste or quality", reasons.get("quality") or 0),
                  ("missing items", reasons.get("missing") or 0),
                  ("wrong items", reasons.get("wrong") or 0),
                  ("late delivery", reasons.get("late") or 0)], key=lambda x: -x[1])[0]
    if top[1] >= 3:
        attention.append(f"<li><b>Top complaint reason this week: {top[0]}</b> ({top[1]} tags). Worth one physical check of how orders go out.</li>")
    if (wk.get("stockout") or 0) > 0:
        attention.append(f"<li><b>Stockouts cost {R.money(wk['stockout'])} this week.</b> Check stock before the dinner rush; the rejected orders are listed below.</li>")
    if (wk.get("fr") or 0) > 0:
        attention.append(f"<li><b>&quot;Ready&quot; was pressed early on {wk['fr']} orders this week</b> while the rider stood waiting. Press ready only when the bag is sealed.</li>")
    if (day.get("comps") or 0) == 0 and (day.get("srej") or 0) == 0 and (day.get("online") or 0) >= 99.9:
        attention.append("<li><b>A clean day:</b> no complaints, no rejections, fully online. That is the standard.</li>")

    tiles = "".join([
        R.tile("Orders",
               f'<div class="value">{R.n0(day.get("orders"))}</div><div class="delta">own 7-day average {R.n0(day.get("avgord"))}</div>',
               f'<div class="value">{R.n0(wk.get("orders"))}</div><div class="delta">{R.n0(round((wk.get("orders") or 0)/7))} per day</div>'),
        R.tile("Delivered",
               f'<div class="value">{R.n0(day.get("delivered"))} <small>of {R.n0(day.get("orders"))}</small></div>',
               f'<div class="value">{R.n0(wk.get("delivered"))} <small>of {R.n0(wk.get("orders"))}</small></div>'),
        R.tile("Food rating",
               f'<div class="value">{R.n1(day.get("rating")) if day.get("rating") else "-"} <small>/ 5</small></div>'
               f'<div class="delta">{len(detail.get("rated_day") or [])} orders rated</div>',
               f'<div class="value">{R.n1(wk.get("rating")) if wk.get("rating") else "-"} <small>/ 5</small></div>'),
        R.tile("Network rank",
               f'<div class="value">{s.get("dayRank") or "-"} <small>of {len(all_stores)}</small></div><div class="delta">for the day</div>',
               f'<div class="value">{s.get("wkRank") or "-"} <small>of {len(all_stores)}</small></div><div class="delta">for the 7 days</div>'),
    ])

    body = R.masthead("Creme Castle · Store Daily · Zomato", s["code"],
                      f'{detail.get("locality") or ""}, {detail.get("city") or ""} · Area manager: {detail.get("am") or "-"}', dlabel)
    body += f'<div class="context">{tiles}</div>'
    if attention:
        body += f'<div class="actions"><h2>Things for today</h2><ol>{"".join(attention[:3])}</ol></div>'

    body += R.sec("1", "Were you open?",
        f'<div class="row"><div class="kpi"><div class="label">Online time</div>'
        f'<span class="only-y"><div class="value">{R.n1(day.get("online")) if day.get("online") is not None else "-"}%</div></span>'
        f'<span class="only-wk"><div class="value">{R.n1(wk.get("online")) if wk.get("online") is not None else "-"}%</div></span></div>'
        f'<div class="kpi"><div class="label">Time offline</div>'
        f'<span class="only-y"><div class="value">{R.n0(day.get("offmin"))} <small>min</small></div></span>'
        f'<span class="only-wk"><div class="value">{R.n0(wk.get("offmin"))} <small>min</small></div></span></div>'
        + R.spark([t.get("online") for t in trend], tdays, "online % per day", 95, 100, "%") + "</div>")

    rej_note = (f"This week's store-caused rejections. Not counted against the store: "
                f"{detail.get('other_cancels_wk') or 0} orders cancelled from the customer or rider side.")
    body += R.sec("2", "Did you accept what came?",
        f'<div class="row"><div class="kpi"><div class="label">Rejected by the store</div>'
        f'<span class="only-y"><div class="value">{R.n0(day.get("srej"))}</div></span>'
        f'<span class="only-wk"><div class="value">{R.n0(wk.get("srej"))}</div></span></div>'
        + R.spark([t.get("srej") for t in trend], tdays, "store-caused rejections per day", 0) + "</div>"
        + '<div class="only-wk">' + R.receipts_table(detail.get("rejections_wk") or [],
            [("label", "When", None), ("reason", "Reason", None), ("basket", "What was ordered", None),
             ("value", "Value lost", lambda v: R.money(float(v)) if v else "-")], rej_note) + "</div>")

    reasons_bars = R.hbar([("Poor taste or quality", reasons.get("quality") or 0),
                           ("Packaging or spillage", reasons.get("packaging") or 0),
                           ("Items missing", reasons.get("missing") or 0),
                           ("Delivered late", reasons.get("late") or 0),
                           ("Wrong items", reasons.get("wrong") or 0)])
    body += R.sec("3", "Was it right?",
        f'<div class="row"><div class="kpi"><div class="label">Complaints</div>'
        f'<span class="only-y"><div class="value">{R.n0(day.get("comps"))}</div></span>'
        f'<span class="only-wk"><div class="value">{R.n0(wk.get("comps"))}</div></span></div>'
        + R.spark([t.get("comps") for t in trend], tdays, "complaints per day", 0) + "</div>"
        + reasons_bars
        + '<div class="only-y" style="margin-top:10px">' + R.receipts_table(detail.get("complaints_day") or [],
            [("label", "When", None), ("basket", "What was in the order", None), ("tag", "Tag", None)],
            "Orders where the customer reported an issue on this day.") + "</div>")

    body += R.sec("4", 'Was it fast, and was "ready" honest?',
        f'<div class="row"><div class="kpi"><div class="label">Avg rider wait</div>'
        f'<span class="only-y"><div class="value">{(R.n1(day.get("wait")) + " min") if day.get("wait") is not None else "-"}</div></span>'
        f'<span class="only-wk"><div class="value">{(R.n1(wk.get("wait")) + " min") if wk.get("wait") is not None else "-"}</div></span></div>'
        f'<div class="kpi"><div class="label">Rider waited 3+ min, week</div><div class="value">{R.n0(wk.get("waits3"))}</div></div>'
        f'<div class="kpi"><div class="label">&quot;Ready&quot; pressed early, rider waited</div>'
        f'<span class="only-y"><div class="value">{R.n0(day.get("fr"))}</div><div class="delta">{R.n0(wk.get("fr"))} this week, below</div></span>'
        f'<span class="only-wk"><div class="value">{R.n0(wk.get("fr"))}</div></span></div></div>'
        + R.receipts_table(detail.get("false_ready_wk") or [],
            [("label", "When", None), ("ready_secs", "Marked ready after", lambda v: f"{v} sec"),
             ("waited_min", "Rider then waited", lambda v: f"{v} min"), ("basket", "What was in the order", None)],
            'Orders where "food ready" was pressed within a minute of accepting, yet the rider waited 3+ minutes.')
        + '<div class="callout"><b>Why there is no kitchen preparation time here:</b> verified across 20 months, '
          "Zomato's KPT only measures how quickly the tablet button is pressed. It is excluded as meaningless, not missing.</div>")

    body += R.sec("5", "What did mistakes cost?",
        f'<div class="row"><div class="kpi"><div class="label">Refunded</div>'
        f'<span class="only-y"><div class="value">{R.money(detail.get("refunds_day"))}</div></span>'
        f'<span class="only-wk"><div class="value">{R.money(detail.get("refunds_wk"))}</div></span></div>'
        f'<div class="kpi"><div class="label">Lost to stockouts, week</div><div class="value">{R.money(detail.get("stockout_wk"))}</div></div></div>')

    body += R.sec("6", "Scoreboard",
        '<div class="only-y">' + R.receipts_table(detail.get("rated_day") or [],
            [("label", "When", None), ("rating", "Stars", None), ("basket", "What was in the order", None)]) + "</div>"
        + '<div class="only-wk">' + R.receipts_table(detail.get("low_ratings_wk") or [],
            [("label", "1 and 2-star orders this week", None), ("rating", "Stars", None),
             ("basket", "What was in the order", None), ("tag", "Complaint tag", None)]) + "</div>"
        + '<div class="label" style="font-size:12px;color:#7E6B6E;text-transform:uppercase;letter-spacing:.05em;margin-top:14px">Network league (all stores)</div>'
        + R.league_tables(all_stores, highlight=s["code"]))

    meal = detail.get("mealtime_wk") or {}
    total = sum(meal.values())
    if total:
        names = {"Dinner": "Dinner (7 to 11 pm)", "Lunch": "Lunch (11 am to 4 pm)", "Snacks": "Snacks (4 to 7 pm)",
                 "Late night": "Late night (11 pm to 7 am)", "Breakfast": "Breakfast (7 to 11 am)"}
        body += R.sec("+", "When your orders come (for staffing and prep)",
            R.hbar([(names.get(k, k), round(100 * v / total)) for k, v in meal.items()])
            + '<p class="note">Share (%) of this store\'s orders in the 7 days.</p>')

    body += R.footer_html()
    return R.page(f"Store Daily: {s['code']}", body)


def area_page(am, mine, areas, all_count, dlabel):
    a = next(x for x in areas if x["am"] == am)
    attention = []
    hot = sorted([s for s in mine if (s["day"].get("comps") or 0) >= 2],
                 key=lambda s: -(s["day"].get("cpct") or 0))
    if hot:
        h = hot[0]
        attention.append(f'<li><b>{R.esc(h["code"])}</b>: {h["day"]["comps"]} complaints on {h["day"].get("orders") or "-"} orders. Ask what went out wrong.</li>')
    frt = max(mine, key=lambda s: s["wk"].get("fr") or 0)
    if (frt["wk"].get("fr") or 0) >= 15:
        attention.append(f'<li><b>{R.esc(frt["code"])}</b> pressed &quot;ready&quot; early on {frt["wk"]["fr"]} orders this week while the rider waited.</li>')
    off = sorted([s for s in mine if (s["day"].get("offmin") or 0) >= 15], key=lambda s: -(s["day"].get("offmin") or 0))
    if off:
        attention.append(f'<li><b>{R.esc(off[0]["code"])}</b> was offline {off[0]["day"]["offmin"]} minutes. Ask what happened at the tablet.</li>')
    best = min(mine, key=lambda s: s.get("dayRank") or 99)
    if best.get("dayRank"):
        attention.append(f'<li><b>Good news to pass on:</b> {R.esc(best["code"])} ranks {best["dayRank"]} of {all_count} network-wide.</li>')

    tiles = "".join([
        R.tile("Orders", f'<div class="value">{R.n0(a["day"]["orders"])}</div>',
               f'<div class="value">{R.n0(a["wk"]["orders"])}</div><div class="delta">{R.n0(round(a["wk"]["orders"]/7))} per day</div>'),
        R.tile("Complaints",
               f'<div class="value">{R.n0(a["day"]["comps"])} <small>({"-" if a["day"]["cpct"] is None else "{:.1f}".format(a["day"]["cpct"])}%)</small></div>',
               f'<div class="value">{R.n0(a["wk"]["comps"])} <small>({"-" if a["wk"]["cpct"] is None else "{:.1f}".format(a["wk"]["cpct"])}%)</small></div>'),
        R.tile("Store-caused rejections", f'<div class="value">{R.n0(a["day"]["srej"])}</div>',
               f'<div class="value">{R.n0(a["wk"]["srej"])}</div>'),
        R.tile("Money lost, week",
               f'<div class="value">{R.money(a["wk"]["stockout"] + a["wk"]["refunds"])}</div>'
               f'<div class="delta">{R.money(a["wk"]["stockout"])} stockouts + {R.money(a["wk"]["refunds"])} refunds</div>',
               f'<div class="value">{R.money(a["wk"]["stockout"] + a["wk"]["refunds"])}</div>'),
    ])
    body = R.masthead("Creme Castle · Area Daily · Zomato", f"{am}'s Area", f"{len(mine)} stores", dlabel)
    body += f'<div class="context">{tiles}</div>'
    if attention:
        body += f'<div class="actions"><h2>Where you are needed</h2><ol>{"".join(attention[:5])}</ol></div>'
    body += R.sec("1", "Your stores, best rank first", R.league_tables(mine))
    body += R.sec("2", "Area versus area", R.areas_tables(areas))
    body += R.footer_html()
    return R.page(f"Area Daily: {am}", body)


def central_page(data, areas, dlabel):
    stores = data["stores"]

    def tot(sel):
        return sum((sel(s) or 0) for s in stores)
    lev = data.get("levers") or {}
    seg_d, seg_w = lev.get("seg_day") or {}, lev.get("seg_wk") or {}
    ads_d, ads_w = lev.get("ads_day") or {}, lev.get("ads_wk") or {}
    r = data.get("reasons_wk") or {}

    orders_d, comps_d = tot(lambda s: s["day"].get("orders")), tot(lambda s: s["day"].get("comps"))
    orders_w, comps_w = tot(lambda s: s["wk"].get("orders")), tot(lambda s: s["wk"].get("comps"))
    money_w = tot(lambda s: s["wk"].get("stockout")) + tot(lambda s: s["wk"].get("refunds"))
    fr_w = tot(lambda s: s["wk"].get("fr"))

    def lakh(v):
        return "-" if not v else "₹{:.2f}L".format(v / 100000)

    tiles = "".join([
        R.tile("Orders", f'<div class="value">{R.n0(orders_d)}</div>',
               f'<div class="value">{R.n0(orders_w)}</div><div class="delta">{R.n0(round(orders_w/7)) if orders_w else "-"} per day</div>'),
        R.tile("Net sales", f'<div class="value">{lakh(seg_d.get("net_sales"))}</div><div class="delta">subtotal {lakh(seg_d.get("subtotal"))}</div>',
               f'<div class="value">{lakh(seg_w.get("net_sales"))}</div><div class="delta">subtotal {lakh(seg_w.get("subtotal"))}</div>'),
        R.tile("Complaints",
               f'<div class="value">{R.n0(comps_d)} <small>({"{:.1f}".format(100*comps_d/orders_d) if orders_d else "-"}%)</small></div>',
               f'<div class="value">{R.n0(comps_w)} <small>({"{:.1f}".format(100*comps_w/orders_w) if orders_w else "-"}%)</small></div>'),
        R.tile("Store-caused rejections", f'<div class="value">{R.n0(tot(lambda s: s["day"].get("srej")))}</div>',
               f'<div class="value">{R.n0(tot(lambda s: s["wk"].get("srej")))}</div>'),
        R.tile("Money lost, week", f'<div class="value">{R.money(money_w)}</div>', f'<div class="value">{R.money(money_w)}</div>'),
        R.tile("False ready-presses, week", f'<div class="value">{R.n0(fr_w)}</div>', f'<div class="value">{R.n0(fr_w)}</div>'),
    ])

    attention = []
    off = sorted([s for s in stores if (s["day"].get("online") or 100) < 97], key=lambda s: s["day"].get("online") or 100)
    if off:
        attention.append(f'<li><b>{R.esc(off[0]["code"])}</b> was online only {R.n1(off[0]["day"]["online"])}% ({off[0]["day"].get("offmin")} min offline).</li>')
    hot = sorted([s for s in stores if (s["day"].get("comps") or 0) >= 3], key=lambda s: -(s["day"].get("cpct") or 0))
    if hot:
        attention.append(f'<li><b>{R.esc(hot[0]["code"])}</b> is the day\'s complaint hotspot: {hot[0]["day"]["comps"]} complaints on {hot[0]["day"].get("orders")} orders.</li>')
    frt = max(stores, key=lambda s: s["wk"].get("fr") or 0)
    if (frt["wk"].get("fr") or 0) >= 20:
        attention.append(f'<li><b>False ready-pressing</b>: {fr_w} orders this week network-wide; worst is <b>{R.esc(frt["code"])}</b> with {frt["wk"]["fr"]}.</li>')
    if areas and areas[-1]["day"]["cpct"]:
        attention.append(f'<li><b>{R.esc(areas[-1]["am"])}\'s area</b> has the day\'s highest complaint rate ({areas[-1]["day"]["cpct"]:.2f}%).</li>')
    best = next((s for s in stores if s.get("dayRank") == 1), None)
    if best:
        attention.append(f'<li><b>Good news:</b> {R.esc(best["code"])} is the day\'s best-run store.</li>')

    body = R.masthead("Creme Castle · Network Daily · Zomato · Central Team", "All Dark Stores",
                      f"{len(stores)} stores, {len(areas)} areas", dlabel)
    body += f'<div class="context">{tiles}</div>'
    body += f'<div class="actions"><h2>What deserves central attention</h2><ol>{"".join(attention[:5])}</ol></div>'
    body += R.sec("1", "Area versus area", R.areas_tables(areas))
    body += R.sec("2", "All stores, ranked", R.league_tables(stores))
    if r:
        body += R.sec("3", "The week's complaint reasons, network-wide",
            R.hbar([("Poor packaging or spillage", r.get("packaging") or 0),
                    ("Poor taste or quality", r.get("quality") or 0),
                    ("Delivered late", r.get("late") or 0),
                    ("Wrong items", r.get("wrong") or 0),
                    ("Items missing", r.get("missing") or 0)])
            + f'<p class="note">{R.n0(r.get("comps"))} complaints in the 7 days; one complaint can carry several reason tags.</p>')
    roi_d = (ads_d.get("ad_sales") or 0) / ads_d["spend"] if ads_d.get("spend") else None
    roi_w = (ads_w.get("ad_sales") or 0) / ads_w["spend"] if ads_w.get("spend") else None
    body += R.sec("4", "Central levers (not shown to stores or AMs)",
        '<div class="context" style="margin:4px 0 0">' + "".join([
            R.tile("Discounts given", f'<div class="value">{lakh(seg_d.get("discount"))}</div>', f'<div class="value">{lakh(seg_w.get("discount"))}</div>'),
            R.tile("Ad spend",
                   f'<div class="value">{R.money(ads_d.get("spend"))}</div><div class="delta">{"ROI {:.1f}".format(roi_d) if roi_d else ""}</div>',
                   f'<div class="value">{R.money(ads_w.get("spend"))}</div><div class="delta">{"ROI {:.1f}".format(roi_w) if roi_w else ""}</div>'),
            R.tile("Ad-attributed orders", f'<div class="value">{R.n0(ads_d.get("ad_orders"))}</div><div class="delta">directional</div>',
                   f'<div class="value">{R.n0(ads_w.get("ad_orders"))}</div><div class="delta">directional</div>'),
        ]) + "</div>"
        + '<p class="note">Ad figures restate for days after the fact; treat recent ad numbers as provisional.</p>')
    body += R.footer_html()
    return R.page("Network Daily", body)




def _tls_context():
    """The python.org build has no OS cert store; use certifi's bundle (present
    on this Mac) so the TLS connection is verified rather than unverified."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def smtp_connect(host, port):
    """465 = implicit SSL; anything else = STARTTLS (the house default is 587)."""
    if int(port) == 465:
        return smtplib.SMTP_SSL(host, port, context=_tls_context(), timeout=120)
    s = smtplib.SMTP(host, port, timeout=120)
    s.starttls(context=_tls_context())
    return s


def build_mail(sender, to, cc, subject, body_text, attachments):
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject
    msg.set_content(body_text)
    for name, html_str in attachments:
        msg.add_attachment(html_str.encode("utf-8"), maintype="text", subtype="html", filename=name)
    return msg


def main():
    env = load_env()
    conn = psycopg2.connect(env["SPINE_DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("select public.dash_latest_date()")
    d = cur.fetchone()[0].isoformat()
    dlabel = date_label(d)
    data = fetch_all(cur, d)
    stores = data["stores"]
    if not stores or all(s["day"].get("orders") is None for s in stores):
        print(f"no data for {d}; deferring")
        return 75
    areas = area_aggs(stores)

    cur.execute("select internal_code, store_email from public.outlets where active")
    store_email = dict(cur.fetchall())

    # Render everything once.
    store_html = {}
    for s in stores:
        cur.execute("select public.dash_store_detail(%s, %s::date)", (s["code"], d))
        detail = cur.fetchone()[0]
        cur.execute("select public.dash_store_reasons(%s, %s::date)", (s["code"], d))
        reasons = cur.fetchone()[0] or {}
        store_html[s["code"]] = store_page(s, detail, reasons, stores, dlabel)
    area_html = {a["am"]: area_page(a["am"], [s for s in stores if (s.get("am") or "Unassigned") == a["am"]],
                                    areas, len(stores), dlabel)
                 for a in areas if a["am"] in AM_EMAIL}
    central_html = central_page(data, areas, dlabel)
    conn.close()

    fname = lambda code: f"{code} {d}.html"
    body_common = (f"Daily Zomato dashboard for {dlabel}.\n\n"
                   f"Open the attached file in a browser (tap it on your phone) for the full page: "
                   f"Day / 7-day views and sortable columns.\n\n"
                   f"Live version with any date: {R.PORTAL}/daily (your portal login).\n")

    sender = env.get("DASH_EMAIL_SENDER") or env.get("CC_MAIL_USER")
    password = env.get("DASH_EMAIL_APP_PASSWORD") or env.get("CC_MAIL_APP_PASSWORD")
    host = env.get("DASH_SMTP_HOST", "smtp.gmail.com")
    port = int(env.get("DASH_SMTP_PORT", "587"))

    mails = []
    for s in stores:
        to = store_email.get(s["code"])
        if not to:
            continue
        mails.append(([to], [], f"Store Daily {s['code']}: {dlabel}",
                      body_common, [(fname(s["code"]), store_html[s["code"]])]))
    for am, mail_addr in AM_EMAIL.items():
        if am not in area_html:
            continue
        atts = [(f"Area {am} {d}.html", area_html[am])]
        atts += [(fname(s["code"]), store_html[s["code"]]) for s in stores if (s.get("am") or "") == am]
        mails.append(([mail_addr], [], f"Area Daily {am}: {dlabel}", body_common, atts))
    atts_a = [(f"Network {d}.html", central_html)] + [(f"Area {am} {d}.html", h) for am, h in area_html.items()]
    mails.append((CENTRAL, [OWNER], f"Network Daily: {dlabel}", body_common, atts_a))
    atts_b = [(fname(code), h) for code, h in sorted(store_html.items())]
    mails.append((CENTRAL, [OWNER], f"All store pages: {dlabel}", body_common, atts_b))

    if TEST:
        sample = [m for m in mails if "CC-ND-Sector 45" in m[2] or "Area Daily Gopal" in m[2]
                  or m[2].startswith("Network Daily") or m[2].startswith("All store pages")]
        mails = [([OWNER], [], "[TEST] " + m[2], m[3], m[4]) for m in sample]

    sent = 0
    with smtp_connect(host, port) as smtp:
        smtp.login(sender, password)
        for to, cc, subject, body_text, atts in mails:
            smtp.send_message(build_mail(sender, to, cc, subject, body_text, atts))
            sent += 1
    print(f"sent {sent} mails for {d} (test={TEST})")
    return 0


def alert(env, text):
    try:
        sender = env.get("DASH_EMAIL_SENDER") or env.get("CC_MAIL_USER")
        password = env.get("DASH_EMAIL_APP_PASSWORD") or env.get("CC_MAIL_APP_PASSWORD")
        msg = EmailMessage()
        msg["From"], msg["To"] = sender, OWNER
        msg["Subject"] = "Daily mailer FAILED"
        msg.set_content(text)
        with smtp_connect(env.get("DASH_SMTP_HOST", "smtp.gmail.com"),
                          env.get("DASH_SMTP_PORT", "587")) as s:
            s.login(sender, password)
            s.send_message(msg)
    except Exception:
        pass


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        tb = traceback.format_exc()
        print(tb)
        # Before ~08:40 IST a later slot will retry silently; after that, alert.
        now = datetime.now()
        if now.hour > 8 or (now.hour == 8 and now.minute >= 40):
            alert(load_env(), f"The 7:30 daily dashboard mailer failed on its last slot.\n\n{tb}\n"
                              "Manual retry: python3 kitchen/workers/daily-mailer/run_mailer.py")
            sys.exit(1)
        sys.exit(75)
