#!/usr/bin/env python3
"""The three daily pages, built to the locked designs.

Each function here is the mail's twin of one portal page and must be changed
with it, section for section:

    store_page   <-> portal/app/(app)/daily/store/[code]/page.tsx   (v3)
    area_page    <-> portal/app/(app)/daily/area/[am]/page.tsx      (v2 + 192)
    central_page <-> portal/app/(app)/daily/central/view.tsx        (v1 + 192)

The only deliberate differences from the portal are the ones a standalone file
must have: no left rail, no date navigation (the mail is one settled day, and
the footer links to the portal for any other date), and store and area names
link out to the portal rather than to a sibling page.
"""
from __future__ import annotations
from datetime import datetime

import render as R


# ---------------------------------------------------------------- store (v3)
def store_page(s, det, reasons, all_stores, date):
    day, wk = s["day"], s["wk"]
    dshort = R.short_label(date)
    day_label = f"Yesterday ({dshort})"
    wk_label = R.week_label(det["week_start"], date)
    trend = det.get("trend") or []
    tlabels = [datetime.strptime(t["d"], "%Y-%m-%d").strftime("%a %-d") for t in trend]
    ttips = [datetime.strptime(t["d"], "%Y-%m-%d").strftime("%a %-d %b") for t in trend]

    things = []
    top = sorted([("packaging and spillage", reasons.get("packaging") or 0),
                  ("taste or quality", reasons.get("quality") or 0),
                  ("missing items", reasons.get("missing") or 0),
                  ("wrong items", reasons.get("wrong") or 0),
                  ("late delivery", reasons.get("late") or 0)], key=lambda kv: -kv[1])[0]
    if top[1] >= 3:
        things.append(f"<b>Top complaint reason this week: {top[0]}</b> ({top[1]} tags). "
                      "Worth one physical check of how orders go out.")
    if (det.get("stockout_wk") or 0) > 0:
        things.append(f"<b>Stockouts cost {R.money(det['stockout_wk'])} this week.</b> "
                      "The rejected orders and their items are in section 2.")
    if (wk.get("fr") or 0) > 0:
        things.append(f"<b>&quot;Ready&quot; was pressed early on {R.n0(wk['fr'])} orders this week</b> "
                      "while the rider stood waiting. Press ready only when the bag is sealed.")
    if not things:
        things.append("<b>A clean week.</b> Keep it there.")

    body = R.masthead("Creme Castle &middot; Store Daily &middot; Zomato", f"Store Daily: {R.esc(s['code'])}",
                      f"{R.esc(det.get('locality') or '')}"
                      + (", " + R.esc(det["city"]) if det.get("city") else "")
                      + f" &middot; Area manager: {R.esc(det.get('am') or '-')}",
                      R.date_label(date), R.settled_note())
    body += R.context(
        R.tile("Orders", R.n0(day.get("orders")), f"own 7-day average {R.n0(day.get('avgord'))}"),
        R.tile("Delivered", f"{R.n0(day.get('delivered'))} <small>of {R.n0(day.get('orders'))}</small>"),
        R.tile("Food rating",
               (R.n1(day["rating"]) if day.get("rating") else "-") + " <small>/ 5</small>",
               f"{len(det.get('rated_day') or [])} orders rated"),
        R.tile("Network rank", f"{s.get('dayRank') or '-'} <small>of {len(all_stores)}</small>", "for this day"),
    )
    body += R.actions("Things for today", things[:3])

    # 1. Were you open?
    body += R.sec("1", "Were you open?",
        R.period(day_label,
            R.krow(R.kpi("Online time", "-" if day.get("online") is None else R.n1(day["online"]) + "%",
                         "", R.verdict((day.get("online") or 0) >= 99.9, "full day online"
                                       if (day.get("online") or 0) >= 99.9
                                       else f"offline {R.n0(day.get('offmin'))} min")),
                   R.kpi("Time offline", f"{R.n0(day.get('offmin'))} <small>min</small>"))
            + R.note("Zomato tells us the total minutes offline per day, never the clock times. If a day shows big "
                     "offline minutes, ask the store what happened; the export cannot say when."))
        + R.period(wk_label,
            R.chart([t.get("offmin") for t in trend], tlabels, tips=ttips,
                    title="Minutes offline per day (0 = fully online)", unit=" min", lo=0, dec=0)))

    # 2. Did you accept what came?
    body += R.sec("2", "Did you accept what came?",
        R.period(day_label,
            R.krow(R.kpi("Rejected by the store", R.n0(day.get("srej")), "",
                         R.verdict((day.get("srej") or 0) == 0,
                                   "accepted everything" if (day.get("srej") or 0) == 0
                                   else f"{R.money(det.get('stockout_day'))} of orders turned away")))
            + R.rows(["Time", "Why it was rejected", "What the customer had ordered", "Value lost"],
                     [[R.esc(r.get("time") or ""), R.tag(r.get("reason")), R.basket(r.get("basket")),
                       R.money(r.get("value"))] for r in (det.get("rejections_day") or [])],
                     "No store-caused rejections yesterday."))
        + R.period(wk_label,
            R.krow(R.kpi("Rejected this week", R.n0(wk.get("srej")),
                         f"{R.money(det.get('stockout_wk'))} of orders turned away"))
            + R.chart([t.get("srej") for t in trend], tlabels, tips=ttips,
                      title="Store-caused rejections per day", lo=0, dec=0)
            + R.fold("Rejections earlier this week, before yesterday", len(det.get("rejections_wk") or []),
                     R.rows(["Day", "Time", "Why", "What the customer had ordered", "Value lost"],
                            [[R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""), R.tag(r.get("reason")),
                              R.basket(r.get("basket")), R.money(r.get("value"))]
                             for r in (det.get("rejections_wk") or [])]))
            + R.note("Cancellations caused by the customer or the rider are not listed here and are not counted "
                     f"against the store ({R.n0(det.get('other_cancels_wk'))} this week).")))

    # 3. Was it right?
    comps_day = det.get("complaints_day") or []
    comps_wk = det.get("complaints_wk") or []
    tags = {}
    for r in comps_wk:
        t = r.get("tag") or "reason not tagged by Zomato"
        tags[t] = tags.get(t, 0) + 1
    chips = "".join(f'<button class="rfilter" data-reason="{R.esc(t)}" data-target="comp-wk" type="button">'
                    f"{R.esc(t)}: <b>{c}</b></button>" for t, c in sorted(tags.items(), key=lambda kv: -kv[1]))
    chips += '<button class="rfilter on" data-reason="" data-target="comp-wk" type="button">Show all</button>'
    body += R.sec("3", "Was it right?",
        R.period(day_label,
            R.krow(R.kpi("Complaints (Zomato official)", R.n0(day.get("comps")), "",
                         R.verdict((day.get("comps") or 0) == 0,
                                   "no complaints" if (day.get("comps") or 0) == 0
                                   else f"{R.n0(day.get('comps'))} on {R.n0(day.get('orders'))} orders "
                                        f"({R.n1(day.get('cpct'))}%)")),
                   R.kpi("Customers reporting an issue", str(len(comps_day)),
                         "Zomato counts only some as official complaints"))
            + R.tlabel("Every order with an issue yesterday, with its tag")
            + R.rows(["Time", "Tag on the order", "What was in the order", "What the customer wrote",
                      "Refunded"],
                     [[R.esc(r.get("time") or ""), R.tag(r.get("tag")), R.basket(r.get("basket")),
                       R.words(r.get("review")),
                       R.money(r["refund"]) if r.get("refund") else "-"] for r in comps_day],
                     "No issues reported yesterday."))
        + R.period(wk_label,
            R.krow(R.kpi("Complaints this week (Zomato official)", R.n0(reasons.get("comps"))),
                   R.kpi("Orders with a reported issue", str(len(comps_day) + len(comps_wk)),
                         f"{len(comps_wk)} of them before yesterday, listed below"))
            + R.chart([t.get("comps") for t in trend], tlabels, tips=ttips,
                      title="Complaints per day", lo=0, dec=0)
            + R.tlabel("Zomato&rsquo;s reason counts for the week (their own daily figures)")
            + R.hbar([("Poor taste or quality", reasons.get("quality") or 0),
                      ("Poor packaging or spillage", reasons.get("packaging") or 0),
                      ("Items missing", reasons.get("missing") or 0),
                      ("Wrong items", reasons.get("wrong") or 0),
                      ("Delivered late", reasons.get("late") or 0)])
            + R.tlabel("Orders before yesterday that you can open, grouped by the tag on the order. "
                       "Click a tag to filter.")
            + f'<div class="rfilters">{chips}</div>'
            + R.fold("Orders with issues earlier this week", len(comps_wk),
                     R.rows(["Day", "Time", "Tag on the order", "What was in the order",
                             "What the customer wrote", "Refunded"],
                            [[R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""), R.tag(r.get("tag")),
                              R.basket(r.get("basket")), R.words(r.get("review")),
                              R.money(r["refund"]) if r.get("refund") else "-"]
                             for r in comps_wk],
                            table_id="comp-wk",
                            row_attrs=[f' data-reason="{R.esc(r.get("tag") or "reason not tagged by Zomato")}"'
                                       for r in comps_wk]),
                     open_=True)
            + R.note("Two counts, two sources, both true: Zomato&rsquo;s official complaint figure comes from their "
                     "daily report, while the list is every order where a customer raised something. Zomato tags a "
                     "reason on only some orders, so the tag counts are smaller than their daily totals. Nothing is "
                     "hidden: untagged orders are listed too.")))

    # 4. Was it fast, and was "ready" honest?
    fr_day = det.get("false_ready_day") or []
    fr_wk = det.get("false_ready_wk") or []
    w3d, dd = det.get("waits3_day") or 0, det.get("delivered_day") or 0
    body += R.sec("4", "Was it fast, and was &quot;ready&quot; honest?",
        R.period(day_label,
            R.krow(R.kpi("Avg rider wait at counter",
                         ("-" if day.get("wait") is None else R.n1(day["wait"])) + " <small>min</small>", "",
                         R.verdict((day.get("wait") if day.get("wait") is not None else 9) < 1.5,
                                   "riders picked up fast (goal: under 1.5 min)"
                                   if (day.get("wait") if day.get("wait") is not None else 9) < 1.5
                                   else "riders waited too long (goal: under 1.5 min)")),
                   R.kpi("Rider waited 3+ min", f"{R.n0(w3d)} <small>of {R.n0(dd)} timed</small>",
                         "counted only on orders where Zomato timestamped the rider",
                         R.verdict(w3d <= max(2, dd * 0.03), "within the normal 3%"
                                   if w3d <= max(2, dd * 0.03) else "above the normal 3% of orders")),
                   R.kpi("&quot;Ready&quot; pressed early, rider left waiting", str(len(fr_day)), "",
                         R.verdict(len(fr_day) == 0, "the ready button was honest" if not fr_day
                                   else "pressed ready before the food was ready")))
            + R.fold("Yesterday&rsquo;s false ready-presses, order by order", len(fr_day),
                     R.rows(["Time", "Marked ready after", "Rider then waited", "What was in the order"],
                            [[R.esc(r.get("time") or ""), f"{R.n0(r.get('ready_secs'))} sec",
                              f"{R.n1(r.get('waited_min'))} min", R.basket(r.get("basket"))] for r in fr_day]),
                     open_=True))
        + R.period(wk_label,
            R.krow(R.kpi("False ready-presses this week", R.n0(wk.get("fr")), "",
                         R.verdict((wk.get("fr") or 0) <= 5, "rare" if (wk.get("fr") or 0) <= 5
                                   else "a habit, not an accident: raise it with the team")),
                   R.kpi("Riders kept waiting 3+ min", R.n0(det.get("waits3_wk"))))
            + R.chart([t.get("wait") for t in trend], tlabels, tips=ttips,
                      title="Average rider wait per day", unit=" min", lo=0)
            + R.fold("Worst false ready-presses earlier this week", len(fr_wk),
                     R.rows(["Day", "Time", "Marked ready after", "Rider then waited", "What was in the order"],
                            [[R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""),
                              f"{R.n0(r.get('ready_secs'))} sec", f"{R.n1(r.get('waited_min'))} min",
                              R.basket(r.get("basket"))] for r in fr_wk]))
            + R.note("Why this matters: pressing ready early looks fast on Zomato&rsquo;s screens but makes riders "
                     "wait, delays other orders and risks penalties. Kitchen preparation time is shown nowhere: we "
                     "verified it only measures how fast the tablet button is pressed. Rider wait is the honest "
                     "speed measure, cross-checked across two independent Zomato feeds.")))

    # 5. What did mistakes cost?
    total_loss = (det.get("refunds_wk") or 0) + (det.get("stockout_wk") or 0)
    body += R.sec("5", "What did mistakes cost?",
        R.period("Yesterday and the week together",
            R.rows(["What cost money", "Yesterday", "Last 7 days", "What it means"],
                   [["Refunds to customers", R.money(det.get("refunds_day")), R.money(det.get("refunds_wk")),
                     "charged back to the restaurant for complaints"],
                    ["Orders turned away", R.money(det.get("stockout_day")), R.money(det.get("stockout_wk")),
                     "value of store-rejected orders (section 2 lists them)"]])
            + R.krow(R.kpi("Total avoidable loss, 7 days", R.money(total_loss), "",
                           R.verdict(total_loss < 1000, "small" if total_loss < 1000
                                     else "this is the number to bring down: both lines are store-controllable")))
            + R.note("Every rupee here ties to a specific order listed in sections 2 and 3; nothing is an estimate.")))

    # 6. Scoreboard
    league = sorted(all_stores, key=lambda x: x.get("dayRank") or 99)
    shown = league[:5] + ([s] if (s.get("dayRank") or 99) > 5 else [])
    body += R.sec("6", "Scoreboard",
        R.period(day_label,
            R.krow(R.kpi("Food rating", (R.n1(day["rating"]) if day.get("rating") else "-") + " <small>/ 5</small>",
                         f"{len(det.get('rated_day') or [])} orders rated; every rating is listed so none hides"))
            + R.rows(["Time", "Stars", "What was in the order", "What the customer wrote"],
                     [[R.esc(r.get("time") or ""), R.esc(str(r.get("rating") or "-")), R.basket(r.get("basket")),
                       R.words(r.get("review"))]
                      for r in (det.get("rated_day") or [])], "No orders rated yesterday.")
            + R.tlabel("Network league for this day: top 5 plus this store (bold). Ranked by complaints + "
                       "rejections + offline, lower is better.")
            + R.rows(["#", "Store", "AM", "Orders", "Complaints", "Online %", "Rating"],
                     [[str(x.get("dayRank") or "-"),
                       (f"<b>{R.esc(x['code'])}</b>" if x["code"] == s["code"] else R.store_link(x["code"], date)),
                       R.esc(x.get("am") or ""), R.n0(x["day"].get("orders")), R.n0(x["day"].get("comps")),
                       "-" if x["day"].get("online") is None else R.n1(x["day"]["online"]),
                       R.n1(x["day"]["rating"]) if x["day"].get("rating") else "-"] for x in shown]))
        + R.period(wk_label,
            R.chart([(t.get("rating") if (t.get("rating") or 0) > 0 else None) for t in trend], tlabels, tips=ttips,
                    title="Average rating per day (few orders are rated, so this swings)", lo=1, hi=5)
            + R.fold("Every 1 and 2-star order of the week", len(det.get("low_ratings_wk") or []),
                     R.rows(["Day", "Time", "Stars", "What was in the order", "What the customer wrote",
                             "Complaint tag if any"],
                            [[R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""),
                              R.esc(str(r.get("rating") or "-")), R.basket(r.get("basket")),
                              R.words(r.get("review")), R.tag(r["tag"]) if r.get("tag") else "-"]
                             for r in (det.get("low_ratings_wk") or [])]))))

    meal = det.get("mealtime_wk") or {}
    total = sum(meal.values())
    if total:
        names = [("Dinner", "Dinner (7 to 11 pm)"), ("Lunch", "Lunch (11 am to 4 pm)"),
                 ("Snacks", "Snacks (4 to 7 pm)"), ("Late night", "Late night (11 pm to 7 am)"),
                 ("Breakfast", "Breakfast (7 to 11 am)")]
        body += R.sec("+", "When your orders come (staffing and prep)",
                      R.hbar([(label, round(100 * meal.get(k, 0) / total)) for k, label in names])
                      + R.note("Share of this store&rsquo;s orders over the 7 days, as a percentage."))

    body += R.footer_html("Ads, discounts and customer types are managed centrally and are deliberately absent "
                          "from this page.")
    return R.page(f"Store Daily: {s['code']}", body)


# ---------------------------------------------------------------- area (v2)
def area_page(am, mine, A, all_stores, areas, date):
    dshort = R.short_label(date)
    wk_label = R.week_label(A["week_start"], date)
    tot = lambda f: sum((f(s) or 0) for s in mine)
    money_by = {m["code"]: m["total_wk"] for m in (A.get("money_stores") or [])}
    money_wk = sum(money_by.values())
    today = [r for r in (A.get("complaints") or []) if r.get("today")]
    rej_t = [r for r in (A.get("rejections") or []) if r.get("today")]
    rej_w = [r for r in (A.get("rejections") or []) if not r.get("today")]
    comp_w = [r for r in (A.get("complaints") or []) if not r.get("today")][:60]
    low_t = [r for r in (A.get("low_ratings") or []) if r.get("today")]
    low_w = [r for r in (A.get("low_ratings") or []) if not r.get("today")]

    need = []
    dips = A.get("online_dips") or []
    if dips:
        w = dips[0]
        need.append(f"<b>{R.esc(w['code'])} was not fully online</b> ({R.n1(w['online_day'])}%, "
                    f"{R.n0(w['offmin_day'])} min offline). Ask what happened at the tablet; section 2 shows the week.")
    if A.get("shut_stores"):
        w = A["shut_stores"][0]
        sv = sum((r.get("value") or 0) for r in A["shut_orders"])
        need.append(f"<b>{R.esc(w['code'])} turned away {R.n0(w['orders'])} orders because the shop was shut</b> on "
                    f"{w['days']} separate {'days' if w['days'] > 1 else 'day'}, and it was showing as open on "
                    f"Zomato each time. {R.money(sv)} across your area this week. Section 3 gives the times of day.")
    if A.get("fr_stores"):
        f = A["fr_stores"][0]
        need.append(f"<b>{R.esc(f['code'])} pressed &quot;ready&quot; early on {R.n0(f['fr_wk'])} orders this week</b> "
                    f"({R.pct(f.get('pct'))} of its delivered orders). Section 8 lists the worst ones.")
    if A.get("money_stores"):
        m = A["money_stores"][0]
        need.append(f"<b>{R.esc(m['code'])} lost {R.money(m['total_wk'])} this week</b> "
                    f"({R.money(m['stockout_wk'])} turned-away orders + {R.money(m['refunds_wk'])} refunds). "
                    "Section 9 has the split per store.")
    best = sorted(mine, key=lambda s: s.get("dayRank") or 99)[0]
    if best.get("dayRank"):
        need.append(f"<b>Good news to pass on:</b> {R.esc(best['code'])} ranks {best['dayRank']} of "
                    f"{len(all_stores)} network-wide for this day.")

    body = R.masthead("Creme Castle &middot; Area Daily &middot; Zomato", f"{R.esc(am)}&rsquo;s area",
                      f"{len(mine)} stores", R.date_label(date),
                      R.settled_note() + " Every number below names the outlet and lists the orders behind it.")
    body += R.context(
        R.tile("Orders", R.n0(tot(lambda s: s["day"].get("orders"))), f"across {len(mine)} stores"),
        R.tile("Complaints", R.n0(tot(lambda s: s["day"].get("comps"))),
               f"{len(today)} orders had an issue"),
        R.tile("Store rejections", R.n0(tot(lambda s: s["day"].get("srej"))),
               f"{len(rej_t)} orders turned away"),
        R.tile("Money lost, week", R.money(money_wk), "stockouts + refunds"),
    )
    body += R.actions("Where you are needed", need[:5])

    # 1. the compact store table
    def store_row(s):
        d = s["day"]
        p = (round(100.0 * (d["orders"] - d["avgord"]) / d["avgord"])
             if d.get("orders") is not None and d.get("avgord") else None)
        vs = ("-" if p is None else R.goodv(f"+{p}%") if p >= 10
              else (f'<span class="flag">{p}%</span>' if p <= -15 else ("+" if p >= 0 else "") + f"{p}%"))
        return [str(s.get("dayRank") or "-"), R.store_link(s["code"], date), R.n0(d.get("orders")), vs,
                R.flag("-" if d.get("online") is None else R.n2(d["online"]),
                       (d["online"] if d.get("online") is not None else 100) < 99.9),
                R.flag(R.n0(d.get("srej")), (d.get("srej") or 0) > 0),
                R.flag(R.n0(d.get("comps")), (d.get("comps") or 0) >= 3),
                R.n1(d["rating"]) if d.get("rating") else "-",
                R.flag("-" if d.get("wait") is None else R.n1(d["wait"]), (d.get("wait") or 0) >= 2)]
    body += R.sec("1", f"Your stores on {R.esc(dshort)}",
        R.period(f"Ranked worst-first for {dshort}",
            R.rows(["#", "Store", "Orders", "vs avg", "Online %", "Rej", "Comp", "Rating", "Wait"],
                   [store_row(s) for s in sorted(mine, key=lambda s: s.get("dayRank") or 99)], sortable=True)
            + R.note("Ranked by complaints + rejections + offline, lower is better. Red marks a number worth a "
                     "question. Store names open the store page.")))

    # 2. offline dips
    cards = []
    for dp in dips:
        ser = [p["online"] for p in dp["series"]]
        labs = [p["d"][-2:] for p in dp["series"]]
        tps = [datetime.strptime(p["d"], "%Y-%m-%d").strftime("%a %-d %b") for p in dp["series"]]
        cards.append(f'<div class="minicard"><div class="mtitle">{R.esc(dp["code"])}</div>'
                     f'<div class="mval">{R.n2(dp["online_day"])}% <small>on {R.esc(dshort)}</small></div>'
                     f'<div class="mnote">{R.n0(dp["offmin_day"])} min offline that day &middot; '
                     f'{R.n0(dp["offmin_wk"])} min across the week</div>'
                     + R.chart(ser, labs, tips=tps, title="Online % per day (day of month)", unit="%",
                               lo=min(90, min(ser)) - 1, hi=100, width=280, height=96) + "</div>")
    body += R.sec("2", "Outlets not fully online",
        R.period(f"{dshort} dips, with their 7-day line",
            (f'<div class="minigrid">{"".join(cards)}</div>' if cards
             else R.note("Every store was fully online on this day."))
            + R.note("Zomato reports total minutes offline per day, never the clock times.")))

    # 3. the shut-shop tracker
    body += R.sec("3", "Orders turned away because the shop was shut",
        R.shut_shop(A, dshort, wk_label, show_am=False, date=date),
        lead="The one number on this page that should be zero. Zomato does not send an order to a store it thinks "
             "is closed, so each of these is a shop whose listing was live while it could not serve. Section 2 is "
             "the opposite case, the listing itself going down.")

    # 4. rejections
    body += R.sec("4", "Rejected orders",
        R.period(dshort,
            R.rows(["Store", "Time", "Reason", "What the customer had ordered", "Value lost"],
                   [[R.store_link(r["code"], date), R.esc(r.get("time") or ""), R.tag(r.get("reason")),
                     R.basket(r.get("basket")), R.money(r.get("value"))] for r in rej_t],
                   "No store-caused rejections on this day."))
        + R.period(wk_label,
            R.fold("Rejections earlier this week", len(rej_w),
                   R.rows(["Store", "Day", "Time", "Reason", "What the customer had ordered", "Value lost"],
                          [[R.store_link(r["code"], date), R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""),
                            R.tag(r.get("reason")), R.basket(r.get("basket")), R.money(r.get("value"))]
                           for r in rej_w]))
            + R.note("Only store-caused rejections are listed, in the order feed&rsquo;s own words: <b>items out of "
                     "stock, kitchen is full, restaurant is closed, timeout, unavailable to accept</b>. Customer and "
                     "rider cancellations are excluded.")))

    # 5. complaints
    tags = {}
    for r in comp_w:
        tags[r.get("tag") or ""] = tags.get(r.get("tag") or "", 0) + 1
    chips = "".join(f'<button class="rfilter" data-reason="{R.esc(t)}" data-target="area-cw" type="button">'
                    f"{R.esc(t)}: <b>{c}</b></button>" for t, c in sorted(tags.items(), key=lambda kv: -kv[1]))
    chips += '<button class="rfilter on" data-reason="" data-target="area-cw" type="button">Show all</button>'
    comp_cols = ["Store", "Time", "Tag on the order", "What was in the order",
                 "What the customer wrote", "Refunded"]
    body += R.sec("5", "Complaints",
        R.period(dshort,
            (R.rows(comp_cols,
                    [[R.store_link(r["code"], date), R.esc(r.get("time") or ""), R.tag(r.get("tag")),
                      R.basket(r.get("basket")), R.words(r.get("review")),
                      R.money(r["refund"]) if r.get("refund") else "-"] for r in today],
                    "No issues reported on this day.")
             if len(today) <= 25 else
             R.fold(f"Every order with an issue on {R.esc(dshort)}", len(today),
                    R.rows(comp_cols,
                           [[R.store_link(r["code"], date), R.esc(r.get("time") or ""), R.tag(r.get("tag")),
                             R.basket(r.get("basket")), R.words(r.get("review")),
                             R.money(r["refund"]) if r.get("refund") else "-"]
                            for r in today]), open_=True)))
        + R.period(wk_label,
            f'<div class="rfilters">{chips}</div>'
            + R.fold("Complaints earlier this week (newest 60)", len(comp_w),
                     R.rows(["Store", "Day", "Time", "Tag on the order", "What was in the order",
                             "What the customer wrote", "Refunded"],
                            [[R.store_link(r["code"], date), R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""),
                              R.tag(r.get("tag")), R.basket(r.get("basket")), R.words(r.get("review")),
                              R.money(r["refund"]) if r.get("refund") else "-"] for r in comp_w],
                            table_id="area-cw",
                            row_attrs=[f' data-reason="{R.esc(r.get("tag") or "")}"' for r in comp_w]))
            + R.note("Tags come from the order itself; Zomato leaves many untagged, and those are listed too.")))

    # 6. low ratings
    body += R.sec("6", "1, 2 and 3-star orders",
        R.period(dshort,
            R.rows(["Store", "Time", "Stars", "What was in the order", "What the customer wrote",
                    "Complaint tag if any"],
                   [[R.store_link(r["code"], date), R.esc(r.get("time") or ""), R.esc(str(r.get("rating") or "-")),
                     R.basket(r.get("basket")), R.words(r.get("review")),
                     R.tag(r["tag"]) if r.get("tag") else "-"] for r in low_t],
                   "No low-rated orders on this day."))
        + R.period(wk_label,
            R.fold("Low-rated orders earlier this week", len(low_w),
                   R.rows(["Store", "Day", "Time", "Stars", "What was in the order",
                           "What the customer wrote", "Complaint tag if any"],
                          [[R.store_link(r["code"], date), R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""),
                            R.esc(str(r.get("rating") or "-")), R.basket(r.get("basket")),
                            R.words(r.get("review")), R.tag(r["tag"]) if r.get("tag") else "-"] for r in low_w]))
            + R.note("Only a small share of orders get rated, so treat each one as a specific customer, not a "
                     "percentage.")))

    # 7. rider wait
    body += R.sec("7", "Where riders wait",
        R.period(f"Worst first, {wk_label.lower()}",
            R.rows(["Store", f"Wait on {R.esc(dshort)}", "Wait, week", "Orders kept 3+ min", "Delivered",
                    "Share 3+ min"],
                   [[R.store_link(w["code"], date),
                     R.flag(R.n1(w.get("wait_day")), (w.get("wait_day") or 0) >= 2),
                     R.flag(R.n1(w.get("wait_wk")), (w.get("wait_wk") or 0) >= 2),
                     R.n0(w["waits3_wk"]), R.n0(w["delivered_wk"]),
                     R.flag(R.pct(w.get("pct3")), (w.get("pct3") or 0) >= 15)]
                    for w in (A.get("wait_stores") or []) if w["delivered_wk"]])
            + R.note("Goal is under 1.5 minutes average and under 3% of orders kept waiting. Rider wait is the "
                     "verified speed measure; Zomato&rsquo;s kitchen time is excluded because it only tracks how "
                     "fast the tablet button is pressed.")))

    # 8. false ready
    body += R.sec("8", "&quot;Ready&quot; pressed before the food was ready",
        R.period("By store, worst first",
            R.rows(["Store", f"On {R.esc(dshort)}", "This week", "Delivered", "Share of orders"],
                   [[R.store_link(f["code"], date), R.n0(f["fr_day"]), R.n0(f["fr_wk"]), R.n0(f["delivered_wk"]),
                     R.flag(R.pct(f.get("pct")), (f.get("pct") or 0) >= 5)] for f in (A.get("fr_stores") or [])],
                   "No false ready-presses this week."))
        + R.period("The worst 20 orders of the week",
            R.fold("Order by order", len(A.get("fr_orders") or []),
                   R.rows(["Store", "Day", "Time", "Marked ready after", "Rider then waited",
                           "What was in the order"],
                          [[R.store_link(r["code"], date), R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""),
                            f"{R.n0(r.get('ready_secs'))} sec", f"{R.n1(r.get('waited_min'))} min",
                            R.basket(r.get("basket"))] for r in (A.get("fr_orders") or [])]))
            + R.note("These are orders marked ready within a minute of accepting where the rider then waited "
                     "3+ minutes.")))

    # 9. money lost
    body += R.sec("9", "Money lost, by store",
        R.period(wk_label,
            R.rows(["Store", "Turned-away orders", "Rejections", "Refunds", "Complaints", "Total lost"],
                   [[R.store_link(m["code"], date), R.money(m["stockout_wk"]), R.n0(m["rej_wk"]),
                     R.money(m["refunds_wk"]), R.n0(m["comp_wk"]), f"<b>{R.money(m['total_wk'])}</b>"]
                    for m in (A.get("money_stores") or [])],
                   "Nothing lost to rejections or refunds this week.")
            + R.note("Every rupee ties to an order listed in sections 4 and 5. Nothing here is an estimate.")))

    # 10. area versus area, the same table the central page opens with, so an
    # AM sees their area in the network's terms without needing the central page
    def arow(a, i, view):
        cp = a["d_cpct"] if view == "day" else a["w_cpct"]
        row = [str(i + 1),
               (f"<b>{R.esc(a['am'])}</b>" if a["am"] == am else R.area_link(a["am"], date)),
               str(a["stores"]), R.n0(a["d_orders"] if view == "day" else a["w_orders"]),
               R.n2(cp), R.n0(a["d_srej"] if view == "day" else a["w_srej"]),
               f"{R.n0(a['d_off'] if view == 'day' else a['w_off'])} min"]
        if view == "wk":
            row += [R.n0(a["w_fr"]), R.money(a["w_money"])]
        return row
    day_sorted = sorted(areas, key=lambda a: a["d_cpct"] if a["d_cpct"] is not None else 99)
    wk_sorted = sorted(areas, key=lambda a: a["w_cpct"] if a["w_cpct"] is not None else 99)
    body += R.sec("10", "Area versus area",
        R.period(dshort,
            R.rows(["#", "Area manager", "Stores", "Orders", "Complaints %", "Store rejections", "Offline"],
                   [arow(a, i, "day") for i, a in enumerate(day_sorted)], sortable=True))
        + R.period(wk_label,
            R.rows(["#", "Area manager", "Stores", "Orders", "Complaints %", "Store rejections", "Offline",
                    "False ready", "Money lost"],
                   [arow(a, i, "wk") for i, a in enumerate(wk_sorted)], sortable=True)
            + R.note("Ranked by complaint rate for the period shown, best first. Your area is in bold.")))

    body += R.footer_html("Store names open that store&rsquo;s own page in the portal.")
    return R.page(f"Area Daily: {am}", body)


# ------------------------------------------------------------- central (v1)
def central_page(data, D, areas, date):
    stores = data["stores"]
    dshort = R.short_label(date)
    wk_label = R.week_label(D["week_start"], date)
    lev = data.get("levers") or {}
    segd, segw = lev.get("seg_day") or {}, lev.get("seg_wk") or {}
    adsw = lev.get("ads_wk") or {}
    reasons = data.get("reasons_wk") or {}
    tot = lambda f, xs=None: sum((f(s) or 0) for s in (stores if xs is None else xs))

    money_by = {m["code"]: m["total_wk"] for m in (D.get("money_stores") or [])}
    money_wk = sum(money_by.values())
    orders_d, orders_w = tot(lambda s: s["day"].get("orders")), tot(lambda s: s["wk"].get("orders"))
    comps_d, comps_w = tot(lambda s: s["day"].get("comps")), tot(lambda s: s["wk"].get("comps"))
    srej_d, srej_w = tot(lambda s: s["day"].get("srej")), tot(lambda s: s["wk"].get("srej"))
    fr_w = tot(lambda s: s["wk"].get("fr"))
    delivered_w, waits3_w = tot(lambda s: s["wk"].get("delivered")), tot(lambda s: s["wk"].get("waits3"))
    offmin_d = tot(lambda s: s["day"].get("offmin"))
    cpct_d = 100.0 * comps_d / orders_d if orders_d else None
    cpct_w = 100.0 * comps_w / orders_w if orders_w else None
    avg_day = round(orders_w / 7.0) if orders_w else 0

    trend = D.get("trend") or []
    labels = [t["d"][-2:] for t in trend]
    tips = [datetime.strptime(t["d"], "%Y-%m-%d").strftime("%a %-d %b") for t in trend]
    waits = [t["wait"] for t in trend if t.get("wait") is not None]
    wait_day = trend[-1]["wait"] if trend else None
    wait_wk = sum(waits) / len(waits) if waits else None
    online_day = trend[-1]["online"] if trend else None
    pct3 = 100.0 * waits3_w / delivered_w if delivered_w else None

    rej_t = [r for r in (D.get("rejections") or []) if r.get("today")]
    rej_w = [r for r in (D.get("rejections") or []) if not r.get("today")]
    comp_t = [r for r in (D.get("complaints") or []) if r.get("today")]
    comp_w_all = [r for r in (D.get("complaints") or []) if not r.get("today")]
    comp_w = comp_w_all[:120]
    low_t = [r for r in (D.get("low_ratings") or []) if r.get("today")]
    low_w_all = [r for r in (D.get("low_ratings") or []) if not r.get("today")]
    low_w = low_w_all[:100]
    untagged = len([r for r in comp_t if r.get("tag") == "reason not tagged by Zomato"])

    body = R.masthead("Creme Castle &middot; Network Daily &middot; Zomato &middot; Central Team",
                      "The whole network", f"{len(stores)} stores, {len(areas)} areas",
                      R.date_label(date),
                      R.settled_note() + " Central&rsquo;s question is not &ldquo;what happened here&rdquo; but "
                      "&ldquo;where do I put pressure, and which lever do I pull&rdquo;, so every number below "
                      "names its outlet AND its area manager, and every lever lists the stores behind it.")

    pc = lambda a, b: (100.0 * a / b) if b else None
    body += R.context(
        R.vtile("Orders", R.n0(orders_d), f"{R.n0(avg_day)} a day across the week", orders_d >= avg_day,
                f"{'+' if orders_d >= avg_day else ''}{round(100.0 * (orders_d - avg_day) / (avg_day or 1))}% "
                "on the week&rsquo;s daily average"),
        R.vtile("Net sales", R.lakh(segd.get("net_sales")), f"subtotal {R.lakh(segd.get('subtotal'))}",
                (segd.get("net_sales") or 0) >= (segw.get("net_sales") or 0) / 7,
                f"{'+' if (segd.get('net_sales') or 0) >= (segw.get('net_sales') or 0) / 7 else ''}"
                f"{round(100.0 * ((segd.get('net_sales') or 0) - (segw.get('net_sales') or 0) / 7) / (((segw.get('net_sales') or 0) / 7) or 1))}"
                "% on the week&rsquo;s daily average"),
        R.vtile("Complaints (Zomato's count)", f"{R.n0(comps_d)} <small>({R.n2(cpct_d)}%)</small>",
                f"{R.n0(len(comp_t))} order rows carry a complaint flag: section 7",
                (cpct_d or 0) <= (cpct_w or 0), f"against {R.n2(cpct_w)}% for the week"),
        R.vtile("Store rejections (Zomato's count)", R.n0(srej_d),
                f"{R.n0(len(rej_t))} order rows name a store reason: section 6",
                srej_d == 0, f"{R.n0(srej_w)} in the week, goal is zero"),
        R.vtile("Rider wait", f"{R.n1(wait_day)} min", f"{R.n1(wait_wk)} min across the week",
                (wait_day if wait_day is not None else 9) < 1.5, "goal is under 1.5 min"),
        R.vtile("Online", f"{R.n2(online_day)}%", f"{R.n0(offmin_d)} min offline network-wide",
                offmin_d == 0, "goal is 100%: offline is a closed shop"),
        R.vtile("Money lost, week", R.money(money_wk), "stockouts + refunds", money_wk == 0,
                "goal is zero: every rupee ties to an order"),
        R.vtile("False ready, week", R.n0(fr_w), f"{R.n1(pc(fr_w, delivered_w))}% of delivered orders",
                fr_w == 0, "goal is zero, the button means food is out"),
    )

    att = []
    dips = D.get("online_dips") or []
    if dips:
        dp = dips[0]
        att.append(f"<b>{R.esc(dp['code'])} ({R.esc(dp['am'])}&rsquo;s area) lost {R.n0(dp['offmin_day'])} minutes "
                   f"of trading</b>: online {R.n2(dp['online_day'])}% on {R.esc(dshort)}. Section 4 shows its week.")
    hot = sorted([s for s in stores if (s["day"].get("comps") or 0) >= 3],
                 key=lambda s: -(s["day"].get("cpct") or 0))
    if hot:
        h = hot[0]
        att.append(f"<b>{R.esc(h['code'])} ({R.esc(h.get('am') or '')}&rsquo;s area) is the day&rsquo;s complaint "
                   f"hotspot</b>: {R.n0(h['day']['comps'])} complaints on {R.n0(h['day'].get('orders'))} orders "
                   f"({R.n1(h['day'].get('cpct'))}%, against {R.n2(cpct_d)}% for the network). Section 7 lists "
                   "every one of them.")
    by_cpct = sorted(areas, key=lambda a: a["d_cpct"] if a["d_cpct"] is not None else 99)
    if len(by_cpct) > 1:
        worst, best_a = by_cpct[-1], by_cpct[0]
        att.append(f"<b>{R.esc(worst['am'])}&rsquo;s area has the day&rsquo;s worst complaint rate</b> "
                   f"({R.n2(worst['d_cpct'])}% on {R.n0(worst['d_orders'])} orders across {worst['stores']} stores) "
                   f"and {R.esc(best_a['am'])}&rsquo;s the best ({R.n2(best_a['d_cpct'])}%). Section 2 puts the five "
                   "side by side.")
    if D.get("fr_stores"):
        f = D["fr_stores"][0]
        att.append(f"<b>&quot;Ready&quot; is being pressed before the food exists</b>: {R.n0(fr_w)} orders "
                   f"network-wide this week, worst is {R.esc(f['code'])} ({R.esc(f['am'])}&rsquo;s area) with "
                   f"{R.n0(f['fr_wk'])}, {R.pct(f.get('pct'))} of everything it delivered. Section 10 names them.")
    if D.get("money_stores"):
        m = D["money_stores"][0]
        att.append(f"<b>{R.money(money_wk)} of trade was lost to rejections and refunds this week</b>; the largest "
                   f"single loser is {R.esc(m['code'])} ({R.esc(m['am'])}&rsquo;s area) at {R.money(m['total_wk'])}. "
                   "Section 11 splits it per store.")
    if D.get("shut_orders"):
        sv = sum((r.get("value") or 0) for r in D["shut_orders"])
        w = D["shut_stores"][0]
        att.append(f"<b>{R.n0(len(D['shut_orders']))} orders were turned away because the shop was shut</b> "
                   f"({R.money(sv)} this week), worst is {R.esc(w['code'])} ({R.esc(w['am'])}&rsquo;s area) on "
                   f"{w['days']} separate {'days' if w['days'] > 1 else 'day'}. Every one of those stores was "
                   "showing as open on Zomato at the time. Section 5 lists them by store and by hour.")
    best = next((s for s in stores if s.get("dayRank") == 1), None)
    if best:
        att.append(f"<b>Good news to pass on:</b> {R.esc(best['code'])} ({R.esc(best.get('am') or '')}&rsquo;s area) "
                   f"is the best-run store of the day: {R.n0(best['day'].get('orders'))} orders, "
                   f"{R.n0(best['day'].get('comps'))} complaints, {R.n2(best['day'].get('online'))}% online.")
    body += R.actions("What deserves central attention", att[:7])

    # 1. the network's own week
    body += R.sec("1", "The network&rsquo;s own 7 days",
        R.period(wk_label,
            '<div class="chartgrid">'
            + R.chart([t.get("orders") for t in trend], labels, tips=tips, title="Orders per day", dec=0)
            + R.chart([t.get("cpct") for t in trend], labels, tips=tips,
                      title="Complaints as a % of orders", unit="%", dec=2)
            + R.chart([t.get("online") for t in trend], labels, tips=tips,
                      title=f"Online % (average of the {len(stores)} stores)", unit="%",
                      lo=min([97] + [t["online"] for t in trend if t.get("online") is not None]) - 0.2, hi=100)
            + R.chart([t.get("wait") for t in trend], labels, tips=tips,
                      title="Rider wait, minutes", lo=0)
            + R.chart([t.get("rating") for t in trend], labels, tips=tips,
                      title="Average food rating", dec=2)
            + R.chart([t.get("discount_pct") for t in trend], labels, tips=tips,
                      title="Discount as a % of subtotal", unit="%")
            + "</div>"
            + R.note("Day of the month along the bottom, the full date on hover. Rider wait is blank on any day the "
                     "order-level feed does not reach; nothing is estimated.")),
        lead="Six lines, one idea each. This is the only place on the page where the network is a single number: "
             "everything below it names stores.")

    # 2. area versus area
    def area_rows(view):
        lst = sorted(areas, key=lambda a: (a["d_cpct"] if view == "day" else a["w_cpct"])
                     if (a["d_cpct"] if view == "day" else a["w_cpct"]) is not None else 99)
        out = []
        for i, a in enumerate(lst):
            net = cpct_d if view == "day" else cpct_w
            cp = a["d_cpct"] if view == "day" else a["w_cpct"]
            row = [str(i + 1), R.area_link(a["am"], date), str(a["stores"]),
                   R.n0(a["d_orders"] if view == "day" else a["w_orders"])]
            if view == "day":
                row.append(R.n0(a["d_comps"]))
            row.append(R.flag(R.n2(cp), (cp or 0) > (net or 0)))
            row.append(R.flag(R.n0(a["d_srej"] if view == "day" else a["w_srej"]),
                              (a["d_srej"] if view == "day" else a["w_srej"]) > 0))
            row.append(R.flag(f"{R.n0(a['d_off'] if view == 'day' else a['w_off'])} min",
                              (a["d_off"] if view == "day" else a["w_off"]) > 0))
            if view == "day":
                row.append(R.n1(a["d_rating"]) if a["d_rating"] else "-")
            else:
                row += [R.flag(R.n1(a["w_wait"]), (a["w_wait"] or 0) >= 1.5),
                        R.flag(R.n0(a["w_fr"]), a["w_fr"] > 0), R.money(a["w_money"])]
            out.append(row)
        return out
    body += R.sec("2", "Area versus area",
        R.period(dshort,
            R.rows(["#", "Area manager", "Stores", "Orders", "Complaints", "Complaints %", "Rejections",
                    "Offline", "Rating"], area_rows("day"), sortable=True)
            + R.note("Ranked by complaint rate, best first. Red marks a number above the network&rsquo;s own figure "
                     "for the same day, not a target miss."))
        + R.period(wk_label,
            R.rows(["#", "Area manager", "Stores", "Orders", "Complaints %", "Rejections", "Offline",
                    "Rider wait", "False ready", "Money lost"], area_rows("wk"), sortable=True)
            + R.note("Area manager names open that area&rsquo;s page, where every one of these numbers breaks into "
                     "stores and then into orders.")),
        lead="Five areas, one row each. This is the level central actually acts at: a store is reached through its "
             "area manager.")

    # 3. all stores
    def srow(s, view):
        if view == "day":
            d = s["day"]
            p = (round(100.0 * (d["orders"] - d["avgord"]) / d["avgord"])
                 if d.get("orders") is not None and d.get("avgord") else None)
            vs = ("-" if p is None else R.goodv(f"+{p}%") if p >= 10
                  else (f'<span class="flag">{p}%</span>' if p <= -15 else ("+" if p >= 0 else "") + f"{p}%"))
            return [str(s.get("dayRank") or "-"), R.store_link(s["code"], date), R.esc(s.get("am") or ""),
                    R.n0(d.get("orders")), vs,
                    R.flag("-" if d.get("online") is None else R.n2(d["online"]),
                           (d["online"] if d.get("online") is not None else 100) < 99.9),
                    R.flag(R.n0(d.get("srej")), (d.get("srej") or 0) > 0),
                    R.flag(R.n0(d.get("comps")), (d.get("comps") or 0) >= 3),
                    R.n1(d["rating"]) if d.get("rating") else "-",
                    R.flag("-" if d.get("wait") is None else R.n1(d["wait"]), (d.get("wait") or 0) >= 2),
                    R.flag(R.n0(s["wk"].get("fr")), (s["wk"].get("fr") or 0) >= 40),
                    R.money(money_by.get(s["code"], 0))]
        w = s["wk"]
        cp = pc(w.get("comps") or 0, w.get("orders"))
        return [str(s.get("wkRank") or "-"), R.store_link(s["code"], date), R.esc(s.get("am") or ""),
                R.n0(w.get("orders")), R.n0(round((w.get("orders") or 0) / 7)) if w.get("orders") else "-",
                R.flag("-" if w.get("online") is None else R.n2(w["online"]),
                       (w["online"] if w.get("online") is not None else 100) < 99.9),
                R.flag(R.n0(w.get("srej")), (w.get("srej") or 0) > 0), R.n0(w.get("comps")),
                R.flag(R.n2(cp), (cp or 0) > (cpct_w or 0)),
                R.n1(w["rating"]) if w.get("rating") else "-",
                R.flag("-" if w.get("wait") is None else R.n1(w["wait"]), (w.get("wait") or 0) >= 2),
                R.flag(R.n0(w.get("fr")), (w.get("fr") or 0) >= 40), R.money(money_by.get(s["code"], 0))]
    body += R.sec("3", f"All {len(stores)} stores",
        R.period(f"{dshort}, ranked worst-first",
            R.rows(["#", "Store", "AM", "Orders", "vs avg", "Online %", "Rej", "Comp", "Rating", "Wait",
                    "False ready wk", "Lost wk"],
                   [srow(s, "day") for s in sorted(stores, key=lambda s: s.get("dayRank") or 99)], sortable=True)
            + R.note("Ranked by clean-day score: complaints % + rejections % + offline penalty, lower is better "
                     "(ties by rating, then orders). Red marks a number worth a question, not a verdict."))
        + R.period(wk_label,
            R.fold(f"The same {len(stores)} stores ranked over the 7 days", len(stores),
                   R.rows(["#", "Store", "AM", "Orders", "Per day", "Online %", "Rej", "Comp", "Comp %", "Rating",
                           "Wait", "False ready", "Lost"],
                          [srow(s, "wk") for s in sorted(stores, key=lambda s: s.get("wkRank") or 99)],
                          sortable=True))
            + R.note("The week ranking is the one to use for a conversation about habits; the day ranking is for a "
                     "conversation about yesterday.")),
        lead="One line per store. Worst first, because the top of this table is the work.")

    # 4. offline dips
    cards = []
    for dp in dips:
        ser = [p["online"] for p in dp["series"]]
        labs = [p["d"][-2:] for p in dp["series"]]
        tps = [datetime.strptime(p["d"], "%Y-%m-%d").strftime("%a %-d %b") for p in dp["series"]]
        cards.append(f'<div class="minicard"><div class="mtitle">{R.esc(dp["code"])} '
                     f'<small>&middot; {R.esc(dp["am"])}</small></div>'
                     f'<div class="mval">{R.n2(dp["online_day"])}% <small>on {R.esc(dshort)}</small></div>'
                     f'<div class="mnote">{R.n0(dp["offmin_day"])} min offline that day &middot; '
                     f'{R.n0(dp["offmin_wk"])} min across the week</div>'
                     + R.chart(ser, labs, tips=tps, title="Online % per day (day of month)", unit="%",
                               lo=min(90, min(ser)) - 1, hi=100, width=280, height=96) + "</div>")
    body += R.sec("4", "Outlets not fully online",
        R.period(f"{dshort} dips, each with its own 7-day line",
            (f'<div class="minigrid">{"".join(cards)}</div>' if cards
             else R.note("Every store was fully online on this day."))
            + R.note(f"{len(cards)} of {len(stores)} stores dipped, {R.n0(offmin_d)} minutes of trading lost between "
                     "them on this day alone. Zomato reports total minutes offline per day, never the clock times, "
                     "so the page cannot say when it happened; the store can.")),
        lead="A store that is offline sells nothing and is invisible in every other number on this page. This is "
             "the first section to read.")

    # 5. the shut-shop tracker
    body += R.sec("5", "Orders turned away because the shop was shut",
        R.shut_shop(D, dshort, wk_label, show_am=True, date=date),
        lead="The one number on this page that should be zero. A store cannot be sent an order unless Zomato thinks "
             "it is open, so each of these is a listing that was live while the shop could not serve. Section 4 is "
             "the opposite case, the listing itself going down.")

    # 6. rejections
    rej_val_d = sum((r.get("value") or 0) for r in rej_t)
    rej_val_w = sum((r.get("value") or 0) for r in (D.get("rejections") or []))
    body += R.sec("6", "Rejected orders",
        R.period(dshort,
            R.rows(["Store", "AM", "Time", "Reason", "What the customer had ordered", "Value lost"],
                   [[R.store_link(r["code"], date), R.esc(r["am"]), R.esc(r.get("time") or ""),
                     R.tag(r.get("reason")), R.basket(r.get("basket")), R.money(r.get("value"))] for r in rej_t],
                   "No store-caused rejections on this day.")
            + R.note(f"{R.money(rej_val_d)} of trade turned away on this day."))
        + R.period(wk_label,
            R.fold("Rejections earlier this week", len(rej_w),
                   R.rows(["Store", "AM", "Day", "Time", "Reason", "What the customer had ordered", "Value lost"],
                          [[R.store_link(r["code"], date), R.esc(r["am"]), R.esc(r.get("dlabel") or ""),
                            R.esc(r.get("time") or ""), R.tag(r.get("reason")), R.basket(r.get("basket")),
                            R.money(r.get("value"))] for r in rej_w]))
            + R.note(f"{R.money(rej_val_w)} across the 7 days, every rupee of it an order a customer tried to place. "
                     "Only store-caused rejections are listed, in the order feed&rsquo;s own words: <b>items out of "
                     "stock, kitchen is full, restaurant is closed, timeout, unavailable to accept</b>.")
            + R.note(f"Two counts again, as with complaints. Zomato&rsquo;s daily report counts {R.n0(srej_w)} store "
                     f"rejections for the week; {R.n0(len(D.get('rejections') or []))} order rows carry one of those "
                     "reasons. The list is the shorter of the two because only orders that reached the store appear "
                     "in the order feed. Both are true; never add them together.")),
        lead="A rejection is a customer who wanted to buy and was told no. Each row is one of them.")

    # 7. complaints
    tags = {}
    for r in comp_w:
        tags[r.get("tag") or ""] = tags.get(r.get("tag") or "", 0) + 1
    chips = "".join(f'<button class="rfilter" data-reason="{R.esc(t)}" data-target="cent-cw" type="button">'
                    f"{R.esc(t)}: <b>{c}</b></button>" for t, c in sorted(tags.items(), key=lambda kv: -kv[1]))
    chips += '<button class="rfilter on" data-reason="" data-target="cent-cw" type="button">Show all</button>'
    zsum = R.rows(["Zomato&rsquo;s own reason counts, 7 days", "Complaints"],
                  [[k, R.n0(v)] for k, v in sorted(
                      [("Delivered late", reasons.get("late")), ("Poor taste or quality", reasons.get("quality")),
                       ("Poor packaging or spillage", reasons.get("packaging")),
                       ("Wrong items", reasons.get("wrong")), ("Items missing", reasons.get("missing"))],
                      key=lambda kv: -(kv[1] or 0))])
    body += R.sec("7", "Complaints",
        R.period(dshort,
            R.fold(f"Every order with an issue on {R.esc(dshort)}", len(comp_t),
                   R.rows(["Store", "AM", "Time", "Tag on the order", "What was in the order",
                           "What the customer wrote", "Refunded"],
                          [[R.store_link(r["code"], date), R.esc(r["am"]), R.esc(r.get("time") or ""),
                            R.tag(r.get("tag")), R.basket(r.get("basket")), R.words(r.get("review")),
                            R.money(r["refund"]) if r.get("refund") else "-"] for r in comp_t]),
                   open_=len(comp_t) <= 40))
        + R.period(wk_label,
            f'<div class="rfilters">{chips}</div>'
            + R.fold(f"Complaints earlier this week (newest {len(comp_w)} of {len(comp_w_all)})", len(comp_w),
                     R.rows(["Store", "AM", "Day", "Time", "Tag on the order", "What was in the order",
                             "What the customer wrote", "Refunded"],
                            [[R.store_link(r["code"], date), R.esc(r["am"]), R.esc(r.get("dlabel") or ""),
                              R.esc(r.get("time") or ""), R.tag(r.get("tag")), R.basket(r.get("basket")),
                              R.words(r.get("review")),
                              R.money(r["refund"]) if r.get("refund") else "-"] for r in comp_w],
                            table_id="cent-cw",
                            row_attrs=[f' data-reason="{R.esc(r.get("tag") or "")}"' for r in comp_w]))
            + R.note(f"Filters are built from the tags these ORDER rows actually carry, so a chip always returns "
                     f"rows. The newest {len(comp_w)} are listed here; each store page carries its own full list.")
            + R.period("Zomato’s own count, for comparison only",
                       zsum
                       + R.note("Two counts, two sources, both true. Zomato&rsquo;s official complaint figure comes "
                                f"from their daily report ({R.n0(reasons.get('comps'))} for the week); the tables "
                                f"above list every order where a customer raised something "
                                f"({R.n0(D.get('complaints_total'))} for the week). Zomato tags a reason on only "
                                f"some of them, and {R.n0(untagged)} of the {R.n0(len(comp_t))} orders on "
                                f"{R.esc(dshort)} carry no tag at all. Nothing is hidden: the untagged orders are in "
                                "the list too. Never add the two sources together."))),
        lead="Two vocabularies exist and they are never mixed: the tags on the order rows drive the tables and the "
             "filters; Zomato&rsquo;s daily report is shown separately at the bottom as a read-only summary.")

    # 8. low ratings
    body += R.sec("8", "1, 2 and 3-star orders",
        R.period(dshort,
            R.fold(f"Low-rated orders on {R.esc(dshort)}", len(low_t),
                   R.rows(["Store", "AM", "Time", "Stars", "What was in the order",
                           "What the customer wrote", "Complaint tag if any"],
                          [[R.store_link(r["code"], date), R.esc(r["am"]), R.esc(r.get("time") or ""),
                            R.esc(str(r.get("rating") or "-")), R.basket(r.get("basket")),
                            R.words(r.get("review")), R.tag(r["tag"]) if r.get("tag") else "-"] for r in low_t]),
                   open_=len(low_t) <= 40))
        + R.period(wk_label,
            R.fold(f"Low-rated orders earlier this week (newest {len(low_w)} of {len(low_w_all)})", len(low_w),
                   R.rows(["Store", "AM", "Day", "Time", "Stars", "What was in the order",
                           "What the customer wrote", "Complaint tag if any"],
                          [[R.store_link(r["code"], date), R.esc(r["am"]), R.esc(r.get("dlabel") or ""),
                            R.esc(r.get("time") or ""), R.esc(str(r.get("rating") or "-")),
                            R.basket(r.get("basket")), R.words(r.get("review")),
                            R.tag(r["tag"]) if r.get("tag") else "-"] for r in low_w]))
            + R.note(f"{R.n0(D.get('low_ratings_total'))} low-rated orders in the 7 days. Only a small share of "
                     "orders are rated at all, so treat each row as one specific customer, never as a percentage.")),
        lead="A rating is the only place the customer speaks in their own time. These are the ones who were unhappy "
             "enough to say so.")

    # 9. rider wait
    body += R.sec("9", "Where riders wait",
        R.period(f"Worst first, {wk_label.lower()}",
            R.rows(["Store", "AM", f"Wait on {R.esc(dshort)}", "Wait, week", "Orders kept 3+ min", "Delivered",
                    "Share 3+ min"],
                   [[R.store_link(w["code"], date), R.esc(w["am"]),
                     R.flag(R.n1(w.get("wait_day")), (w.get("wait_day") or 0) >= 2),
                     R.flag(R.n1(w.get("wait_wk")), (w.get("wait_wk") or 0) >= 2),
                     R.n0(w["waits3_wk"]), R.n0(w["delivered_wk"]),
                     R.flag(R.pct(w.get("pct3")), (w.get("pct3") or 0) >= 15)]
                    for w in (D.get("wait_stores") or []) if w["delivered_wk"]], sortable=True)
            + R.note(f"Network average {R.n1(wait_wk)} min, {R.n0(waits3_w)} of {R.n0(delivered_w)} delivered orders "
                     f"kept a rider waiting 3 minutes or more ({R.n1(pct3)}%). Goal is under 1.5 minutes average and "
                     "under 3% of orders.")),
        lead="Every minute a rider stands in a store is a minute the order is late and the rider is not paid. This "
             "is the one speed number the data can prove.")

    # 10. false ready
    body += R.sec("10", "&quot;Ready&quot; pressed before the food was ready",
        R.period("By store, worst first",
            R.rows(["Store", "AM", f"On {R.esc(dshort)}", "This week", "Delivered", "Share of orders"],
                   [[R.store_link(f["code"], date), R.esc(f["am"]), R.n0(f["fr_day"]), R.n0(f["fr_wk"]),
                     R.n0(f["delivered_wk"]), R.flag(R.pct(f.get("pct")), (f.get("pct") or 0) >= 5)]
                    for f in (D.get("fr_stores") or [])], "No false ready-presses this week.", sortable=True)
            + R.note(f"{R.n0(fr_w)} orders network-wide this week, {R.n1(pc(fr_w, delivered_w))}% of everything "
                     "delivered."))
        + R.period(f"The worst {len(D.get('fr_orders') or [])} orders of the week",
            R.fold("Order by order", len(D.get("fr_orders") or []),
                   R.rows(["Store", "AM", "Day", "Time", "Marked ready after", "Rider then waited",
                           "What was in the order"],
                          [[R.store_link(r["code"], date), R.esc(r["am"]), R.esc(r.get("dlabel") or ""),
                            R.esc(r.get("time") or ""), f"{R.n0(r.get('ready_secs'))} sec",
                            f"{R.n1(r.get('waited_min'))} min", R.basket(r.get("basket"))]
                           for r in (D.get("fr_orders") or [])]))
            + R.note("These are orders marked ready within a minute of being accepted where the rider then waited "
                     "3 minutes or more. Both facts come from the order&rsquo;s own timestamps.")),
        lead="Pressing ready early makes the store&rsquo;s Zomato numbers look good and makes the rider wait. It is "
             "a habit, and habits are a central conversation, not a store one.")

    # 11. money lost
    body += R.sec("11", "Money lost, by store",
        R.period(wk_label,
            R.rows(["Store", "AM", "Turned-away orders", "Rejections", "Refunds", "Complaints", "Total lost"],
                   [[R.store_link(m["code"], date), R.esc(m["am"]), R.money(m["stockout_wk"]), R.n0(m["rej_wk"]),
                     R.money(m["refunds_wk"]), R.n0(m["comp_wk"]), f"<b>{R.money(m['total_wk'])}</b>"]
                    for m in (D.get("money_stores") or [])],
                   "Nothing lost to rejections or refunds this week.", sortable=True)
            + R.note(f"{R.money(money_wk)} across {len(D.get('money_stores') or [])} stores. Every rupee here ties "
                     "to an order listed in sections 6 and 7. Nothing on this line is an estimate, and offline "
                     "minutes are NOT included: what a closed store would have sold cannot be measured, only "
                     "guessed.")),
        lead="The only place on the page where operational failure is priced.")

    # 12. central levers
    disc_d = pc(segd.get("discount") or 0, segd.get("subtotal"))
    disc_w = pc(segw.get("discount") or 0, segw.get("subtotal"))
    roi_w = (adsw.get("ad_sales") or 0) / adsw["spend"] if adsw.get("spend") else None
    lever_tiles = R.context(
        R.vtile(f"Discounts given, {dshort}", R.lakh(segd.get("discount")), f"{R.n1(disc_d)}% of subtotal",
                (disc_d or 0) <= (disc_w or 0), f"against {R.n1(disc_w)}% for the week"),
        R.vtile("Discounts given, week", R.lakh(segw.get("discount")), f"{R.n1(disc_w)}% of subtotal", False,
                f"{R.lakh(segw.get('discount'))} of margin, the largest single lever on this page"),
        R.vtile("Ad spend, week", R.lakh(adsw.get("spend")),
                f"{R.n0(adsw.get('ad_orders'))} ad-attributed orders", (roi_w or 0) >= 4,
                f"{R.n1(roi_w)}x return on the week"),
        R.vtile("Orders with an offer", R.pct(pc(segw.get("offer_orders") or 0, segw.get("orders"))),
                f"{R.n0(segw.get('offer_orders'))} of {R.n0(segw.get('orders'))} orders in the week", False,
                "nine orders in ten carry a discount"),
    )
    open_pct = pc(segw.get("menu_opens") or 0, segw.get("impressions"))
    conv_pct = pc(segw.get("orders") or 0, segw.get("menu_opens"))
    funnel = ('<div class="minigrid funnel3">'
              f'<div class="minicard"><div class="mtitle">Impressions</div>'
              f'<div class="mval">{R.n0(segw.get("impressions"))}</div>'
              '<div class="mnote">the menu was shown this many times</div></div>'
              f'<div class="minicard"><div class="mtitle">Menu opens</div>'
              f'<div class="mval">{R.n0(segw.get("menu_opens"))}</div>'
              f'<div class="mnote">{R.n2(open_pct)}% of impressions: the listing itself is the first lever</div></div>'
              f'<div class="minicard"><div class="mtitle">Orders</div>'
              f'<div class="mval">{R.n0(segw.get("orders"))}</div>'
              f'<div class="mnote">{R.n1(conv_pct)}% of menu opens: price, offer and rating decide here</div></div>'
              "</div>")
    lever_rows = []
    for l in sorted(D.get("lever_stores") or [], key=lambda x: -(x.get("disc_wk") or 0)):
        lever_rows.append([R.store_link(l["code"], date), R.esc(l["am"]), R.money(l["sub_wk"]),
                           R.money(l["disc_wk"]),
                           R.flag(R.pct(l.get("disc_pct_wk")), (l.get("disc_pct_wk") or 0) > (disc_w or 0)),
                           R.pct(l.get("offer_pct_wk")), R.money(l["spend_wk"]),
                           ("-" if l.get("roi_wk") is None else R.flag(R.n1(l["roi_wk"]), l["roi_wk"] < 4)),
                           R.n0(l["impr_wk"]), R.pct(l.get("open_pct_wk"), 2), R.pct(l.get("conv_pct_wk"))])
    spends = sorted((t.get("spend") or 0) for t in trend)
    base = spends[len(spends) // 2] if spends else 1
    spend_rows = [[datetime.strptime(t["d"], "%Y-%m-%d").strftime("%a %-d %b"), R.money(t.get("spend")),
                   R.n1(t.get("roi")),
                   ("the weekly charge lands" if (t.get("spend") or 0) > 3 * (base or 1)
                    else "the tail of it" if (t.get("spend") or 0) > 1.5 * (base or 1) else "")]
                  for t in trend]
    body += R.sec("12", "Central levers (never shown to a store or an area manager)",
        lever_tiles
        + R.period(f"The funnel, {wk_label.lower()}",
                   funnel + R.note("Impressions and menu opens are Zomato&rsquo;s own counts of its listing pages. "
                                   "Per store, the last three columns of the table below."))
        + R.period(f"Where the discount and the ad money went, {wk_label.lower()}",
                   R.rows(["Store", "AM", "Subtotal", "Discount", "Disc %", "Orders w/ offer", "Ad spend", "ROI",
                           "Impressions", "Menu opens", "Opens to orders"], lever_rows, sortable=True)
                   + R.note("Red discount % marks a store discounting harder than the network. Red ROI marks under "
                            "4x. Ad ROI is Zomato&rsquo;s own attribution and is directional, not audited."))
        + R.period("Why the daily ad number cannot be read",
                   R.rows(["Day", "Ad spend", "ROI", ""], spend_rows)
                   + R.note("Ad spend is not posted daily. It arrives in a lump, on a Sunday in most weeks, with a "
                            "smaller tail on the Monday, while ad-attributed sales stay flat through the spike. "
                            "Verified over seven weeks on 26 Aug 2026. So a single day&rsquo;s ad spend and a single "
                            "day&rsquo;s ROI are meaningless: only the 7-day figure is. That is why the tiles above "
                            "quote the week and there is no day tile.")),
        lead="Discounts, ads and the funnel. This is the block that separates the central page from the area page: "
             "these are the numbers only central can move, and each one lists the stores it came from.")

    body += R.footer_html("Store and area manager names open their own pages in the portal.")
    return R.page("Network Daily: the whole network", body)
