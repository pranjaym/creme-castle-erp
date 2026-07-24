"""Briefing engine. Generates ranked insights for the day."""
from collections import defaultdict
from metrics import pct_delta
from metrics_v2 import dark_outlets


def _format_hour(h):
    """Format hour 0-23 as 12-hour clock."""
    if h == 0: return "12am"
    if h < 12: return f"{h}am"
    if h == 12: return "12pm"
    return f"{h-12}pm"


def build(focal_dt, top_f, top_c, top_a, out_f, out_c, out_a, cities, orders=None):
    """Returns list of {level, tag, title, detail, action, impact_value, impact_label}."""
    B = []
    f, c, a = top_f["All"], top_c["All"], top_a["All"]

    # 1. Brand headline with volume vs AOV decomposition
    rd = pct_delta(f["net_rev"], c["net_rev"])
    od = pct_delta(f["orders"], c["orders"])
    ad = pct_delta(f["aov"], c["aov"])
    if rd is not None:
        if rd > 5:    lvl, tag = "positive", "STRONG DAY"
        elif rd > -5: lvl, tag = "watch", "STEADY"
        elif rd > -15:lvl, tag = "warning", "DOWN"
        else:         lvl, tag = "critical", "WEAK DAY"
        if c["orders"] and c["aov"]:
            ord_eff = (f["orders"] - c["orders"]) * c["aov"]
            aov_eff = (f["aov"] - c["aov"]) * f["orders"]
            if abs(ord_eff) > abs(aov_eff) * 1.5:
                cause = f"driven by volume ({od:+.1f}% orders)"
            elif abs(aov_eff) > abs(ord_eff) * 1.5:
                cause = f"driven by ticket size ({ad:+.1f}% AOV)"
            else:
                cause = f"orders {od:+.1f}%, AOV {ad:+.1f}%"
        else:
            cause = ""
        B.append({
            "level": lvl, "tag": tag,
            "title": f"Brand revenue {rd:+.1f}% vs {focal_dt.strftime('%a')} last week",
            "detail": f"Rs.{f['net_rev']/1000:.1f}K on {f['orders']:,} orders vs Rs.{c['net_rev']/1000:.1f}K on {c['orders']:,} - {cause}.",
            "action": "Compare per-platform - Zomato and Swiggy may be moving in opposite directions.",
            "impact_value": f"Rs.{(f['net_rev']-c['net_rev'])/1000:+.0f}K",
            "impact_label": "vs LW",
        })

    # 2. Platform divergence
    z = pct_delta(top_f["Zomato"]["orders"], top_c["Zomato"]["orders"])
    s = pct_delta(top_f["Swiggy"]["orders"], top_c["Swiggy"]["orders"])
    if z is not None and s is not None and abs(z - s) > 15:
        if z > s: stronger, weaker, sd, wd = "Zomato", "Swiggy", z, s
        else:     stronger, weaker, sd, wd = "Swiggy", "Zomato", s, z
        B.append({
            "level": "watch", "tag": "PLATFORM SPLIT",
            "title": f"{stronger} {sd:+.0f}% but {weaker} {wd:+.0f}% on orders",
            "detail": f"Platforms diverged by {abs(z-s):.0f}pp. Often signals a discount construct change, ad bid shift, or visibility issue on the lagging platform.",
            "action": f"Pull {weaker} ad spend and discount construct - check if codes or BOS positioning regressed.",
            "impact_value": f"{abs(z-s):.0f}pp",
            "impact_label": "platform gap",
        })

    # 3. Outlet revenue crashes — identifies which platform crashed
    crashes = []
    for o, fr in out_f.items():
        cr = out_c.get(o)
        if not cr or cr["net_rev"] < 5000: continue
        d = pct_delta(fr["net_rev"], cr["net_rev"])
        if d is None or d > -25: continue

        # Per-platform deltas (only meaningful if comp had ≥ 5 orders on that platform)
        z_d = pct_delta(fr["z_orders"], cr["z_orders"]) if cr["z_orders"] >= 5 else None
        s_d = pct_delta(fr["s_orders"], cr["s_orders"]) if cr["s_orders"] >= 5 else None

        # Classify: where did the crash come from?
        z_crashed = z_d is not None and z_d <= -25
        s_crashed = s_d is not None and s_d <= -25
        if z_crashed and s_crashed:
            tag = "BOTH PLATFORMS CRASHED"
            detail_extra = f"Zomato {z_d:+.0f}% ({cr['z_orders']}→{fr['z_orders']}), Swiggy {s_d:+.0f}% ({cr['s_orders']}→{fr['s_orders']}). Probably outlet-level — supply, listing, or operations."
        elif z_crashed:
            tag = "ZOMATO CRASHED"
            detail_extra = f"Zomato {z_d:+.0f}% ({cr['z_orders']}→{fr['z_orders']}); Swiggy {(s_d or 0):+.0f}% ({cr['s_orders']}→{fr['s_orders']}) — only Zomato is the issue. Likely BOS bid, code, visibility on Zomato."
        elif s_crashed:
            tag = "SWIGGY CRASHED"
            detail_extra = f"Swiggy {s_d:+.0f}% ({cr['s_orders']}→{fr['s_orders']}); Zomato {(z_d or 0):+.0f}% ({cr['z_orders']}→{fr['z_orders']}) — only Swiggy is the issue. Check Swiggy ads, code, visibility."
        else:
            tag = "OUTLET CRASH"
            detail_extra = f"Z {fr['z_orders']} vs {cr['z_orders']}, S {fr['s_orders']} vs {cr['s_orders']}."

        crashes.append((o, fr, cr, d, tag, detail_extra))
    crashes.sort(key=lambda x: x[3])
    for o, fr, cr, d, tag, extra in crashes[:6]:
        B.append({
            "level": "critical", "tag": tag,
            "title": f"{o}: revenue {d:+.0f}% vs LW",
            "detail": f"Rs.{fr['net_rev']/1000:.1f}K vs Rs.{cr['net_rev']/1000:.1f}K. {extra}",
            "action": "Cross-reference with inventory dashboard to confirm if supply-driven. If not, check ad spend and discount codes for the affected platform(s).",
            "impact_value": f"Rs.{(fr['net_rev']-cr['net_rev'])/1000:+.0f}K",
            "impact_label": "vs LW",
        })

    # 3b. Hidden platform crashes — outlet total looks ok but one platform crashed
    # while the other compensated. Standard total view hides this.
    for o, fr in out_f.items():
        cr = out_c.get(o)
        if not cr: continue
        if cr["z_orders"] < 8 or cr["s_orders"] < 8: continue
        # Skip cases already flagged as outlet crashes (revenue down >25%)
        d_total = pct_delta(fr["net_rev"], cr["net_rev"])
        if d_total is not None and d_total <= -25: continue

        z_d = pct_delta(fr["z_orders"], cr["z_orders"])
        s_d = pct_delta(fr["s_orders"], cr["s_orders"])
        if z_d is None or s_d is None: continue

        # One side crashed ≥30% AND the gap between Z and S is ≥40pp
        if z_d <= -30 and (s_d - z_d) >= 40:
            B.append({
                "level": "warning", "tag": "HIDDEN ZOMATO CRASH",
                "title": f"{o}: Zomato {z_d:+.0f}% but total looks ok",
                "detail": f"Zomato {cr['z_orders']}→{fr['z_orders']} ({z_d:+.0f}%) while Swiggy {cr['s_orders']}→{fr['s_orders']} ({s_d:+.0f}%) compensated. Total view hides this.",
                "action": "Check Zomato BOS bid, code construct, listing visibility for this outlet.",
                "impact_value": f"{z_d:+.0f}%",
                "impact_label": "Zomato vs LW",
            })
        elif s_d <= -30 and (z_d - s_d) >= 40:
            B.append({
                "level": "warning", "tag": "HIDDEN SWIGGY CRASH",
                "title": f"{o}: Swiggy {s_d:+.0f}% but total looks ok",
                "detail": f"Swiggy {cr['s_orders']}→{fr['s_orders']} ({s_d:+.0f}%) while Zomato {cr['z_orders']}→{fr['z_orders']} ({z_d:+.0f}%) compensated. Total view hides this.",
                "action": "Check Swiggy ads, code construct, listing visibility for this outlet.",
                "impact_value": f"{s_d:+.0f}%",
                "impact_label": "Swiggy vs LW",
            })
    for c_name, cd in cities.items():
        d = cd.get("d_rev_lw")
        if d is None: continue
        if d <= -15 and cd["comp_rev"] > 50000:
            B.append({
                "level": "warning", "tag": "CLUSTER DOWN",
                "title": f"{c_name} cluster {d:+.0f}% vs LW",
                "detail": f"Rs.{cd['net_rev']/1000:.0f}K vs Rs.{cd['comp_rev']/1000:.0f}K across {cd['outlets']} outlets. Could be city-wide demand, weather, or competitive event.",
                "action": "Look for outlets in this cluster acting against the trend - they hold the explanation.",
                "impact_value": f"Rs.{(cd['net_rev']-cd['comp_rev'])/1000:+.0f}K",
                "impact_label": "cluster",
            })
        elif d >= 20 and cd["comp_rev"] > 50000:
            B.append({
                "level": "positive", "tag": "CLUSTER UP",
                "title": f"{c_name} cluster {d:+.0f}% vs LW",
                "detail": f"Rs.{cd['net_rev']/1000:.0f}K vs Rs.{cd['comp_rev']/1000:.0f}K across {cd['outlets']} outlets. Investigate what drove this - may be replicable.",
                "action": "Identify the strongest outlet in the cluster and what changed yesterday.",
                "impact_value": f"Rs.{(cd['net_rev']-cd['comp_rev'])/1000:+.0f}K",
                "impact_label": "cluster",
            })

    # 5. Cancellation spikes
    cancels = [(o, fr) for o, fr in out_f.items() if fr["orders"] >= 20 and fr["cancel_pct"] >= 5]
    cancels.sort(key=lambda x: -x[1]["cancel_pct"])
    for o, fr in cancels[:5]:
        B.append({
            "level": "warning", "tag": "CANCEL SPIKE",
            "title": f"{o}: {fr['cancel_pct']:.1f}% cancellation rate",
            "detail": f"{fr['cancel']} of {fr['orders']+fr['cancel']} orders cancelled. Common causes: kitchen overload, OOS-after-acceptance, rider shortage, address conflicts.",
            "action": "Pull cancellation reasons from Petpooja for this outlet yesterday.",
            "impact_value": f"{fr['cancel']}",
            "impact_label": "cancelled",
        })

    # 6. Discount creep at top outlets
    for o, fr in out_f.items():
        cr = out_c.get(o)
        if not cr or cr["orders"] < 30: continue
        d = fr["out_disc_pct"] - cr["out_disc_pct"]
        if d >= 3:
            B.append({
                "level": "warning", "tag": "DISCOUNT CREEP",
                "title": f"{o}: outlet disc {cr['out_disc_pct']:.1f}% -> {fr['out_disc_pct']:.1f}% (+{d:.1f}pp)",
                "detail": f"Outlet's share of discount cost rose {d:.1f}pp. Either base-code construct changed or aggregator funding dropped.",
                "action": "Pull this outlet's rate-card status from Pawan - check if Zomato/Swiggy revised funding.",
                "impact_value": f"+{d:.1f}pp",
                "impact_label": "outlet disc",
            })

    # 7. Cake share regression vs 7-day avg
    fc = top_f["All"]["cake_share_rev"]
    cc = top_c["All"]["cake_share_rev"]
    ac = top_a["All"]["cake_share_rev"] if top_a else None
    if ac and abs(fc - ac) >= 3:
        if fc > ac: lvl, verb = "positive", "up"
        else:       lvl, verb = "watch", "down"
        B.append({
            "level": lvl, "tag": "CAKE SHARE",
            "title": f"Cake revenue share at {fc:.1f}% - {verb} {abs(fc - ac):.1f}pp vs 7-day avg",
            "detail": f"Cake share is the leading retention indicator. 7-day avg is {ac:.1f}%, last week same DOW was {cc:.1f}%.",
            "action": "Check premium cake SKU availability and BOS-Cake bid for top 5 outlets." if fc < ac else "Look at top cake SKUs to see what drove the lift.",
            "impact_value": f"{fc-ac:+.1f}pp",
            "impact_label": "vs 7d avg",
        })

    # 8. Aggregator funding shift
    for plat in ["Zomato", "Swiggy"]:
        f_af = top_f[plat]["agg_funding_pct"]
        c_af = top_c[plat]["agg_funding_pct"]
        if c_af > 5 and (c_af - f_af) >= 5:
            B.append({
                "level": "warning", "tag": "FUNDING SHIFT",
                "title": f"{plat}: aggregator funding {c_af:.1f}% -> {f_af:.1f}%",
                "detail": f"Aggregator's share of discount cost dropped {c_af-f_af:.1f}pp. Cost is shifting to outlet without a code change.",
                "action": "Confirm rate-card with platform AM. May be a quiet funding rollback.",
                "impact_value": f"-{c_af-f_af:.1f}pp",
                "impact_label": "agg funding",
            })

    # 9. Single big outlet wins (positive context)
    wins = []
    for o, fr in out_f.items():
        cr = out_c.get(o)
        if not cr or cr["net_rev"] < 8000: continue
        d = pct_delta(fr["net_rev"], cr["net_rev"])
        if d is not None and d >= 30:
            wins.append((o, fr, cr, d))
    wins.sort(key=lambda x: -x[3])
    for o, fr, cr, d in wins[:3]:
        B.append({
            "level": "positive", "tag": "OUTLET WIN",
            "title": f"{o}: revenue {d:+.0f}% vs LW",
            "detail": f"Rs.{fr['net_rev']/1000:.1f}K vs Rs.{cr['net_rev']/1000:.1f}K. Worth understanding what changed.",
            "action": "Check if a new code, ad push, or local promotion drove this. May be replicable.",
            "impact_value": f"Rs.{(fr['net_rev']-cr['net_rev'])/1000:+.0f}K",
            "impact_label": "vs LW",
        })

    # 10. Dark outlets — 3+ consecutive hours zero orders during 7am–2am
    if orders is not None:
        dark = dark_outlets(orders, focal_dt, min_consecutive=3)
        for d in dark[:6]:
            if d["expected_orders"] is None: continue
            gap_str = f"{_format_hour(d['gap_start'])}–{_format_hour((d['gap_end']+1) % 24)}"
            B.append({
                "level": "critical", "tag": "OUTLET WENT DARK",
                "title": f"{d['outlet']}: {d['gap_hours']}h gap with zero orders ({gap_str})",
                "detail": f"No orders received between {gap_str}. Normally takes ~{d['expected_orders']:.0f} orders in this window on the same DOW. Outlet did {d['total_orders']} orders total today.",
                "action": "Check listing status (paused/closed), kitchen availability, and platform connectivity for this outlet during the gap.",
                "impact_value": f"{d['gap_hours']}h",
                "impact_label": "dark window",
            })

    order = {"critical": 0, "warning": 1, "watch": 2, "positive": 3}
    B.sort(key=lambda b: order.get(b["level"], 9))
    return B
