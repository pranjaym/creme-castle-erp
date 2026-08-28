#!/usr/bin/env python3
"""
Render the intraday pulse as an HTML dashboard in the CC Spot Check's own visual
language: its stylesheet, its section order, its metric definitions.

Why match rather than invent: Pranjay already reads the spot check every day. A
second dashboard with its own look and its own slightly different "sales" number
would cost him the one thing a spot check is for, which is a glance he can trust.
So the stylesheet is his, the definitions are his (see pulse_data.py), and parity was
proved against a real generated spot check before a line of this was written.

What is NEW here, and the reason it exists: the three category readings Pranjay
asked for on Rakhi morning, Cakes / Desserts / Rakhi collection, which the spot check
cannot show because it reads only the order level report and categories live in the
item level one.

    python3 render_pulse.py                       # now
    python3 render_pulse.py --cutoff 12:00        # as at a past clock time today
    python3 render_pulse.py --open                # and open it
"""
import argparse
import datetime as dt
import os
import sys
import webbrowser
from html import escape

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pulse_data as pd_


def load_env():
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))),
                        "dashboard", "auto", ".env")
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# ------------------------------------------------------------------ formatting --

def rupees(n):
    """Indian digit grouping. Rs 3,48,120, never 348,120."""
    if n is None:
        return "-"
    n = int(round(float(n)))
    sign, s = ("-" if n < 0 else ""), str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:]); head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return sign + s


def lakh(n):
    """The spot check's own short form: 6.6L, 12.4L."""
    n = float(n or 0)
    if abs(n) >= 100000:
        return f"{n / 100000:.1f}L"
    if abs(n) >= 1000:
        return f"{n / 1000:.1f}K"
    return f"{n:.0f}"


def dpct(now, base):
    """Percent delta with the spot check's good/bad colouring."""
    if not base:
        return '<span class="delta neutral">n/a</span>'
    d = (float(now) - float(base)) / float(base) * 100
    cls = "good" if d > 2 else ("bad" if d < -2 else "neutral")
    return f'<span class="delta {cls}">{d:+.1f}%</span>'


def dnew(now, base, fmt=lambda v: f"{v:,.0f}"):
    """A delta for things that may not have existed before.

    A category launched for this festival has a baseline of zero, and "+infinity%" or
    a silently suppressed row would both mislead. Three of the four Rakhi categories
    are exactly this case. So: no baseline means the badge says NEW, and a baseline
    so small that the percentage is noise says so too."""
    b = float(base or 0)
    if b <= 0:
        return '<span class="delta good">NEW</span> <span class="muted">no history</span>'
    if float(now) / b > 20:
        return (f'<span class="delta good">&times;{float(now)/b:.0f}</span> '
                f'<span class="muted">vs {fmt(b)}</span>')
    return f'{dpct(now, b)} <span class="muted">vs {fmt(b)}</span>'


def dpp(now, base, invert=False):
    """Percentage-POINT delta, for the two rates. invert=True where up is bad
    (discount, cancellation)."""
    d = float(now) - float(base)
    good = (d < 0) if invert else (d > 0)
    cls = "good" if abs(d) > 0.2 and good else ("bad" if abs(d) > 0.2 else "neutral")
    return f'<span class="delta {cls}">{d:+.1f}pp</span>'


# --------------------------------------------------------------------- sections --

def hero(today_s, avg, ndays):
    def card(label, value, delta, sub):
        return (f'<div class="hero-card"><div class="hero-label">{label}</div>'
                f'<div class="hero-value">{value}</div>'
                f'<div class="hero-delta">{delta}</div>'
                f'<div class="sub">{sub}</div></div>')
    n = f"same-DOW avg ({ndays}d)"
    return '<div class="hero">' + "".join([
        card("Orders", f"{today_s['orders']:,}", dpct(today_s["orders"], avg["orders"]),
             f"vs {avg['orders']:.0f} {n}"),
        card("Net Sales", "&#8377;" + lakh(today_s["net_sales"]),
             dpct(today_s["net_sales"], avg["net_sales"]),
             f"vs &#8377;{lakh(avg['net_sales'])} {n}"),
        card("AOV", "&#8377;" + rupees(today_s["aov"]), dpct(today_s["aov"], avg["aov"]),
             f"vs &#8377;{rupees(avg['aov'])}"),
        card("Outlet Disc %", f"{today_s['outlet_disc_pct']:.1f}%",
             dpp(today_s["outlet_disc_pct"], avg["outlet_disc_pct"], invert=True),
             f"vs {avg['outlet_disc_pct']:.1f}%"),
        card("Cancellation %", f"{today_s['cancel_rate']:.1f}%",
             dpp(today_s["cancel_rate"], avg["cancel_rate"], invert=True),
             f"vs {avg['cancel_rate']:.1f}%"),
    ]) + "</div>"


def comparison(cur, day, cutoff, recents, dows, today_s):
    cols = ([(d, "Yest" if i == 0 else f"D&minus;{i+1}", "recent-col")
             for i, d in enumerate(recents)]
            + [(d, "Last DOW" if i == 0 else f"DOW&minus;{i+1}", "dow-col")
               for i, d in enumerate(dows)])
    stats = {d: pd_.summary(cur, d, cutoff, day) for d, _, _ in cols}
    rows = [("Orders", lambda s: f"{s['orders']:,}", "pct", "orders"),
            ("Net Sales", lambda s: "&#8377;" + lakh(s["net_sales"]), "pct", "net_sales"),
            ("AOV", lambda s: "&#8377;" + rupees(s["aov"]), "pct", "aov"),
            ("Outlet Disc %", lambda s: f"{s['outlet_disc_pct']:.1f}%", "pp", "outlet_disc_pct"),
            ("Cancellation %", lambda s: f"{s['cancel_rate']:.1f}%", "pp", "cancel_rate")]
    h = ['<table class="cmp"><thead><tr><th class="metric-name">Metric</th>'
         '<th class="today-col">Today</th>']
    for d, lab, cls in cols:
        mark = ' <span class="outlier-mark">*</span>' if d in pd_.OUTLIER_DATES else ""
        h.append(f'<th class="{cls}">{lab}<div class="col-sub">'
                 f'{d.strftime("%a %-d %b")}{mark}</div></th>')
    h.append("</tr></thead><tbody>")
    for name, fmt, kind, key in rows:
        h.append(f'<tr><td class="metric-name">{name}</td>'
                 f'<td class="num-cell today-col"><span class="cell-val">{fmt(today_s)}</span></td>')
        for d, _, cls in cols:
            s = stats[d]
            delta = (dpct(today_s[key], s[key]) if kind == "pct"
                     else dpp(today_s[key], s[key], invert=(key != "aov")))
            h.append(f'<td class="num-cell {cls}"><span class="cell-val">{fmt(s)}</span>'
                     f'<span class="cell-delta">{delta}</span></td>')
        h.append("</tr>")
    h.append("</tbody></table>")
    return "".join(h)


def categories(cur, day, cutoff, dows, groups, overlap, today_total_net):
    """The three readings Pranjay asked for. Each group is measured today and against
    the mean of the same same-DOW days the rest of the dashboard uses, cut at the same
    clock time, so a festival morning is never laid against a whole normal day."""
    today_roll, other_cats = pd_.category_rollup(cur, day, cutoff, day, groups)
    base_days = [d for d in dows if d not in pd_.OUTLIER_DATES] or dows
    base_rolls = [pd_.category_rollup(cur, d, cutoff, day, groups)[0] for d in base_days]

    grand_today = sum(g["value"] for g in today_roll.values()) or 1
    order = ["Cakes", "Desserts", "Rakhi collection"]
    cards = []
    for gname in order:
        cats = groups.get(gname, [])
        t = today_roll.get(gname, {"orders": 0, "units": 0, "value": 0, "cats": {}})
        bvals = [r.get(gname, {}).get("value", 0) for r in base_rolls]
        bunits = [r.get(gname, {}).get("units", 0) for r in base_rolls]
        bval = sum(bvals) / len(bvals) if bvals else 0
        bunit = sum(bunits) / len(bunits) if bunits else 0
        t_orders = pd_.group_orders(cur, day, cutoff, day, cats)
        b_orders = ([pd_.group_orders(cur, d, cutoff, day, cats) for d in base_days])
        b_orders = sum(b_orders) / len(b_orders) if b_orders else 0
        share = t["value"] / grand_today * 100

        # Name the categories with no history at all. On a festival this is the
        # difference between "we grew" and "we launched something", which is the
        # single most important thing to get right in this section.
        brand_new = []
        for cname in cats:
            had = sum(r.get(gname, {}).get("cats", {}).get(cname, {}).get("value", 0)
                      for r in base_rolls)
            now_v = t["cats"].get(cname, {}).get("value", 0)
            if had == 0 and now_v > 0:
                brand_new.append((cname, now_v))
        newnote = ""
        if brand_new:
            nv = sum(v for _c, v in brand_new)
            newnote = (f'<div class="cat-foot"><b>&#8377;{rupees(nv)} of this '
                       f'({nv / t["value"] * 100:.0f}%) is NEW:</b> '
                       + ", ".join(escape(c) for c, _v in brand_new)
                       + f' sold nothing at all on any of the baseline '
                         f'{day.strftime("%A")}s. That part is a launch, not growth.</div>')

        items = pd_.top_items_in(cur, day, cutoff, day, cats, limit=7)
        rows = "".join(
            f'<tr><td class="i">{escape(str(nm))[:44]}</td>'
            f'<td class="n">{int(u)}u</td><td class="n">&#8377;{rupees(v)}</td></tr>'
            for nm, _c, u, v, _o in items)
        cls = "cat-card rakhi" if gname == "Rakhi collection" else "cat-card"
        cards.append(f"""
<div class="{cls}">
  <h3>{gname}</h3>
  <div class="cat-sub">{len(cats)} menu categories &middot; {share:.1f}% of today's item value</div>
  <div class="cat-share"><i style="width:{min(share,100):.1f}%"></i></div>
  <div class="cat-figs">
    <div class="cat-fig"><div class="k">Item value</div>
      <div class="v">&#8377;{lakh(t['value'])}</div>
      <div class="d">{dnew(t['value'], bval, lambda v: '&#8377;' + lakh(v))}</div></div>
    <div class="cat-fig"><div class="k">Units</div>
      <div class="v">{int(t['units']):,}</div>
      <div class="d">{dnew(t['units'], bunit)}</div></div>
    <div class="cat-fig"><div class="k">Orders with it</div>
      <div class="v">{t_orders:,}</div>
      <div class="d">{dnew(t_orders, b_orders)}</div></div>
  </div>
  <table class="cat-items">{rows}</table>
  {newnote}
</div>""")

    foot = (f'<div class="cat-foot"><b>Read this before quoting it.</b> '
            f'Category value is the item line total, <b>gross of order level '
            f'discounts</b>, because that is what Petpooja reports per item. It does '
            f'not foot to the Net Sales figure above: today item value is '
            f'&#8377;{lakh(grand_today)} against Net Sales &#8377;{lakh(today_total_net)}. '
            f'Use item value to compare categories with each other and with the same '
            f'category on a normal Friday, which is what it is exact for. '
            f'Baseline is the mean of {", ".join(d.strftime("%-d %b") for d in base_days)}, '
            f'each cut at the same clock time.')
    if overlap:
        for cat, note in overlap.items():
            v = today_roll.get("Rakhi collection", {}).get("cats", {}).get(cat, {}).get("value", 0)
            foot += (f' <b>Overlap:</b> "{escape(cat)}" (&#8377;{rupees(v)}) is {escape(note)}; '
                     f'the groups are kept mutually exclusive so the shares add up.')
    if other_cats:
        foot += (" <b>Not in any group:</b> " + ", ".join(escape(c) for c in other_cats)
                 + ". Nothing is dropped silently; edit categories.json to move them.")
    foot += "</div>"
    return '<div class="cat-grid">' + "".join(cards) + "</div>" + foot


def dimension_table(cur, day, cutoff, dows, dim, title_col, hidden=()):
    today_rows = pd_.by_dimension(cur, day, cutoff, day, dim, hidden)
    base_days = [d for d in dows if d not in pd_.OUTLIER_DATES] or dows
    base = {}
    for d in base_days:
        for r in pd_.by_dimension(cur, d, cutoff, day, dim, hidden):
            b = base.setdefault(r[0], {"orders": 0, "net": 0.0, "od": 0.0, "denom": 0.0})
            b["orders"] += r[1]; b["net"] += float(r[2])
            b["denom"] += float(r[3]); b["od"] += float(r[4])
    n = len(base_days) or 1
    h = [f'<table class="outlet-tbl"><thead><tr><th>{title_col}</th>'
         '<th class="right">Orders</th><th class="right">vs DOW</th>'
         '<th class="right">Net Sales</th><th class="right">vs DOW</th>'
         '<th class="right">Disc %</th><th class="right">Cancels</th></tr></thead><tbody>']
    for name, orders, net, denom, od, canc, recv in today_rows:
        b = base.get(name)
        bo = (b["orders"] / n) if b else 0
        bn = (b["net"] / n) if b else 0
        disc = (float(od) / float(denom) * 100) if denom else 0
        h.append(f'<tr><td>{escape(str(name))}</td>'
                 f'<td class="num-cell right">{orders:,}</td>'
                 f'<td class="num-cell right">{dpct(orders, bo)}</td>'
                 f'<td class="num-cell right">&#8377;{rupees(net)}</td>'
                 f'<td class="num-cell right">{dpct(float(net), bn)}</td>'
                 f'<td class="num-cell right">{disc:.1f}%</td>'
                 f'<td class="num-cell right">{canc or ""}</td></tr>')
    h.append("</tbody></table>")
    return "".join(h)


def hour_table(cur, day, cutoff, dows, now_hour):
    today_h = pd_.hourly(cur, day, cutoff, day)
    base_days = [d for d in dows if d not in pd_.OUTLIER_DATES] or dows
    bases = [pd_.hourly(cur, d, dt.time(23, 59, 59), day) for d in base_days]
    n = len(bases) or 1
    hours = sorted(today_h)
    h = ['<table class="cmp"><thead><tr><th class="metric-name">Hour</th>'
         '<th class="today-col">Orders</th><th class="today-col">Net Sales</th>'
         '<th class="today-col">Running</th>'
         '<th class="dow-col">Normal (same-DOW avg)</th><th class="dow-col">Diff</th>'
         '</tr></thead><tbody>']
    running = 0.0
    for hh in hours:
        o, s = today_h[hh]
        running += s
        b = sum(x.get(hh, (0, 0))[1] for x in bases) / n
        part = hh == now_hour
        if part and b:
            # The hour in progress holds only these minutes of trade, so its baseline
            # is cut to the same minutes. Otherwise a live hour always reads as a
            # collapse when nothing is wrong.
            b = b * (cutoff.minute / 60.0)
        label = f"{hh:02d}:00" + (' <span class="partial-mark">part hour</span>' if part else "")
        h.append(f'<tr><td class="metric-name">{label}</td>'
                 f'<td class="num-cell today-col">{o:,}</td>'
                 f'<td class="num-cell today-col">&#8377;{rupees(s)}</td>'
                 f'<td class="num-cell today-col">&#8377;{rupees(running)}</td>'
                 f'<td class="num-cell dow-col">&#8377;{rupees(b)}</td>'
                 f'<td class="num-cell dow-col">{dpct(s, b)}</td></tr>')
    h.append("</tbody></table>")
    return "".join(h)


# ------------------------------------------------------------------------ page --

def build(cur, day, cutoff, occasion, anchor):
    groups, overlap = pd_.load_groups()
    today_s = pd_.summary(cur, day, cutoff, day)
    dows = pd_.dow_dates(day, cur)
    recents = pd_.recent_dates(day, cur)
    avg, used = pd_.dow_average(cur, dows, cutoff, day)

    # Freshness, first and unmissable. A number nobody can date is not evidence.
    cur.execute("""select report, max(source_max_ts), count(*) from intraday.pulse_run
                   where business_date = %s and status = 'ok' group by 1 order by 1""",
                (day,))
    fresh = cur.fetchall()
    now = dt.datetime.combine(day, cutoff)
    fresh_bits = []
    for rep, mx, runs in fresh:
        lag = ""
        try:
            mins = int((now - dt.datetime.strptime(mx, "%Y-%m-%d %H:%M:%S")).total_seconds() // 60)
            # A negative lag means the feed has run PAST the cutoff being reported,
            # which makes the snapshot complete, not stale. Printing "-24 min behind"
            # reads as a fault when it is the opposite.
            lag = (f", {mins} min behind the cutoff" if mins > 0
                   else ", complete through the cutoff")
        except Exception:
            pass
        fresh_bits.append(f"{rep} &rarr; <b>{mx}</b>{lag} ({runs} pulls)")

    cur.execute("""select count(distinct outlet_name) from intraday.v_orders_now
                   where business_date = %s and placed_at >= %s and placed_at <= %s""",
                (day, dt.datetime.combine(day, pd_.DAY_START), now))
    live_outlets = cur.fetchone()[0]

    takeaway = (f"orders {dpct(today_s['orders'], avg['orders'])} &middot; "
                f"net sales {dpct(today_s['net_sales'], avg['net_sales'])} &middot; "
                f"AOV {dpct(today_s['aov'], avg['aov'])}")

    # Where the day lands: a RANGE across named shapes, never one number. See the
    # note in the section itself; this is the single most misreadable figure on the
    # page and it is fenced accordingly.
    proj = []
    for label, refs in [(f"a normal {day.strftime('%A')}", used)] + (
            [(f"last year's {occasion or 'festival'} ({anchor:%-d %b %Y})", [anchor])]
            if anchor else []):
        parts, wholes = [], []
        for d in refs:
            s_part = pd_.summary(cur, d, cutoff, day)["net_sales"]
            s_all = pd_.summary(cur, d, dt.time(23, 59, 59), day)["net_sales"]
            if s_all:
                parts.append(s_part); wholes.append(s_all)
        if not wholes:
            continue
        frac = sum(parts) / sum(wholes)
        whole = sum(wholes) / len(wholes)
        if frac > 0:
            proj.append((label, frac * 100, whole, today_s["net_sales"] / frac))
    proj_html = ""
    if proj:
        rows = "".join(
            f'<tr><td class="metric-name">If today follows {escape(l)}</td>'
            f'<td class="num-cell today-col">&#8377;{rupees(p)}</td>'
            f'<td class="num-cell dow-col">{f:.1f}% of that day was done by now</td>'
            f'<td class="num-cell dow-col">it finished at &#8377;{rupees(w)}</td></tr>'
            for l, f, w, p in proj)
        lo, hi = min(p[3] for p in proj), max(p[3] for p in proj)
        spread = (f'<div class="note">So: <b>somewhere between &#8377;{rupees(lo)} and '
                  f'&#8377;{rupees(hi)}</b>. The spread is the finding, not a failure to '
                  f'decide. A festival front loads, because gifting is bought in the '
                  f'morning and dinner is not, so a normal day\'s remaining-day curve '
                  f'overstates it. <b>Every other number on this page is measured. Only '
                  f'this block is an estimate.</b></div>' if hi > lo * 1.15 else "")
        proj_html = f"""
<section><h2>Where the day lands <span class="sub">estimate, not measurement</span></h2>
<table class="cmp"><tbody>{rows}</tbody></table>{spread}</section>"""

    css = open(os.path.join(HERE, "spotcheck.css"), encoding="utf-8").read()
    title = f"CC Intraday Pulse &middot; {day.isoformat()}"
    occ = f"{escape(occasion)} &middot; " if occasion else ""
    outlier_note = ""
    if any(d in pd_.OUTLIER_DATES for d in dows):
        outlier_note = ' <span class="outlier-mark">*</span> excluded from the average.'

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CC Intraday Pulse {day.isoformat()} {cutoff.strftime('%H:%M')}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>{css}</style></head><body>

<div class="page-header">
  <div><h1>CC Intraday Pulse</h1>
    <div class="sub">{occ}{day.strftime('%A, %B %-d, %Y')} &middot; snapshot at
      <b>{cutoff.strftime('%-I:%M %p')}</b></div>
    <div class="sub">Where we stand: {takeaway}</div></div>
  <div class="right">
    Business day starts <b>{pd_.DAY_START.strftime('%H:%M')}</b> &middot; cutoff
      <b>{cutoff.strftime('%H:%M')}</b><br>
    Same-DOW baseline: avg of <b>{len(used)}</b> prior
      {day.strftime('%A')}s{outlier_note}<br>
    Outlets with an order today: <b>{live_outlets}</b><br>
    {'<br>'.join(fresh_bits)}
  </div>
</div>

<section><h2>Top-line at {cutoff.strftime('%-I:%M %p')}
  <span class="sub">vs same-DOW avg, outliers excluded &middot; definitions identical to the CC Spot Check</span></h2>
{hero(today_s, avg, len(used))}</section>

<section><h2>Cakes, Desserts and the Rakhi collection
  <span class="sub">item level &middot; today vs the same clock time on a normal {day.strftime('%A')}</span></h2>
{categories(cur, day, cutoff, dows, groups, overlap, today_s['net_sales'])}</section>

<section><h2>Comparison
  <span class="sub">today vs last {len(recents)} days and last {len(dows)} {day.strftime('%A')}s &middot; all snapshotted to {cutoff.strftime('%-I:%M %p')}</span></h2>
{comparison(cur, day, cutoff, recents, dows, today_s)}</section>

{proj_html}

<section><h2>Hour by hour <span class="sub">net sales per hour, today vs the same-DOW average</span></h2>
{hour_table(cur, day, cutoff, dows, cutoff.hour)}</section>

<section><h2>Platform <span class="sub">today vs the same-DOW average</span></h2>
{dimension_table(cur, day, cutoff, dows, "platform", "Platform")}</section>

<section><h2>City <span class="sub">today vs the same-DOW average</span></h2>
{dimension_table(cur, day, cutoff, dows, "city", "City", pd_.HIDDEN_CITIES)}</section>

<section><h2>Outlets <span class="sub">every outlet with an order today</span></h2>
{dimension_table(cur, day, cutoff, dows, "outlet_name", "Outlet")}</section>

<div class="note">
  Source: Petpooja Online Order Report (order level) and Order Summary Item report
  (item level), pulled live and stored append-only in the spine's <code>intraday</code>
  schema. Net Sales = My amount + Container Charge &minus; (Outlet Disc + Agg Disc),
  cancellations excluded from every sales figure and counted separately: the CC Spot
  Check's definitions, verbatim, verified against it at the 12:00 cutoff today
  (&#8377;6.6L Net Sales, &#8377;672 AOV, matching to the rupee).
  Generated {dt.datetime.now().strftime('%-d %b %Y %H:%M')} IST.
</div>
</body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date")
    ap.add_argument("--cutoff", help="HH:MM, default now")
    ap.add_argument("--out", default=os.path.join(HERE, "pulse_dashboard.html"))
    ap.add_argument("--open", action="store_true")
    args = ap.parse_args()
    load_env()
    import psycopg2
    sys.path.insert(0, HERE)
    import run_pulse

    day = dt.date.fromisoformat(args.date) if args.date else run_pulse.business_date_now()
    cutoff = (dt.datetime.strptime(args.cutoff, "%H:%M").time() if args.cutoff
              else dt.datetime.now().time().replace(second=0, microsecond=0))
    occasion, anchor = run_pulse.occasion_for(day)

    conn = psycopg2.connect(os.environ["SPINE_DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            html = build(cur, day, cutoff, occasion, anchor)
    finally:
        conn.close()
    with open(args.out, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"wrote {args.out} ({len(html)//1024} KB), cutoff {cutoff.strftime('%H:%M')}")
    if args.open:
        webbrowser.open("file://" + os.path.abspath(args.out))


if __name__ == "__main__":
    main()
