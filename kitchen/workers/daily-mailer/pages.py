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


# ------------------------------------- store (v3, merged with Swiggy 30 Aug)
# The mail's twin of portal/app/(app)/daily/store/[code]/view.tsx. Locked rules
# from the merge: every row tagged Z or S, outlet-mistake reasons read red,
# Swiggy baskets carry quantities, one row per rated ORDER, speed stays Zomato
# only (Swiggy publishes no timing), "What customers said" is its own section,
# unhappy and turned-away carry % of orders.
S_TAG = "Swiggy 1-2 stars"


def store_page(s, det, reasons, sw, all_stores, date):
    day, wk = s["day"], s["wk"]
    sw = sw or {}
    mapped = bool(sw.get("mapped"))
    sday = (sw.get("day") or {}) if mapped else {}
    strend = (sw.get("trend") or []) if mapped else []
    dshort = R.short_label(date)
    day_label = f"Yesterday ({dshort})"
    wk_label = R.week_label(det["week_start"], date)
    trend = det.get("trend") or []
    tlabels = [datetime.strptime(t["d"], "%Y-%m-%d").strftime("%a %-d") for t in trend]
    ttips = [datetime.strptime(t["d"], "%Y-%m-%d").strftime("%a %-d %b") for t in trend]
    stlabels = [R.dshort(t.get("d")) for t in strend]

    # The merged day, both apps.
    s_orders = sday.get("orders") or 0
    tot_orders = (day.get("orders") or 0) + s_orders
    comps_day = det.get("complaints_day") or []
    comps_wk = det.get("complaints_wk") or []
    canc_day = sw.get("canc_day") or []
    canc_wk = sw.get("canc_wk") or []
    rated_day_s = sw.get("rated_day") or []
    low_wk_s = sw.get("low_wk") or []
    comments_wk_s = sw.get("comments_wk") or []
    low_day_s = len([r for r in rated_day_s
                     if (r.get("rating") if r.get("rating") is not None else 9) <= 2])
    unhappy_day = len(comps_day) + low_day_s
    unhappy_pct = (100.0 * unhappy_day / tot_orders) if tot_orders else None
    canc_day_val = sum((c.get("val") or 0) for c in canc_day)
    canc_wk_val = sum((c.get("val") or 0) for c in canc_wk)
    turn_day = (day.get("srej") or 0) + len(canc_day)
    turn_pct = (100.0 * turn_day / (tot_orders + turn_day)) if tot_orders else None
    loss_wk = (det.get("refunds_wk") or 0) + (det.get("stockout_wk") or 0) + canc_wk_val
    low_wk_earlier = [r for r in low_wk_s if r.get("d") != date]
    canc_wk_earlier = [c for c in canc_wk if c.get("d") != date]

    things = []
    if unhappy_day > 0:
        things.append(f"<b>{R.n0(unhappy_day)} unhappy order{'' if unhappy_day == 1 else 's'} yesterday "
                      f"({R.n1(unhappy_pct)}% of {R.n0(tot_orders)} orders)</b>: {len(comps_day)} Zomato "
                      f"complaint{'' if len(comps_day) == 1 else 's'}"
                      + (f" and {low_day_s} Swiggy order{'' if low_day_s == 1 else 's'} rated 1-2 stars"
                         if low_day_s else "")
                      + ". Sections 3 and 6 name each one.")
    if (det.get("stockout_day") or 0) + canc_day_val > 0:
        things.append(f"<b>{R.money((det.get('stockout_day') or 0) + canc_day_val)} of orders were turned away "
                      "or cancelled on the store yesterday.</b> Section 2 lists each one with its reason; "
                      "stockouts get fixed today.")
    if (wk.get("fr") or 0) > 0:
        things.append(f"<b>&quot;Ready&quot; was pressed early on {R.n0(wk['fr'])} Zomato orders this week</b> "
                      "while the rider stood waiting. Press ready only when the bag is sealed.")
    if not things:
        things.append("<b>A clean day on both apps.</b> Keep it there.")

    body = R.masthead(
        "Creme Castle &middot; Store Daily &middot; Zomato + Swiggy",
        f"Store Daily: {R.esc(s['code'])}",
        f"{R.esc(det.get('locality') or '')}"
        + (", " + R.esc(det["city"]) if det.get("city") else "")
        + f" &middot; Area manager: {R.esc(det.get('am') or '-')} &middot; Zomato + Swiggy"
        + ("" if mapped else " (no Swiggy outlet mapped for this store)"),
        R.date_label(date), R.settled_note())

    avg7 = (day.get("avgord") or 0) + (sday.get("avg7") or 0)
    body += R.context(
        R.tile("Orders", R.n0(tot_orders),
               f"{R.apptag('Z')}{R.n0(day.get('orders'))} &nbsp;{R.apptag('S')}{R.n0(s_orders)}"
               + (f" &middot; own 7-day average {R.n0(avg7)}" if avg7 else "")),
        R.tile("Delivered", f"{R.n0((day.get('delivered') or 0) + s_orders)} <small>of {R.n0(tot_orders)}</small>",
               "Swiggy&rsquo;s sheets count delivered orders only"),
        R.tile("Unhappy orders",
               R.n0(unhappy_day) + (f" <small>&nbsp;{R.n1(unhappy_pct)}% of orders</small>"
                                    if unhappy_pct is not None and unhappy_day else ""),
               f"{R.apptag('Z')}{len(comps_day)} complaints &nbsp;{R.apptag('S')}{low_day_s} low-starred"),
        R.tile("Ratings",
               f"{R.apptag('Z')}{R.n1(day['rating']) if day.get('rating') else '-'}"
               f" &nbsp;{R.apptag('S')}{R.n1(sday['rating']) if sday.get('rating') is not None else '-'}",
               f"{len(det.get('rated_day') or []) + len(rated_day_s)} orders rated"),
        R.tile("Network rank",
               f"{R.apptag('Z')}{s.get('dayRank') or '-'} <small>of {len(all_stores)}</small>"
               f" &nbsp;{R.apptag('S')}{sw.get('rank') or '-'} <small>of {sw.get('rank_of') or '-'}</small>",
               "best-RUN store of the day, not the busiest"),
    )
    body += R.actions("Things for today", things[:3])

    # 1. Were you open?
    online = day.get("online")
    open_kpis = [R.kpi(f"{R.apptag('Z')}Online time", "-" if online is None else R.n1(online) + "%", "",
                       R.verdict((online or 0) >= 99.9,
                                 "full day online" if (online or 0) >= 99.9
                                 else f"offline {R.n0(day.get('offmin'))} min"), raw_label=True)]
    if sday:
        open_kpis.append(R.kpi(f"{R.apptag('S')}Open hours",
                               f"{R.n1((sday.get('ih') or 0) - (sday.get('short') or 0))} "
                               f"<small>of {R.n1(sday.get('ih'))}</small>", "",
                               R.verdict((sday.get("open_pct") or 0) >= 97,
                                         f"{R.n1(sday.get('open_pct'))}% of the expected window"
                                         if (sday.get("open_pct") or 0) >= 97
                                         else f"{R.n1(sday.get('short'))} hours missing from the expected window"),
                               raw_label=True))
    body += R.sec("1", "Were you open?",
        R.period(day_label,
            R.krow(*open_kpis)
            + R.note("Zomato reports minutes offline per day; Swiggy reports hours open against its expected "
                     "window. Neither says the clock time: if a day shows time missing, ask the store what "
                     "happened."))
        + R.period(wk_label,
            R.chartrow(
                R.chart([t.get("offmin") for t in trend], tlabels, tips=ttips,
                        title="Zomato: minutes offline per day (0 = fully online)", unit=" min", lo=0, dec=0),
                R.chart([t.get("short") for t in strend], stlabels,
                        title="Swiggy: hours not open per day (0 = fully open)", lo=0)
                if (mapped and strend) else "")))

    # 2. Did you deliver what came?
    body += R.sec("2", "Did you deliver what came?",
        R.period(day_label,
            R.krow(R.kpi("Turned away or cancelled on the store",
                         R.n0(turn_day) + (f" <small>&nbsp;{R.n1(turn_pct)}% of what came</small>"
                                           if turn_pct is not None and turn_day else ""), "",
                         R.verdict(turn_day == 0, "accepted and delivered everything" if turn_day == 0
                                   else f"{R.money((det.get('stockout_day') or 0) + canc_day_val)} of orders lost")))
            + R.approws("turn-day", ["Time", "App", "Reason", "What the customer had ordered", "Value lost"],
                        [("Z", [R.esc(r.get("time") or ""), R.apptag("Z"), R.faulttag(r.get("reason") or "no reason"),
                                R.basket(r.get("basket")), R.money(r.get("value"))])
                         for r in (det.get("rejections_day") or [])]
                        + [("S", [R.clock(c.get("t")), R.apptag("S"), R.faulttag(c.get("why")),
                                  R.basket(c.get("basket")),
                                  "n/a" if c.get("val") is None else R.money(c.get("val"))])
                           for c in canc_day],
                        "Nothing was turned away on either app yesterday."))
        + R.period(wk_label,
            R.krow(R.kpi("Turned away this week", R.n0((wk.get("srej") or 0) + len(canc_wk)),
                         f"{R.money((det.get('stockout_wk') or 0) + canc_wk_val)} of orders lost, both apps"))
            + R.chart([t.get("srej") for t in trend], tlabels, tips=ttips,
                      title="Zomato: store-caused rejections per day", lo=0, dec=0)
            + R.fold("Earlier this week, both apps",
                     len(det.get("rejections_wk") or []) + len(canc_wk_earlier),
                     R.approws("turn-wk",
                               ["Day", "Time", "App", "Reason", "What the customer had ordered", "Value lost"],
                               [("Z", [R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""), R.apptag("Z"),
                                       R.faulttag(r.get("reason") or "no reason"), R.basket(r.get("basket")),
                                       R.money(r.get("value"))])
                                for r in (det.get("rejections_wk") or [])]
                               + [("S", [R.dshort(c.get("d")), R.clock(c.get("t")), R.apptag("S"),
                                         R.faulttag(c.get("why")), R.basket(c.get("basket")),
                                         "n/a" if c.get("val") is None else R.money(c.get("val"))])
                                  for c in canc_wk_earlier]))
            + R.note("Customer- and rider-caused cancellations are not listed and not counted against the store "
                     f"({R.n0(det.get('other_cancels_wk'))} on Zomato this week). Swiggy values and baskets come "
                     "from the billed Petpooja order, matched on Swiggy&rsquo;s own order number."))
        # F49: cancelled by Zomato AFTER the rider picked up. Not the store's fault.
        + R.period("Cancelled after the rider picked up (not the store's fault)",
            R.krow(R.kpi(f"{R.apptag('Z')}Returned orders this week",
                         R.n0(len(det.get("returned_day") or []) + len(det.get("returned_wk") or [])),
                         f"{R.money(det.get('returned_loss_wk'))} net loss after Zomato&rsquo;s compensation",
                         raw_label=True))
            + R.rows(["Day", "Time", "What the customer had ordered", "Bill", "Zomato paid", "Net loss"],
                     [[dshort, R.esc(r.get("time") or ""), R.basket(r.get("basket")), R.money(r.get("value")),
                       R.money(r.get("comp")), R.money(r.get("net"))] for r in (det.get("returned_day") or [])]
                     + [[R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""), R.basket(r.get("basket")),
                         R.money(r.get("value")), R.money(r.get("comp")), R.money(r.get("net"))]
                        for r in (det.get("returned_wk") or [])],
                     "No order came back after pickup this week.")
            + R.note("The store accepted, made and handed these over; Zomato then cancelled them because the "
                     "customer could not receive the order (Zomato&rsquo;s report shortens this to &quot;Unavailable "
                     "to accept the order&quot;; Petpooja holds the full sentence). Zomato pays part of the bill. "
                     "These are not counted as turned away and not in the avoidable-loss total.")))

    # 3. Was it right?
    tags = {}
    for r in comps_wk:
        t = r.get("tag") or "reason not tagged by Zomato"
        tags[t] = tags.get(t, 0) + 1
    if low_wk_earlier:
        tags[S_TAG] = len(low_wk_earlier)
    chips = "".join(f'<button class="rfilter" data-reason="{R.esc(t)}" data-target="comp-wk" type="button">'
                    f"{R.esc(t)}: <b>{c}</b></button>" for t, c in sorted(tags.items(), key=lambda kv: -kv[1]))
    chips += '<button class="rfilter on" data-reason="" data-target="comp-wk" type="button">Show all</button>'
    comp_rows = [[R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""), R.apptag("Z"), R.tag(r.get("tag")),
                  R.basket(r.get("basket")), R.words(r.get("review")),
                  R.money(r["refund"]) if r.get("refund") else "-"] for r in comps_wk]
    comp_attrs = [f' data-app="Z" data-reason="{R.esc(r.get("tag") or "reason not tagged by Zomato")}"'
                  for r in comps_wk]
    comp_rows += [[R.dshort(r.get("d")), R.clock(r.get("t")), R.apptag("S"), R.stars(r.get("rating")),
                   R.basket(r.get("basket")), R.words(r.get("words")), "-"] for r in low_wk_earlier]
    comp_attrs += [f' data-app="S" data-reason="{R.esc(S_TAG)}"' for _ in low_wk_earlier]
    body += R.sec("3", "Was it right?",
        R.period(day_label,
            R.krow(R.kpi("Complaints (Zomato official)", R.n0(day.get("comps")), "",
                         R.verdict((day.get("comps") or 0) == 0,
                                   "no complaints" if (day.get("comps") or 0) == 0
                                   else f"{R.n0(day.get('comps'))} on {R.n0(day.get('orders'))} Zomato orders "
                                        f"({R.n1(day.get('cpct'))}%)")),
                   R.kpi("Customers reporting an issue", str(len(comps_day)),
                         "Zomato counts only some as official complaints"))
            + R.tlabel("Every order with an issue yesterday, with its tag")
            + R.rows(["Time", "Tag on the order", "What was in the order", "What the customer wrote", "Refunded"],
                     [[R.esc(r.get("time") or ""), R.tag(r.get("tag")), R.basket(r.get("basket")),
                       R.words(r.get("review")), R.money(r["refund"]) if r.get("refund") else "-"]
                      for r in comps_day], "No issues reported yesterday.")
            + R.note("Swiggy publishes no complaint feed; its unhappy signal is the 1-2 star ratings, in the "
                     "filterable list below and in section 6 with the customer&rsquo;s words."))
        + R.period(wk_label,
            R.krow(R.kpi("Complaints this week (Zomato official)", R.n0(reasons.get("comps"))),
                   R.kpi("Orders with a reported issue",
                         str(len(comps_day) + len(comps_wk) + len(low_wk_earlier)),
                         f"including Swiggy&rsquo;s {len(low_wk_earlier)} low-starred earlier this week"))
            + R.chart([t.get("comps") for t in trend], tlabels, tips=ttips,
                      title="Zomato complaints per day", lo=0, dec=0)
            + R.tlabel("Zomato&rsquo;s reason counts for the week (their own daily figures)")
            + R.hbar([("Poor taste or quality", reasons.get("quality") or 0),
                      ("Poor packaging or spillage", reasons.get("packaging") or 0),
                      ("Items missing", reasons.get("missing") or 0),
                      ("Wrong items", reasons.get("wrong") or 0),
                      ("Delivered late", reasons.get("late") or 0)])
            + R.tlabel("Orders before yesterday, grouped by the tag on the order. Click a tag, or narrow to one app.")
            + R.appfilter("comp-wk")
            + f'<div class="rfilters">{chips}</div>'
            + R.fold("Orders with issues earlier this week", len(comp_rows),
                     R.rows(["Day", "Time", "App", "Tag on the order", "What was in the order",
                             "What the customer wrote", "Refunded"],
                            comp_rows, table_id="comp-wk", row_attrs=comp_attrs),
                     open_=True)
            + R.note("Two counts, two sources, both true: Zomato&rsquo;s official complaint figure comes from their "
                     "daily report, while the list is every order where a customer raised something, plus every 1-2 "
                     "star Swiggy order. Zomato tags a reason on only some orders; untagged orders are listed too.")))

    # 4. Was it fast, and was "ready" honest? Zomato only: Swiggy publishes no timing.
    fr_day = det.get("false_ready_day") or []
    fr_wk = det.get("false_ready_wk") or []
    w3d, dd = det.get("waits3_day") or 0, det.get("delivered_day") or 0
    body += R.sec("4", "Was it fast, and was &quot;ready&quot; honest? "
                       f"{R.apptag('Z')}<small>Zomato only</small>",
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
            + R.note("Swiggy&rsquo;s report publishes no preparation or rider timing at all, so this section cannot "
                     "exist for Swiggy. On Zomato, rider wait is the honest speed measure, cross-checked across two "
                     "independent feeds; kitchen preparation time only measures how fast the tablet button is "
                     "pressed.")))

    # 5. What did mistakes cost?
    body += R.sec("5", "What did mistakes cost?",
        R.period("Yesterday and the week together",
            R.rows(["What cost money", "App", "Yesterday", "Last 7 days", "What it means"],
                   [["Refunds to customers", R.apptag("Z"), R.money(det.get("refunds_day")),
                     R.money(det.get("refunds_wk")), "charged back to the restaurant for complaints"],
                    ["Orders turned away", R.apptag("Z"), R.money(det.get("stockout_day")),
                     R.money(det.get("stockout_wk")),
                     "value of store-rejected orders (section 2 lists them)"],
                    ["Orders cancelled on the store", R.apptag("S"), R.money(canc_day_val), R.money(canc_wk_val),
                     "billed value of the orders in section 2"],
                    ["Returned after pickup, net of Zomato's compensation", R.apptag("Z"),
                     R.money(det.get("returned_loss_day")), R.money(det.get("returned_loss_wk")),
                     "not the store's fault; shown for completeness, not in the total below"]])
            + R.krow(R.kpi("Total avoidable loss, 7 days, both apps", R.money(loss_wk), "",
                           R.verdict(loss_wk < 1000, "small" if loss_wk < 1000
                                     else "this is the number to bring down: every line is store-controllable")))
            + R.note("Every rupee ties to a specific order listed in sections 2 and 3; nothing is an estimate. "
                     "Swiggy&rsquo;s report carries no refund column, so Swiggy complaint refunds (if any) are not "
                     "here yet.")))

    # 6. What customers said
    low_all = [("Z", [R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""), R.apptag("Z"),
                      R.esc(str(r.get("rating") or "-")), R.basket(r.get("basket")), R.words(r.get("review")),
                      R.tag(r["tag"]) if r.get("tag") else "-"])
               for r in (det.get("low_ratings_wk") or [])]
    low_all += [("S", [R.dshort(r.get("d")), R.clock(r.get("t")), R.apptag("S"),
                       "-" if r.get("rating") is None else R.n0(r.get("rating")),
                       R.basket(r.get("basket")), R.words(r.get("words")), "-"]) for r in low_wk_s]
    said = (R.period(day_label,
                R.krow(R.kpi("Ratings yesterday",
                             f"{R.apptag('Z')}{R.n1(day['rating']) if day.get('rating') else '-'}"
                             f" &nbsp;{R.apptag('S')}"
                             f"{R.n1(sday['rating']) if sday.get('rating') is not None else '-'} <small>/ 5</small>",
                             f"{len(det.get('rated_day') or []) + len(rated_day_s)} orders rated; every one is "
                             "listed so none hides"))
                + R.rows(["Time", "App", "Stars", "What was in the order", "The customer&rsquo;s words"],
                         [[R.esc(r.get("time") or ""), R.apptag("Z"), R.esc(str(r.get("rating") or "-")),
                           R.basket(r.get("basket")), R.words(r.get("review"))]
                          for r in (det.get("rated_day") or [])]
                         + [[R.clock(r.get("t")), R.apptag("S"),
                             "-" if r.get("rating") is None else R.n0(r.get("rating")),
                             R.basket(r.get("basket")), R.words(r.get("words"))] for r in rated_day_s],
                         "No orders rated yesterday on either app."))
            + R.period(wk_label,
                R.chartrow(
                    R.chart([(t.get("rating") if (t.get("rating") or 0) > 0 else None) for t in trend],
                            tlabels, tips=ttips,
                            title="Zomato rating per day (few orders are rated, so this swings)", lo=1, hi=5),
                    R.chart([t.get("rating") for t in strend], stlabels,
                            title="Swiggy rating per day", lo=1, hi=5) if (mapped and strend) else "")
                + (R.tlabel("Every written Swiggy comment of the week, in the customer&rsquo;s own words "
                            "(Zomato reviews appear in the lists above and below)")
                   + R.rows(["Day", "Time", "Stars", "Items", "The customer&rsquo;s words"],
                            [[R.dshort(r.get("d")), R.clock(r.get("t")),
                              "-" if r.get("rating") is None else R.n0(r.get("rating")),
                              R.basket(r.get("basket")), R.words(r.get("words"))] for r in comments_wk_s])
                   if comments_wk_s else "")
                + R.fold("Every 1 and 2-star order of the week, both apps", len(low_all),
                         R.approws("low-wk", ["Day", "Time", "App", "Stars", "What was in the order",
                                              "The customer&rsquo;s words", "Tag if any"], low_all))))
    body += R.sec("6", "What customers said", said)

    # 7. Scoreboard: one league per app, because their metrics are not comparable.
    league = sorted(all_stores, key=lambda x: x.get("dayRank") or 99)
    shown = league[:5] + ([s] if (s.get("dayRank") or 99) > 5 else [])
    sleague = sw.get("league") or []
    board = R.tlabel(f"{R.apptag('Z')}Zomato league: ranked by complaints + rejections + offline, lower is better. "
                     "Top 5 plus this store (bold).") \
        + R.rows(["#", "Store", "AM", "Orders", "Complaints", "Online %", "Rating"],
                 [[str(x.get("dayRank") or "-"),
                   (f"<b>{R.esc(x['code'])}</b>" if x["code"] == s["code"] else R.store_link(x["code"], date)),
                   R.esc(x.get("am") or ""), R.n0(x["day"].get("orders")), R.n0(x["day"].get("comps")),
                   "-" if x["day"].get("online") is None else R.n1(x["day"]["online"]),
                   R.n1(x["day"]["rating"]) if x["day"].get("rating") else "-"] for x in shown])
    if mapped and sleague:
        board += R.tlabel(f"{R.apptag('S')}Swiggy league: ranked by store-caused cancellations + 1-2 star orders + "
                          "hours offline, lower is better.") \
            + R.rows(["#", "Store", "Orders", "Cancelled on store", "Hrs offline", "Rating"],
                     [[str(l.get("rank") or "-"),
                       (f"<b>{R.esc(l['code'])}</b>" if l.get("code") == s["code"]
                        else R.store_link(l.get("code"), date)),
                       R.n0(l.get("orders")), R.n0(l.get("cancels")), R.n1(l.get("short")),
                       "-" if l.get("rating") is None else R.n1(l.get("rating"))] for l in sleague])
    body += R.sec("7", "Scoreboard",
                  R.period(f"{day_label}, one league per app (their metrics are not comparable)", board))

    # Staffing: both apps together.
    meal = dict(det.get("mealtime_wk") or {})
    for k, v in (sw.get("slot_wk") or {}).items() if mapped else []:
        key = "Late night" if k == "Late Night" else k
        meal[key] = (meal.get(key) or 0) + v
    total = sum(meal.values())
    if total:
        names = [("Dinner", "Dinner (7 to 11 pm)"), ("Lunch", "Lunch (11 am to 4 pm)"),
                 ("Snacks", "Snacks (4 to 7 pm)"), ("Late night", "Late night (11 pm to 7 am)"),
                 ("Breakfast", "Breakfast (7 to 11 am)")]
        body += R.sec("+", "When your orders come (staffing and prep)",
                      R.hbar([(label, round(100 * meal.get(k, 0) / total)) for k, label in names])
                      + R.note("Share of this store&rsquo;s orders over the 7 days, both apps together."))

    body += R.footer_merged()
    return R.page(f"Store Daily: {s['code']}", body)


# -------------------------------------- area (v2, merged with Swiggy 30 Aug)
# The mail's twin of portal/app/(app)/daily/area/[am]/view.tsx. It answers a
# different question from the store page: not "what happened here" but "which
# of my stores needs me today, and what exactly do I say to that store", so
# every number names its outlet and lists the orders behind it.
def area_page(am, mine, A, sw, all_stores, areas, date):
    sw = sw or {}
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
    returned = A.get("returned") or []

    # The Swiggy half of the day.
    srows = sw.get("stores") or []
    unmapped = sw.get("unmapped") or []
    short_series = sw.get("short_series") or []
    canc_day = sw.get("canc_day") or []
    canc_wk = sw.get("canc_wk") or []
    slow_day = [r for r in (sw.get("low_day") or [])
                if (r.get("rating") if r.get("rating") is not None else 9) <= 2]
    slow_wk = sw.get("low_wk") or []
    s_orders_day = sum((r.get("orders") or 0) for r in srows)
    canc_day_val = sum((c.get("val") or 0) for c in canc_day)
    canc_wk_val = sum((c.get("val") or 0) for c in canc_wk) + canc_day_val

    z_orders = tot(lambda s: s["day"].get("orders"))
    tot_orders = z_orders + s_orders_day
    z_comps = tot(lambda s: s["day"].get("comps"))
    unhappy = z_comps + len(slow_day)
    unhappy_pct = (100.0 * unhappy / tot_orders) if (tot_orders and unhappy) else None
    turned = tot(lambda s: s["day"].get("srej")) + len(canc_day)
    turned_pct = (100.0 * turned / (tot_orders + turned)) if (tot_orders and turned) else None

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
                    f"{len(all_stores)} network-wide for this day (fewest complaints, rejections and offline "
                    "minutes; not the busiest).")

    body = R.masthead("Creme Castle &middot; Area Daily &middot; Zomato + Swiggy", f"{R.esc(am)}&rsquo;s area",
                      f"{len(mine)} stores &middot; Zomato + Swiggy", R.date_label(date),
                      R.settled_note() + " Every number below names the outlet and lists the orders behind it.")
    body += R.context(
        R.tile("Orders", R.n0(tot_orders),
               f"{R.apptag('Z')}{R.n0(z_orders)} &nbsp;{R.apptag('S')}{R.n0(s_orders_day)} "
               f"&middot; {len(mine)} stores"),
        R.tile("Unhappy orders",
               R.n0(unhappy) + (f" <small>&nbsp;{R.n1(unhappy_pct)}% of orders</small>"
                                if unhappy_pct is not None else ""),
               f"{R.apptag('Z')}{R.n0(z_comps)} complaints &nbsp;{R.apptag('S')}{len(slow_day)} low-starred"),
        R.tile("Turned away / cancelled on store",
               R.n0(turned) + (f" <small>&nbsp;{R.n1(turned_pct)}% of what came</small>"
                               if turned_pct is not None else ""),
               f"{R.apptag('Z')}{len(rej_t)} &nbsp;{R.apptag('S')}{len(canc_day)}"),
        R.tile("Money lost, week", R.money(money_wk + canc_wk_val),
               f"{R.apptag('Z')}{R.money(money_wk)} &nbsp;{R.apptag('S')}{R.money(canc_wk_val)}"),
    )
    body += R.actions("Where you are needed", need[:5])

    # 1. the compact store table, one tab per app
    def store_row(s):
        d = s["day"]
        p = (round(100.0 * (d["orders"] - d["avgord"]) / d["avgord"])
             if d.get("orders") is not None and d.get("avgord") else None)
        vs = ("-" if p is None else R.goodv(f"+{p}%") if p >= 10
              else (f'<span class="flag">{p}%</span>' if p <= -15 else ("+" if p >= 0 else "") + f"{p}%"))
        return [str(s.get("dayRank") or "-"), R.store_link(s["code"], date), R.n0(d.get("orders")), vs,
                R.flag("-" if d.get("online") is None else R.n1(d["online"]),
                       (d["online"] if d.get("online") is not None else 100) < 99.9),
                R.flag(R.n0(d.get("srej")), (d.get("srej") or 0) > 0),
                R.flag(R.n0(d.get("comps")), (d.get("comps") or 0) >= 3),
                R.n1(d["rating"]) if d.get("rating") else "-",
                R.flag("-" if d.get("wait") is None else R.n1(d["wait"]), (d.get("wait") or 0) >= 2)]
    zview = R.rows(["#", "Store", "Orders", "vs avg", "Online %", "Rej", "Comp", "Rating", "Wait"],
                   [store_row(s) for s in sorted(mine, key=lambda s: s.get("dayRank") or 99)], sortable=True)
    sview = (R.swiggy_stores_table(srows, date)
             + R.note("Swiggy publishes no rider wait, so that column is empty on this tab. Canc counts only "
                      "cancellations charged to the store; 1-2&#9733; is Swiggy&rsquo;s unhappy-customer signal "
                      "(it has no complaint feed)."))
    body += R.sec("1", f"Your stores on {R.esc(dshort)}",
        R.period(f"Ranked worst-first for {dshort}",
            R.apptabs("s1") + R.s1view("s1", "z", zview) + R.s1view("s1", "s", sview, off=True)
            + R.note("# is the store&rsquo;s rank in that app&rsquo;s own league for this day, lower is better. "
                     "Red marks a number worth a question. Store names open the store page."
                     + (f" <b>{R.esc(', '.join(unmapped))} has no Swiggy outlet in the map</b>, so it appears only "
                        "on the Zomato tab; if it does trade on Swiggy, that is a mapping gap to fix, not a quiet "
                        "zero." if unmapped else ""))))

    # 2. offline dips, both apps
    cards = []
    for dp in dips:
        ser = [p["online"] for p in dp["series"]]
        labs = [p["d"][-2:] for p in dp["series"]]
        tps = [datetime.strptime(p["d"], "%Y-%m-%d").strftime("%a %-d %b") for p in dp["series"]]
        cards.append(f'<div class="minicard"><div class="mtitle">{R.apptag("Z")}{R.esc(dp["code"])}</div>'
                     f'<div class="mval">{R.n1(dp["online_day"])}% <small>on the day</small></div>'
                     f'<div class="mnote">{R.n0(dp["offmin_day"])} min offline that day &middot; '
                     f'{R.n0(dp["offmin_wk"])} min across the week</div>'
                     + R.chart(ser, labs, tips=tps, title="Online % per day (day of month)", unit="%",
                               lo=min(90, min(ser)) - 1, hi=100, width=280, height=96) + "</div>")
    cards += [R.short_card(s) for s in short_series]
    body += R.sec("2", "Outlets not fully online",
        R.period(f"{dshort} dips, with their 7-day line",
            (f'<div class="minigrid">{"".join(cards)}</div>' if cards
             else R.note("Every store was fully online on both apps on this day."))
            + R.note("Zomato reports total minutes offline per day; Swiggy reports hours open against its expected "
                     "window. Neither gives clock times.")))

    # 3. the shut-shop tracker
    body += R.sec("3", "Orders turned away because the shop was shut",
        R.shut_shop(A, dshort, wk_label, show_am=False, date=date),
        lead="The one number on this page that should be zero. Zomato does not send an order to a store it thinks "
             "is closed, so each of these is a shop whose listing was live while it could not serve. Section 2 is "
             "the opposite case, the listing itself going down.")

    # 4. turned away or cancelled on the store, both apps
    body += R.sec("4", "Turned away or cancelled on the store",
        R.period(dshort,
            R.approws("turn-day",
                      ["Store", "Time", "App", "Reason", "What the customer had ordered", "Value lost"],
                      [("Z", [R.store_link(r["code"], date), R.esc(r.get("time") or ""), R.apptag("Z"),
                              R.faulttag(r.get("reason") or "no reason"), R.basket(r.get("basket")),
                              R.money(r.get("value"))]) for r in rej_t]
                      + [("S", [R.store_link(c.get("code") or "", date), R.clock(c.get("t")), R.apptag("S"),
                                R.faulttag(c.get("why")), R.basket(c.get("basket")),
                                "n/a" if c.get("val") is None else R.money(c.get("val"))]) for c in canc_day],
                      "Nothing was turned away on either app on this day."))
        + R.period(wk_label,
            R.fold("Earlier this week, both apps", len(rej_w) + len(canc_wk),
                   R.approws("turn-wk",
                             ["Store", "Day", "Time", "App", "Reason", "What the customer had ordered",
                              "Value lost"],
                             [("Z", [R.store_link(r["code"], date), R.esc(r.get("dlabel") or ""),
                                     R.esc(r.get("time") or ""), R.apptag("Z"),
                                     R.faulttag(r.get("reason") or "no reason"), R.basket(r.get("basket")),
                                     R.money(r.get("value"))]) for r in rej_w]
                             + [("S", [R.store_link(c.get("code") or "", date), R.dshort(c.get("d")),
                                       R.clock(c.get("t")), R.apptag("S"), R.faulttag(c.get("why")),
                                       R.basket(c.get("basket")),
                                       "n/a" if c.get("val") is None else R.money(c.get("val"))])
                                for c in canc_wk]))
            + R.note("Only what is charged to the store is listed; customer and rider cancellations are excluded. "
                     "Swiggy values and baskets come from the billed Petpooja order, matched on Swiggy&rsquo;s own "
                     "order number."))
        # F49: cancelled after the rider picked up. Not the store's fault.
        + R.period("Cancelled after the rider picked up (not the store's fault)",
            R.fold("Returned orders this week, every one", len(returned),
                   R.rows(["Store", "Day", "Time", "What the customer had ordered", "Bill", "Zomato paid",
                           "Net loss"],
                          [[R.store_link(r["code"], date), R.esc(r.get("dlabel") or ""), R.esc(r.get("time") or ""),
                            R.basket(r.get("basket")), R.money(r.get("value")), R.money(r.get("comp")),
                            R.money(r.get("net"))] for r in returned]))
            + R.note(f"{R.n0(len(returned))} orders, {R.money(sum((r.get('net') or 0) for r in returned))} net after "
                     "Zomato&rsquo;s compensation. The store accepted, made and handed these over; Zomato then "
                     "cancelled them because the customer could not receive the order. Not counted as turned away, "
                     "not in section 9&rsquo;s totals.")))

    # 5. complaints (Zomato only: Swiggy publishes no complaint feed)
    tags = {}
    for r in comp_w:
        tags[r.get("tag") or ""] = tags.get(r.get("tag") or "", 0) + 1
    chips = "".join(f'<button class="rfilter" data-reason="{R.esc(t)}" data-target="area-cw" type="button">'
                    f"{R.esc(t)}: <b>{c}</b></button>" for t, c in sorted(tags.items(), key=lambda kv: -kv[1]))
    chips += '<button class="rfilter on" data-reason="" data-target="area-cw" type="button">Show all</button>'
    comp_cols = ["Store", "Time", "Tag on the order", "What was in the order",
                 "What the customer wrote", "Refunded"]
    comp_day_rows = [[R.store_link(r["code"], date), R.esc(r.get("time") or ""), R.tag(r.get("tag")),
                      R.basket(r.get("basket")), R.words(r.get("review")),
                      R.money(r["refund"]) if r.get("refund") else "-"] for r in today]
    body += R.sec("5", "Complaints",
        R.period(dshort,
            (R.rows(comp_cols, comp_day_rows, "No issues reported on this day.") if len(today) <= 25
             else R.fold(f"Every order with an issue on {R.esc(dshort)}", len(today),
                         R.rows(comp_cols, comp_day_rows), open_=True)))
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
            + R.note("Tags come from the order itself; Zomato leaves many untagged, and those are listed too. Swiggy "
                     "publishes no complaint feed, so its unhappy signal is the low ratings in section 6.")))

    # 6. low ratings, both apps
    body += R.sec("6", "1, 2 and 3-star orders",
        R.period(dshort,
            R.approws("low-day",
                      ["Store", "Time", "App", "Stars", "What was in the order", "What the customer wrote",
                       "Complaint tag if any"],
                      [("Z", [R.store_link(r["code"], date), R.esc(r.get("time") or ""), R.apptag("Z"),
                              R.esc(str(r.get("rating") or "-")), R.basket(r.get("basket")),
                              R.words(r.get("review")), R.tag(r["tag"]) if r.get("tag") else "-"])
                       for r in low_t]
                      + [("S", [R.store_link(r.get("code") or "", date), R.clock(r.get("t")), R.apptag("S"),
                                "-" if r.get("rating") is None else R.n0(r.get("rating")),
                                R.basket(r.get("basket")), R.words(r.get("words")), "-"])
                         for r in (sw.get("low_day") or [])],
                      "No low-rated orders on this day, on either app."))
        + R.period(wk_label,
            R.fold("Low-rated orders earlier this week, both apps", len(low_w) + len(slow_wk),
                   R.approws("low-wk",
                             ["Store", "Day", "Time", "App", "Stars", "What was in the order",
                              "What the customer wrote", "Complaint tag if any"],
                             [("Z", [R.store_link(r["code"], date), R.esc(r.get("dlabel") or ""),
                                     R.esc(r.get("time") or ""), R.apptag("Z"),
                                     R.esc(str(r.get("rating") or "-")), R.basket(r.get("basket")),
                                     R.words(r.get("review")), R.tag(r["tag"]) if r.get("tag") else "-"])
                              for r in low_w]
                             + [("S", [R.store_link(r.get("code") or "", date), R.dshort(r.get("d")),
                                       R.clock(r.get("t")), R.apptag("S"),
                                       "-" if r.get("rating") is None else R.n0(r.get("rating")),
                                       R.basket(r.get("basket")), R.words(r.get("words")), "-"])
                                for r in slow_wk]))
            + R.note("Only a small share of orders get rated, so treat each one as a specific customer, not a "
                     "percentage. Swiggy baskets show quantities from its item sheet.")))

    # 7. rider wait (Zomato only)
    body += R.sec("7", f"Where riders wait {R.apptag('Z')}<small>Zomato only</small>",
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
                     "fast the tablet button is pressed. Swiggy publishes no timing at all.")))

    # 8. false ready
    body += R.sec("8", f"&quot;Ready&quot; pressed before the food was ready {R.apptag('Z')}"
                       "<small>Zomato only</small>",
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

    # 9. money lost by store, both apps
    sval = {m["code"]: m.get("canc_val_wk") or 0 for m in (sw.get("money_stores") or [])}
    codes = list(dict.fromkeys([m["code"] for m in (A.get("money_stores") or [])] + list(sval)))
    zby = {m["code"]: m for m in (A.get("money_stores") or [])}
    mrows = sorted(({"c": c, "z": zby.get(c), "s": sval.get(c, 0),
                     "total": ((zby.get(c) or {}).get("total_wk") or 0) + sval.get(c, 0)} for c in codes),
                   key=lambda r: -r["total"])
    body += R.sec("9", "Money lost, by store",
        R.period(wk_label,
            R.rows(["Store", "Z turned-away", "Z refunds", "S cancelled on store", "Total lost",
                    "Z returned after pickup (net, not in total)"],
                   [[R.store_link(r["c"], date), R.money((r["z"] or {}).get("stockout_wk") or 0),
                     R.money((r["z"] or {}).get("refunds_wk") or 0), R.money(r["s"]),
                     f"<b>{R.money(r['total'])}</b>", R.money((r["z"] or {}).get("returned_wk") or 0)]
                    for r in mrows],
                   "Nothing lost this week, on either app.")
            + R.krow(R.kpi("Area total, 7 days, both apps", R.money(money_wk + canc_wk_val)))
            + R.note("Every rupee ties to an order listed in sections 3, 4 and 6. Nothing here is an estimate.")))

    # 10. area versus area, the same table the central page opens with, so an
    # AM sees their area in the network's terms without needing the central page
    def arow(a, i, view):
        cp = a["d_cpct"] if view == "day" else a["w_cpct"]
        row = [str(i + 1),
               (f"<b>{R.esc(a['am'])}</b>" if a["am"] == am else R.area_link(a["am"], date)),
               str(a["stores"]), R.n0(a["d_orders"] if view == "day" else a["w_orders"]),
               R.n2(cp), R.n0(a["d_srej"] if view == "day" else a["w_srej"]),
               f"{R.n0(a['d_off'] if view == 'day' else a['w_off'])} min"]
        row += [R.n0(a["w_fr"]), R.money(a["w_money"])]
        return row
    day_sorted = sorted(areas, key=lambda a: a["d_cpct"] if a["d_cpct"] is not None else 99)
    wk_sorted = sorted(areas, key=lambda a: a["w_cpct"] if a["w_cpct"] is not None else 99)
    avsa_cols = ["#", "Area manager", "Stores", "Orders", "Complaints %", "Store rejections", "Offline",
                 "False-ready wk", "Money lost wk"]
    body += R.sec("10", "Area versus area",
        R.period(dshort,
            R.rows(avsa_cols, [arow(a, i, "day") for i, a in enumerate(day_sorted)], sortable=True)
            + R.note("Ranked by complaint rate for this day, best first. Money lost and false-ready are always the "
                     "7-day figures, because a single day of either is too small to read. These columns are Zomato, "
                     "the comparison the five areas have in common."))
        + R.period(wk_label,
            R.rows(avsa_cols, [arow(a, i, "wk") for i, a in enumerate(wk_sorted)], sortable=True)
            + R.note("Ranked by complaint rate for the period shown, best first. Your area is in bold.")))

    body += R.footer_merged("Store names open that store&rsquo;s own page in the portal.")
    return R.page(f"Area Daily: {am}", body)


# ----------------------------------- central (v1, merged with Swiggy 30 Aug)
# The mail's twin of portal/app/(app)/daily/central/view.tsx. Central's question
# is neither the store's "what happened here" nor the area's "which of my stores
# needs me today" but "where do I put pressure, and which lever do I pull", so
# every receipt names its outlet AND its area manager, and every lever lists the
# stores behind it. Section 12 is the only block that is never shown to a store
# or an area manager.
def central_page(data, D, sw, areas, date):
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

    # The Swiggy half of the network day.
    sw = sw or {}
    SL = sw.get("levers") or {}
    srows = sw.get("stores") or []
    unmapped = sw.get("unmapped") or []
    short_series = sw.get("short_series") or []
    scanc_day = sw.get("canc_day") or []
    scanc_wk = sw.get("canc_wk") or []
    slow_day = sw.get("low_day") or []
    slow_wk = sw.get("low_wk") or []
    strend = sw.get("trend") or []
    slabels = [str(t.get("d", ""))[-2:] for t in strend]
    stips = [datetime.strptime(t["d"], "%Y-%m-%d").strftime("%a %-d %b") for t in strend]
    smoney_by = {m["code"]: m.get("canc_val_wk") or 0 for m in (sw.get("money_stores") or [])}
    s_orders_d = sum((r.get("orders") or 0) for r in srows)
    tot_orders_d = orders_d + s_orders_d
    slow_day_n = len([r for r in slow_day if (r.get("rating") if r.get("rating") is not None else 9) <= 2])
    scanc_day_val = sum((c.get("val") or 0) for c in scanc_day)
    scanc_wk_val = sum((c.get("val") or 0) for c in scanc_wk) + scanc_day_val
    unhappy_d = comps_d + slow_day_n
    unhappy_pct = (100.0 * unhappy_d / tot_orders_d) if tot_orders_d else None
    turn_d = srej_d + len(scanc_day)
    turn_pct = (100.0 * turn_d / (tot_orders_d + turn_d)) if tot_orders_d else None
    roas_day = (SL.get("adsg_day") or 0) / SL["burn_day"] if SL.get("burn_day") else None
    roas_wk = (SL.get("adsg_wk") or 0) / SL["burn_wk"] if SL.get("burn_wk") else None
    # Swiggy rolled up per area manager, for the both-apps table in section 2.
    s_by_am = {}
    for r in srows:
        k = r.get("am") or "Unassigned"
        a = s_by_am.setdefault(k, {"orders": 0, "low": 0, "canc": 0, "money": 0})
        a["orders"] += r.get("orders") or 0
        a["low"] += r.get("low") or 0
        a["canc"] += r.get("canc") or 0
        a["money"] += smoney_by.get(r["code"], 0)

    body = R.masthead("Creme Castle &middot; Network Daily &middot; Zomato + Swiggy &middot; Central Team",
                      "The whole network",
                      f"{len(stores)} stores, {len(areas)} areas. Zomato + Swiggy.",
                      R.date_label(date),
                      R.settled_note() + " Central&rsquo;s question is not &ldquo;what happened here&rdquo; but "
                      "&ldquo;where do I put pressure, and which lever do I pull&rdquo;, so every number below "
                      "names its outlet AND its area manager, and every lever lists the stores behind it.")

    pc = lambda a, b: (100.0 * a / b) if b else None
    body += R.context(
        R.vtile("Orders, both apps", R.n0(tot_orders_d),
                f"{R.apptag('Z')}{R.n0(orders_d)} &nbsp;{R.apptag('S')}{R.n0(s_orders_d)}", orders_d >= avg_day,
                f"Zomato {'+' if orders_d >= avg_day else ''}"
                f"{round(100.0 * (orders_d - avg_day) / (avg_day or 1))}% on its weekly daily average"),
        R.vtile("Unhappy orders, both apps",
                f"{R.n0(unhappy_d)} <small>({R.n1(unhappy_pct)}% of orders)</small>",
                f"{R.apptag('Z')}{R.n0(comps_d)} complaints &nbsp;{R.apptag('S')}{slow_day_n} low-starred",
                (unhappy_pct or 0) <= 2, "share of the day&rsquo;s orders that went wrong for a customer"),
        R.vtile("Turned away, both apps",
                f"{R.n0(turn_d)} <small>({R.n1(turn_pct)}% of what came)</small>",
                f"{R.money(sum((r.get('value') or 0) for r in rej_t) + scanc_day_val)} of orders lost yesterday",
                turn_d == 0, "goal is zero: each one is a customer told no"),
        R.vtile("Swiggy GMV", R.lakh(SL.get("gmv_day")),
                "gross: before discounts, GST included; bridge in section 12",
                (SL.get("gmv_day") or 0) >= (SL.get("gmv_wk") or 0) / 7,
                f"{'+' if (SL.get('gmv_day') or 0) >= (SL.get('gmv_wk') or 0) / 7 else ''}"
                f"{round(100.0 * ((SL.get('gmv_day') or 0) - (SL.get('gmv_wk') or 0) / 7) / (((SL.get('gmv_wk') or 0) / 7) or 1))}"
                "% on the week&rsquo;s daily average"),
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
        R.vtile("Money lost, week, both apps", R.money(money_wk + scanc_wk_val),
                f"{R.apptag('Z')}{R.money(money_wk)} &nbsp;{R.apptag('S')}{R.money(scanc_wk_val)}",
                money_wk + scanc_wk_val == 0, "goal is zero: every rupee ties to an order"),
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
            + R.chart([t.get("orders") for t in strend], slabels, tips=stips,
                      title="Swiggy orders per day", lo=0, dec=0)
            + R.chart([(None if t.get("gmv") is None else round(t["gmv"] / 1000)) for t in strend],
                      slabels, tips=stips, title="Swiggy GMV per day (₹ thousands, gross)", lo=0, dec=0)
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
                     "stores and then into orders."))
        + R.period(f"{dshort}, both apps together",
            R.rows(["Area manager", "Stores", "Orders", "By app", "Unhappy", "Turned away", "Money lost, week"],
                   [[R.area_link(a["am"], date), str(a["stores"]),
                     R.n0(a["d_orders"] + (s_by_am.get(a["am"], {}).get("orders") or 0)),
                     f"{R.apptag('Z')}{R.n0(a['d_orders'])} "
                     f"{R.apptag('S')}{R.n0(s_by_am.get(a['am'], {}).get('orders') or 0)}",
                     R.n0(a["d_comps"] + (s_by_am.get(a["am"], {}).get("low") or 0)),
                     R.n0(a["d_srej"] + (s_by_am.get(a["am"], {}).get("canc") or 0)),
                     R.money(a["w_money"] + (s_by_am.get(a["am"], {}).get("money") or 0))]
                    for a in sorted(areas, key=lambda a: -(a["d_orders"]
                                                           + (s_by_am.get(a["am"], {}).get("orders") or 0)))])
            + R.note("Unhappy = Zomato complaints + Swiggy 1-2 star orders yesterday. Money lost is the 7-day "
                     "avoidable-loss total for that AM&rsquo;s stores, both apps.")),
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
    zview3 = R.rows(["#", "Store", "AM", "Orders", "vs avg", "Online %", "Rej", "Comp", "Rating", "Wait",
                     "False ready wk", "Lost wk"],
                    [srow(s, "day") for s in sorted(stores, key=lambda s: s.get("dayRank") or 99)], sortable=True)
    sview3 = (R.swiggy_stores_table(srows, date, show_am=True)
              + R.note("Swiggy publishes no rider timing, so Wait is empty on this tab. # is the store&rsquo;s rank "
                       "in the Swiggy league (cancellations + 1-2 star orders + hours offline), lower is better."))
    body += R.sec("3", f"All {len(stores)} stores",
        R.period(f"{dshort}, ranked worst-first",
            R.apptabs("s3") + R.s1view("s3", "z", zview3) + R.s1view("s3", "s", sview3, off=True)
            + R.note("Ranked by clean-day score: complaints % + rejections % + offline penalty, lower is better "
                     "(ties by rating, then orders). Red marks a number worth a question, not a verdict. Store names "
                     "open the store page for the same day."
                     + (f" <b>{R.esc(', '.join(unmapped))} has no Swiggy outlet in the map</b> and appears only on "
                        "the Zomato tab." if unmapped else "")))
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
                     f'<div class="mval">{R.n1(dp["online_day"])}% <small>on the day</small></div>'
                     f'<div class="mnote">{R.n0(dp["offmin_day"])} min offline that day &middot; '
                     f'{R.n0(dp["offmin_wk"])} min across the week</div>'
                     + R.chart(ser, labs, tips=tps, title="Online % per day (day of month)", unit="%",
                               lo=min(90, min(ser)) - 1, hi=100, width=280, height=96) + "</div>")
    zdips = len(cards)
    cards += [R.short_card(x) for x in short_series[:8]]
    body += R.sec("4", "Outlets not fully online",
        R.period(f"{dshort} dips, each with its own 7-day line",
            (f'<div class="minigrid">{"".join(cards)}</div>' if cards
             else R.note("Every store was fully online on both apps on this day."))
            + R.note(f"{zdips} of {len(stores)} stores dipped on Zomato, {R.n0(offmin_d)} minutes of trading lost "
                     "between them on this day alone."
                     + (f" Showing the worst 8 Swiggy offenders of {len(short_series)} with missing hours this week."
                        if len(short_series) > 8 else "")
                     + " Zomato reports total minutes offline per day and Swiggy hours open against its expected "
                       "window; neither says the clock times, the store can.")),
        lead="A store that is offline sells nothing and is invisible in every other number on this page. This is "
             "the first section to read.")

    # 5. the shut-shop tracker
    body += R.sec("5", "Orders turned away because the shop was shut",
        R.shut_shop(D, dshort, wk_label, show_am=True, date=date),
        lead="The one number on this page that should be zero. A store cannot be sent an order unless Zomato thinks "
             "it is open, so each of these is a listing that was live while the shop could not serve. Section 4 is "
             "the opposite case, the listing itself going down.")

    # 6. turned away or cancelled on the store, both apps, plus the F49 list
    rej_val_d = sum((r.get("value") or 0) for r in rej_t)
    rej_val_w = sum((r.get("value") or 0) for r in (D.get("rejections") or []))
    returned = D.get("returned") or []
    body += R.sec("6", "Turned away or cancelled on the store",
        R.period(dshort,
            R.approws("turn-day",
                      ["Store", "AM", "Time", "App", "Reason", "What the customer had ordered", "Value lost"],
                      [("Z", [R.store_link(r["code"], date), R.esc(r["am"]), R.esc(r.get("time") or ""),
                              R.apptag("Z"), R.faulttag(r.get("reason") or "no reason"),
                              R.basket(r.get("basket")), R.money(r.get("value"))]) for r in rej_t]
                      + [("S", [R.store_link(c.get("code") or "", date), R.esc(c.get("am") or ""),
                                R.clock(c.get("t")), R.apptag("S"), R.faulttag(c.get("why")),
                                R.basket(c.get("basket")),
                                "n/a" if c.get("val") is None else R.money(c.get("val"))]) for c in scanc_day],
                      "Nothing was turned away on either app on this day.")
            + R.note(f"{R.money(rej_val_d + scanc_day_val)} of trade turned away on this day, both apps."))
        + R.period(wk_label,
            R.fold("Earlier this week, both apps", len(rej_w) + len(scanc_wk),
                   R.approws("turn-wk",
                             ["Store", "AM", "Day", "Time", "App", "Reason", "What the customer had ordered",
                              "Value lost"],
                             [("Z", [R.store_link(r["code"], date), R.esc(r["am"]), R.esc(r.get("dlabel") or ""),
                                     R.esc(r.get("time") or ""), R.apptag("Z"),
                                     R.faulttag(r.get("reason") or "no reason"), R.basket(r.get("basket")),
                                     R.money(r.get("value"))]) for r in rej_w]
                             + [("S", [R.store_link(c.get("code") or "", date), R.esc(c.get("am") or ""),
                                       R.dshort(c.get("d")), R.clock(c.get("t")), R.apptag("S"),
                                       R.faulttag(c.get("why")), R.basket(c.get("basket")),
                                       "n/a" if c.get("val") is None else R.money(c.get("val"))])
                                for c in scanc_wk]))
            + R.note("Swiggy values and baskets come from the billed Petpooja order, matched on Swiggy&rsquo;s own "
                     f"order number, never on a name. {R.money(scanc_wk_val)} of Swiggy orders were cancelled on "
                     "stores across the 7 days.")
            + R.note(f"{R.money(rej_val_w)} across the 7 days on Zomato, every rupee of it an order a customer tried "
                     "to place. Only rejections Zomato itself marks as made by the store are listed (<b>items out of "
                     "stock, kitchen is full, restaurant is closed, timeout, device issue</b>). Customer and rider "
                     "cancellations are excluded, and orders cancelled after pickup have their own list below.")
            + R.note(f"Two counts, as with complaints. Zomato&rsquo;s daily report counts {R.n0(srej_w)} store "
                     f"rejections for the week; {R.n0(len(D.get('rejections') or []))} order rows carry one of those "
                     "reasons. The list is the shorter of the two because only orders that reached the store appear "
                     "in the order feed. Both are true; never add them together."))
        + R.period("Cancelled after the rider picked up (not the store's fault)",
            R.fold("Returned orders this week, every one", len(returned),
                   R.rows(["Store", "AM", "Day", "Time", "What the customer had ordered", "Bill", "Zomato paid",
                           "Net loss"],
                          [[R.store_link(r["code"], date), R.esc(r.get("am") or ""), R.esc(r.get("dlabel") or ""),
                            R.esc(r.get("time") or ""), R.basket(r.get("basket")), R.money(r.get("value")),
                            R.money(r.get("comp")), R.money(r.get("net"))] for r in returned]))
            + R.note(f"{R.n0(len(returned))} orders, "
                     f"{R.money(sum((r.get('value') or 0) for r in returned))} on the bill, "
                     f"{R.money(sum((r.get('net') or 0) for r in returned))} net after Zomato&rsquo;s compensation. "
                     "The store accepted, made and handed these over; Zomato then cancelled them (the customer could "
                     "not receive the order, or a rider problem after pickup). Zomato&rsquo;s report shortens the "
                     "commonest case to &quot;Unavailable to accept the order&quot;; Petpooja holds the full "
                     "sentence. Not counted as turned away, not in section 11.")),
        lead="A rejection or a store-charged cancellation is a customer who wanted to buy and was told no. Each row "
             "is one of them, from either app.")

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

    # 8. low ratings, both apps
    body += R.sec("8", "1, 2 and 3-star orders",
        R.period(dshort,
            R.fold(f"Low-rated orders on {R.esc(dshort)}, both apps", len(low_t) + len(slow_day),
                   R.approws("low-day",
                             ["Store", "AM", "Time", "App", "Stars", "What was in the order",
                              "What the customer wrote", "Complaint tag if any"],
                             [("Z", [R.store_link(r["code"], date), R.esc(r["am"]), R.esc(r.get("time") or ""),
                                     R.apptag("Z"), R.esc(str(r.get("rating") or "-")), R.basket(r.get("basket")),
                                     R.words(r.get("review")), R.tag(r["tag"]) if r.get("tag") else "-"])
                              for r in low_t]
                             + [("S", [R.store_link(r.get("code") or "", date), R.esc(r.get("am") or ""),
                                       R.clock(r.get("t")), R.apptag("S"),
                                       "-" if r.get("rating") is None else R.n0(r.get("rating")),
                                       R.basket(r.get("basket")), R.words(r.get("words")), "-"])
                                for r in slow_day]),
                   open_=len(low_t) + len(slow_day) <= 40))
        + R.period(wk_label,
            R.fold(f"Low-rated orders earlier this week (newest {len(low_w)} of {len(low_w_all)} Zomato, "
                   f"all {len(slow_wk)} Swiggy)", len(low_w) + len(slow_wk),
                   R.approws("low-wk",
                             ["Store", "AM", "Day", "Time", "App", "Stars", "What was in the order",
                              "What the customer wrote", "Complaint tag if any"],
                             [("Z", [R.store_link(r["code"], date), R.esc(r["am"]), R.esc(r.get("dlabel") or ""),
                                     R.esc(r.get("time") or ""), R.apptag("Z"),
                                     R.esc(str(r.get("rating") or "-")), R.basket(r.get("basket")),
                                     R.words(r.get("review")), R.tag(r["tag"]) if r.get("tag") else "-"])
                              for r in low_w]
                             + [("S", [R.store_link(r.get("code") or "", date), R.esc(r.get("am") or ""),
                                       R.dshort(r.get("d")), R.clock(r.get("t")), R.apptag("S"),
                                       "-" if r.get("rating") is None else R.n0(r.get("rating")),
                                       R.basket(r.get("basket")), R.words(r.get("words")), "-"])
                                for r in slow_wk]))
            + R.note(f"{R.n0(D.get('low_ratings_total'))} low-rated Zomato orders in the 7 days, plus "
                     f"{R.n0(len(slow_wk) + len(slow_day))} low-starred Swiggy orders. Only a small share of orders "
                     "are rated at all, so treat each row as one specific customer, never as a percentage. Ratings "
                     "for the newest days keep arriving for several days afterwards.")),
        lead="A rating is the only place the customer speaks in their own time. These are the ones who were unhappy "
             "enough to say so.")

    # 9. rider wait
    body += R.sec("9", f"Where riders wait {R.apptag('Z')}<small>Zomato only</small>",
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
                     "under 3% of orders. Rider wait is the verified speed measure: Zomato&rsquo;s kitchen "
                     "preparation time is excluded permanently because it only tracks how fast the tablet button is "
                     "pressed, and Swiggy publishes no timing at all.")),
        lead="Every minute a rider stands in a store is a minute the order is late and the rider is not paid. This "
             "is the one speed number the data can prove.")

    # 10. false ready
    body += R.sec("10", "&quot;Ready&quot; pressed before the food was ready "
                   f"{R.apptag('Z')}<small>Zomato only</small>",
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

    # 11. money lost by store, both apps
    zby = {m["code"]: m for m in (D.get("money_stores") or [])}
    sam = {m["code"]: m.get("am") for m in (sw.get("money_stores") or [])}
    mcodes = list(dict.fromkeys(list(zby) + list(smoney_by)))
    mrows = sorted(({"c": c, "z": zby.get(c), "s": smoney_by.get(c, 0),
                     "am": (zby.get(c) or {}).get("am") or sam.get(c) or "",
                     "total": ((zby.get(c) or {}).get("total_wk") or 0) + smoney_by.get(c, 0)} for c in mcodes),
                   key=lambda r: -r["total"])
    body += R.sec("11", "Money lost, by store",
        R.period(wk_label,
            R.rows(["Store", "AM", "Z turned-away", "Z refunds", "S cancelled on store", "Total lost",
                    "Z returned after pickup (net, not in total)"],
                   [[R.store_link(r["c"], date), R.esc(r["am"]),
                     R.money((r["z"] or {}).get("stockout_wk") or 0),
                     R.money((r["z"] or {}).get("refunds_wk") or 0), R.money(r["s"]),
                     f"<b>{R.money(r['total'])}</b>", R.money((r["z"] or {}).get("returned_wk") or 0)]
                    for r in mrows],
                   "Nothing lost this week, on either app.", sortable=True)
            + R.note(f"{R.money(money_wk + scanc_wk_val)} network-wide, both apps. Every rupee here ties to an order "
                     "listed in sections 6, 7 and 8. Nothing on this line is an estimate, and offline minutes are "
                     "NOT included: what a closed store would have sold cannot be measured, only guessed.")),
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
    swiggy_money = R.period(f"Swiggy money, {dshort} (the block the store sheets deliberately do not have)",
        R.context(
            R.vtile("Swiggy GMV", R.lakh(SL.get("gmv_day")), f"week {R.lakh(SL.get('gmv_wk'))}",
                    (SL.get("gmv_day") or 0) >= (SL.get("gmv_wk") or 0) / 7,
                    "gross: before discounts, GST included"),
            R.vtile("Coupon discounts", R.lakh(SL.get("cd_day")),
                    f"you funded {R.money(SL.get('rtd_day'))} &middot; Swiggy funded {R.money(SL.get('std_day'))}",
                    False,
                    f"week {R.lakh(SL.get('cd_wk'))}: you {R.money(SL.get('rtd_wk'))}, "
                    f"Swiggy {R.money(SL.get('std_wk'))}"),
            R.vtile("Ads return", "-" if roas_day is None else f"{R.n1(roas_day)}x",
                    f"{R.money(SL.get('burn_day'))} burnt for {R.money(SL.get('adsg_day'))} of ad-driven sales",
                    (roas_day or 0) >= 5,
                    f"goal 5x, red below 3x; week {'-' if roas_wk is None else R.n1(roas_wk) + 'x'}"),
            R.vtile("Menu-to-order", "-" if SL.get("conv_day") is None else f"{R.n1(SL['conv_day'])}%",
                    "of Swiggy menu visits network-wide", True, "the Swiggy funnel&rsquo;s one number"),
            R.vtile("New customers", R.n0(SL.get("ntr_day")),
                    f"of {R.n0((SL.get('ntr_day') or 0) + (SL.get('rtr_day') or 0))} Swiggy orders yesterday",
                    True, "Swiggy&rsquo;s own new-to-restaurant count"))
        + R.note("<b>The Petpooja bridge, printed daily:</b> Swiggy reports "
                 f"{R.lakh(SL.get('gmv_day'))} GMV for this day; Petpooja billed "
                 f"{R.n0((SL.get('bridge') or {}).get('pp_n'))} delivered Swiggy + Toing orders worth "
                 f"{R.lakh((SL.get('bridge') or {}).get('pp_g'))} in the same gross terms"
                 + (f", a gap of {R.money(abs(((SL.get('bridge') or {}).get('pp_g') or 0) - SL['gmv_day']))} "
                    f"({R.n1(100.0 * abs(((SL.get('bridge') or {}).get('pp_g') or 0) - SL['gmv_day']) / SL['gmv_day'])}%)"
                    if SL.get("gmv_day") else "")
                 + ", explained by split multi-cake deliveries and the midnight boundary.")
        + R.tlabel("Swiggy coupons this week, biggest first")
        + R.rows(["Coupon", "Orders", "Customer discount"],
                 [[R.esc(c.get("code") or ""), R.n0(c.get("n")), R.money(c.get("cd"))]
                  for c in (SL.get("top_coupons") or [])], "No Swiggy coupons ran this week.")
        + R.tlabel("Swiggy by store, last 7 days (stores running ads)")
        + R.rows(["Store", "AM", "GMV, week", "Ads burnt", "Return"],
                 [[R.store_link(l["code"], date), R.esc(l.get("am") or ""), R.money(l.get("gmv_wk")),
                   R.money(l.get("burn_wk")),
                   ("-" if not l.get("burn_wk")
                    else R.flag(f"{R.n1((l.get('adsg_wk') or 0) / l['burn_wk'])}x",
                                (l.get("adsg_wk") or 0) / l["burn_wk"] < 3))]
                  for l in (SL.get("store_levers") or [])], "No store ran Swiggy ads this week."))
    body += R.sec("12", "Central levers (never shown to a store or an area manager)",
        swiggy_money
        + R.tlabel(f"{R.apptag('Z')}Zomato levers, as before")
        + lever_tiles
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
        lead="Discounts, ads and the funnel, on both apps. This is the block that separates the central page from "
             "the area page: these are the numbers only central can move, and each one lists the stores it came "
             "from.")

    body += R.footer_merged("Every figure on this page comes from the spine functions <b>dash_all</b>, "
                            "<b>dash_central_detail</b> and <b>dash_central_swiggy</b> and is reproducible by query. "
                            "Store and area manager names open their own pages in the portal.")
    return R.page("Network Daily: the whole network", body)
