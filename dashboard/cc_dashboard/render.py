"""Render data structures to HTML."""
import json
import os
from datetime import datetime
from html import escape
from metrics import pct_delta, safe_div

HERE = os.path.dirname(os.path.abspath(__file__))


# ---------- formatters ----------
def inr(x, k=False, lakh=False):
    if x is None: return "-"
    try: x = float(x)
    except: return "-"
    if lakh: return f"{x/1e5:.1f}L"
    if k:    return f"{x/1e3:.1f}K"
    return f"{int(round(x)):,}"

def n(x):
    if x is None: return "-"
    try: return f"{int(round(float(x))):,}"
    except: return "-"

def f1(x, suf=""):
    if x is None: return "-"
    try: return f"{float(x):.1f}{suf}"
    except: return "-"

def f0(x, suf=""):
    if x is None: return "-"
    try: return f"{float(x):.0f}{suf}"
    except: return "-"


def chip(d, ppt=False):
    if d is None: return '<span class="chip na">-</span>'
    try: d = float(d)
    except: return '<span class="chip na">-</span>'
    if d > 5:    cls = "good"
    elif d > 0:  cls = "good-mute"
    elif d > -5: cls = "neutral"
    elif d > -15:cls = "bad"
    else:        cls = "very-bad"
    sign = "+" if d > 0 else ""
    suf = "pp" if ppt else "%"
    return f'<span class="chip {cls}">{sign}{d:.1f}{suf}</span>'


# ---------- briefings ----------
def briefings(brfs):
    if not brfs:
        return '<div class="briefing watch"><div class="severity">QUIET</div><div class="body"><div class="title">No notable signals today.</div></div></div>'
    out = []
    for b in brfs:
        impact = ""
        if b.get("impact_value"):
            impact = f'<div class="impact"><div class="num">{escape(str(b["impact_value"]))}</div>{escape(b.get("impact_label",""))}</div>'
        out.append(f'''
        <div class="briefing {b["level"]}">
          <div class="severity">{escape(b["tag"])}</div>
          <div class="body">
            <div class="title">{escape(b["title"])}</div>
            <div class="detail">{escape(b["detail"])}</div>
            <div class="action">{escape(b["action"])}</div>
          </div>
          {impact}
        </div>''')
    return "\n".join(out)


# ---------- KPI tiles ----------
def kpi_tile(label, value_html, focal, comp, avg, fmt, dir_good="up", split_html=""):
    d_lw = pct_delta(focal, comp)
    d_av = pct_delta(focal, avg)
    def cc(d):
        if d is None: return ""
        if dir_good == "up":
            cls = "good" if d > 5 else "good-mute" if d > 0 else "neutral" if d > -5 else "bad"
        else:
            cls = "bad" if d > 5 else "neutral" if d > -5 else "good"
        sign = "+" if d > 0 else ""
        return f'<span class="chip mini {cls}">{sign}{d:.1f}%</span>'
    return f'''
    <div class="kpi-tile">
      <div class="kpi-label">{label}</div>
      <div class="kpi-main">{value_html}</div>
      <div class="kpi-compare">
        <div class="item">vs LW <span class="v">{fmt(comp)}</span> {cc(d_lw)}</div>
        <div class="item">vs 7d avg <span class="v">{fmt(avg)}</span> {cc(d_av)}</div>
      </div>
      {split_html}
    </div>'''


def kpi_matrix_section(matrix):
    """Three tables (Total / Zomato / Swiggy), each with periods × metrics.
    Periods: Yesterday, Day before, Same DOW LW, 7-day avg, 30-day avg
    Metrics: Orders, Net Sales, Discount, AOV
    """
    period_order = ["Yesterday", "Day before", "Same DOW LW", "7-day avg", "30-day avg"]
    plat_label = {"All": "Total", "Zomato": "Zomato", "Swiggy": "Swiggy"}
    plat_class = {"All": "plat-total", "Zomato": "plat-z", "Swiggy": "plat-s"}

    def cell_val(p_data, key, kind):
        if p_data is None: return '<td class="num na">—</td>'
        v = p_data[key]
        if kind == "orders":
            disp = f"{v:,.1f}" if v % 1 else f"{int(v):,}"
        elif kind == "net":
            disp = f"Rs.{inr(v, k=True)}"
        elif kind == "disc":
            disp = f"Rs.{inr(v, k=True)}"
        elif kind == "aov":
            disp = f"Rs.{int(round(v)):,}" if v else "—"
        return f'<td class="num">{disp}</td>'

    def disc_pct_cell(p_data):
        if p_data is None: return '<td class="num na">—</td>'
        return f'<td class="num small">{p_data["disc_pct"]:.1f}%</td>'

    def trend_cell(p_data, base_data, key, kind, dir_good):
        """% change vs the 'Yesterday' row, shown as a chip alongside."""
        if p_data is None or base_data is None: return ""
        if base_data[key] in (0, None) or p_data[key] in (0, None): return ""
        d = (base_data[key] - p_data[key]) / p_data[key] * 100
        return chip(d) if dir_good == "up" else chip(-d)

    sections = []
    for plat in ["All", "Zomato", "Swiggy"]:
        baseline = matrix["Yesterday"][plat] if matrix["Yesterday"] else None

        rows = []
        for period in period_order:
            p = matrix[period]
            if p is None:
                rows.append(f'<tr class="period-row"><td class="period">{period}</td>'
                            f'<td colspan="5" class="num na">data unavailable</td></tr>')
                continue
            pd = p[plat]
            n_days_label = ""
            if "avg" in period and pd["n_days"] != int(period.split("-")[0]):
                n_days_label = f' <span class="n-days">({pd["n_days"]}d)</span>'

            # Compare yesterday row to its baseline (itself = no chip), others to yesterday
            is_baseline = (period == "Yesterday")
            o_chip = "" if is_baseline else trend_cell(pd, baseline, "orders", "orders", "up")
            n_chip = "" if is_baseline else trend_cell(pd, baseline, "net_sale", "net", "up")
            a_chip = "" if is_baseline else trend_cell(pd, baseline, "aov", "aov", "up")

            rows.append(f'''<tr class="period-row {"baseline" if is_baseline else ""}">
                <td class="period">{period}{n_days_label}</td>
                {cell_val(pd, "orders", "orders")}<td class="trend">{o_chip}</td>
                {cell_val(pd, "net_sale", "net")}<td class="trend">{n_chip}</td>
                {cell_val(pd, "discount", "disc")}{disc_pct_cell(pd)}
                {cell_val(pd, "aov", "aov")}<td class="trend">{a_chip}</td>
              </tr>''')

        sections.append(f'''
        <div class="kpi-table-card {plat_class[plat]}">
          <div class="kpi-table-head">
            <span class="plat-label">{plat_label[plat]}</span>
            <span class="plat-meta">all periods compared to Yesterday</span>
          </div>
          <table class="data kpi-matrix">
            <thead><tr>
              <th>Period</th>
              <th class="num">Orders</th><th></th>
              <th class="num">Net Sales</th><th></th>
              <th class="num">Discount</th><th class="num small">Disc%</th>
              <th class="num">AOV</th><th></th>
            </tr></thead>
            <tbody>{"".join(rows)}</tbody>
          </table>
        </div>''')

    return "\n".join(sections)


def cause_bar(top_f, top_c):
    f, c = top_f["All"], top_c["All"]
    if not c["orders"] or not c["aov"]: return ""
    tot = f["net_rev"] - c["net_rev"]
    vol = (f["orders"] - c["orders"]) * c["aov"]
    aov = (f["aov"] - c["aov"]) * f["orders"]
    if abs(tot) < 1: return ""
    tot_abs = abs(vol) + abs(aov)
    if tot_abs < 1: return ""
    vp = abs(vol) / tot_abs * 100
    ap = abs(aov) / tot_abs * 100
    vc = "var(--positive)" if vol > 0 else "var(--critical)"
    ac = "var(--positive)" if aov > 0 else "var(--critical)"
    sign = "+" if tot > 0 else ""
    return f'''
    <div class="cause-card">
      <div class="cause-title">Revenue change decomposition <span class="cause-total">{sign}Rs.{inr(abs(tot), k=True)} vs LW</span></div>
      <div class="cause-bar">
        <div class="seg" style="flex:{vp:.1f}; background:{vc}">Volume {("+" if vol>0 else "")}Rs.{inr(abs(vol), k=True)}</div>
        <div class="seg" style="flex:{ap:.1f}; background:{ac}">AOV {("+" if aov>0 else "")}Rs.{inr(abs(aov), k=True)}</div>
      </div>
      <div class="cause-legend">
        <div class="cause-item"><span class="dot" style="background:var(--positive)"></span>Positive contribution</div>
        <div class="cause-item"><span class="dot" style="background:var(--critical)"></span>Negative contribution</div>
      </div>
    </div>'''


def cities_table(cities_data):
    rows = []
    cs = sorted(cities_data.values(), key=lambda x: -(x["net_rev"] or 0))
    for c in cs:
        rows.append(f'''
        <tr>
          <td class="city-name">{escape(c['city'])}</td>
          <td class="num">{c['outlets']}</td>
          <td class="num">{n(c['orders'])}</td>
          <td>{chip(c['d_orders_lw'])}</td>
          <td>{chip(c['d_orders_7d'])}</td>
          <td class="num">Rs.{inr(c['net_rev'], k=True)}</td>
          <td>{chip(c['d_rev_lw'])}</td>
          <td>{chip(c['d_rev_7d'])}</td>
          <td class="num">Rs.{n(c['aov'])}</td>
          <td class="num">{f1(c['out_disc_pct'])}%</td>
        </tr>''')
    return f'''
    <div class="table-card scroll">
      <table class="data sortable">
        <thead><tr>
          <th data-sort="text">City</th><th data-sort="num">Outlets</th>
          <th data-sort="num">Orders</th><th data-sort="num">d LW</th><th data-sort="num">d 7d</th>
          <th data-sort="num" class="active">Net Rev</th><th data-sort="num">d LW</th><th data-sort="num">d 7d</th>
          <th data-sort="num">AOV</th><th data-sort="num">Out Disc%</th>
        </tr></thead>
        <tbody>{"".join(rows)}</tbody>
      </table>
    </div>'''


def outlet_grid(out_f, out_c, out_a):
    cities = sorted({r["city"] for r in out_f.values()})
    rows_data = []
    for o, fr in out_f.items():
        cr = out_c.get(o, {"orders":0, "z_orders":0, "s_orders":0, "net_rev":0, "aov":0,
                            "out_disc_pct":0, "cake_share_qty":0})
        ar = out_a.get(o, {"orders":0, "net_rev":0, "aov":0})
        d_o = pct_delta(fr["orders"], cr["orders"])
        d_r = pct_delta(fr["net_rev"], cr["net_rev"])
        d_a = pct_delta(fr["aov"], cr["aov"])
        d_r7 = pct_delta(fr["net_rev"], ar.get("net_rev", 0))
        d_z = pct_delta(fr["z_orders"], cr.get("z_orders", 0)) if cr.get("z_orders", 0) >= 5 else None
        d_s = pct_delta(fr["s_orders"], cr.get("s_orders", 0)) if cr.get("s_orders", 0) >= 5 else None
        d_ck = fr["cake_share_qty"] - cr["cake_share_qty"]
        z_share = safe_div(fr["z_orders"], fr["orders"]) * 100
        if z_share > 65: bias = "Z-heavy"
        elif z_share < 35: bias = "S-heavy"
        else: bias = "Balanced"

        # Hidden-crash flag — total looks fine but one platform crashed ≥30%
        hidden_flag = ""
        if d_r is not None and d_r > -25:
            if d_z is not None and d_z <= -30 and (d_s or 0) > -10:
                hidden_flag = '<span class="hidden-crash" title="Zomato crashed but total looks ok">⚠ Z</span>'
            elif d_s is not None and d_s <= -30 and (d_z or 0) > -10:
                hidden_flag = '<span class="hidden-crash" title="Swiggy crashed but total looks ok">⚠ S</span>'

        rows_data.append({
            "outlet": o, "city": fr["city"], "bias": bias, "hidden_flag": hidden_flag,
            "orders": fr["orders"],
            "z": fr["z_orders"], "s": fr["s_orders"],
            "z_lw": cr.get("z_orders", 0), "s_lw": cr.get("s_orders", 0),
            "net_rev": fr["net_rev"], "aov": fr["aov"],
            "out_disc_pct": fr["out_disc_pct"],
            "cake": fr["cake_share_qty"],
            "cancel_pct": fr["cancel_pct"],
            "d_orders": d_o, "d_rev": d_r, "d_aov": d_a, "d_rev_7d": d_r7,
            "d_z": d_z, "d_s": d_s, "d_cake": d_ck,
        })
    rows_data.sort(key=lambda r: r["d_rev"] if r["d_rev"] is not None else 999)

    body = []
    for r in rows_data:
        d_rev_str = f"{r['d_rev']:.1f}" if r["d_rev"] is not None else ""
        body.append(f'''<tr data-outlet="{escape(r['outlet'].lower())}" data-city="{escape(r['city'])}" data-bias="{r['bias']}" data-d-rev="{d_rev_str}" data-cancel="{r['cancel_pct']:.1f}">
          <td class="outlet-name">{escape(r['outlet'])} {r['hidden_flag']}</td>
          <td>{escape(r['city'])}</td>
          <td><span class="pill {r['bias'].lower().replace('-','')}">{r['bias']}</span></td>
          <td class="num">{n(r['orders'])}</td>
          <td>{chip(r['d_orders'])}</td>
          <td class="num plat-z-cell">{n(r['z'])} <span class="lw-num">/ {n(r['z_lw'])}</span></td>
          <td>{chip(r['d_z'])}</td>
          <td class="num plat-s-cell">{n(r['s'])} <span class="lw-num">/ {n(r['s_lw'])}</span></td>
          <td>{chip(r['d_s'])}</td>
          <td class="num">Rs.{inr(r['net_rev'], k=True)}</td>
          <td>{chip(r['d_rev'])}</td>
          <td>{chip(r['d_rev_7d'])}</td>
          <td class="num">Rs.{n(r['aov'])}</td>
          <td class="num">{f1(r['out_disc_pct'])}%</td>
          <td class="num">{f1(r['cake'])}%</td>
          <td class="num">{f1(r['cancel_pct'])}%</td>
        </tr>''')

    city_opts = "".join(f'<option value="{c}">{c}</option>' for c in cities)
    return f'''
    <div class="filter-bar">
      <input type="text" id="o-search" placeholder="Search outlets..." />
      <select id="o-city"><option value="">All cities</option>{city_opts}</select>
      <select id="o-bias">
        <option value="">All platforms</option>
        <option value="Z-heavy">Zomato heavy</option>
        <option value="Balanced">Balanced</option>
        <option value="S-heavy">Swiggy heavy</option>
      </select>
      <select id="o-status">
        <option value="">All status</option>
        <option value="down">Down vs LW</option>
        <option value="up">Up vs LW</option>
        <option value="cancel">Cancel >= 5%</option>
      </select>
      <span class="filter-count" id="o-count">{len(rows_data)} outlets</span>
    </div>
    <p class="section-note">Z/S columns show <strong>yesterday / last week</strong> orders side-by-side. The ⚠ flag marks outlets where one platform crashed but the total looks fine — usually a platform-specific issue (BOS bid, code, listing).</p>
    <div class="table-card scroll">
      <table class="data sortable" id="outlet-table">
        <thead><tr>
          <th data-sort="text">Outlet</th><th data-sort="text">City</th><th data-sort="text">Mix</th>
          <th data-sort="num">Orders</th><th data-sort="num">d Ord</th>
          <th data-sort="num">Z (yest/LW)</th><th data-sort="num">d Z</th>
          <th data-sort="num">S (yest/LW)</th><th data-sort="num">d S</th>
          <th data-sort="num">Net Rev</th>
          <th data-sort="num" class="active">d Rev LW</th><th data-sort="num">d Rev 7d</th>
          <th data-sort="num">AOV</th>
          <th data-sort="num">Out Disc%</th>
          <th data-sort="num">Cake%</th>
          <th data-sort="num">Cancel%</th>
        </tr></thead>
        <tbody>{"".join(body)}</tbody>
      </table>
    </div>'''


def discount_section(top_f, top_c, bands_f, bands_c):
    rows = []
    for plat in ["Zomato", "Swiggy"]:
        f, c = top_f[plat], top_c[plat]
        rows.append(f'''
        <tr>
          <td class="plat">{plat}</td>
          <td class="num">{f1(f['out_disc_pct'])}%</td>
          <td>{chip(f['out_disc_pct']-c['out_disc_pct'], ppt=True)}</td>
          <td class="num">{f1(f['agg_disc_pct'])}%</td>
          <td>{chip(f['agg_disc_pct']-c['agg_disc_pct'], ppt=True)}</td>
          <td class="num">{f1(f['tot_disc_pct'])}%</td>
          <td class="num">{f1(f['agg_funding_pct'])}%</td>
          <td>{chip(f['agg_funding_pct']-c['agg_funding_pct'], ppt=True)}</td>
        </tr>''')
    return f'''
    <div class="table-card">
      <table class="data">
        <thead><tr>
          <th>Platform</th>
          <th>Outlet Disc%</th><th>d LW</th>
          <th>Agg Disc%</th><th>d LW</th>
          <th>Total Disc%</th>
          <th>Agg Funding%</th><th>d LW</th>
        </tr></thead>
        <tbody>{"".join(rows)}</tbody>
      </table>
    </div>
    <div class="two-col" style="margin-top:12px">
      <div class="chart-card">
        <div class="chart-title">Zomato - orders by outlet-discount band</div>
        <div class="chart-wrap"><canvas id="bandsZ"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Swiggy - orders by outlet-discount band</div>
        <div class="chart-wrap"><canvas id="bandsS"></canvas></div>
      </div>
    </div>
    <script>
      window._bands = {{
        labels: {json.dumps(bands_f["Zomato"]["labels"])},
        z_focal: {json.dumps(bands_f["Zomato"]["counts"])},
        z_comp:  {json.dumps(bands_c["Zomato"]["counts"])},
        s_focal: {json.dumps(bands_f["Swiggy"]["counts"])},
        s_comp:  {json.dumps(bands_c["Swiggy"]["counts"])}
      }};
    </script>'''


def categories_section(cat_f, cat_c):
    rows = []
    for plat in ["Zomato", "Swiggy"]:
        for cat in ["Cakes", "Desserts", "Cheesecakes", "Cookies"]:
            f, c = cat_f[plat][cat], cat_c[plat][cat]
            rows.append(f'''
            <tr>
              <td>{plat}</td><td>{cat}</td>
              <td class="num">{n(f['qty'])}</td>
              <td>{chip(pct_delta(f['qty'], c['qty']))}</td>
              <td class="num">Rs.{inr(f['rev'], k=True)}</td>
              <td>{chip(pct_delta(f['rev'], c['rev']))}</td>
              <td class="num">{f1(f['qty_share'])}%</td>
              <td>{chip(f['qty_share']-c['qty_share'], ppt=True)}</td>
              <td class="num">Rs.{n(f['avg_price'])}</td>
            </tr>''')
    pf_z, pc_z = cat_f["Zomato"]["_premium_cake_share"], cat_c["Zomato"]["_premium_cake_share"]
    pf_s, pc_s = cat_f["Swiggy"]["_premium_cake_share"], cat_c["Swiggy"]["_premium_cake_share"]
    return f'''
    <div class="kpi-grid" style="margin-bottom:14px">
      <div class="kpi-tile">
        <div class="kpi-label">Zomato - Premium cake share (>=Rs.699)</div>
        <div class="kpi-main">{f1(pf_z)}<span class="unit">%</span></div>
        <div class="kpi-compare"><div class="item">vs LW <span class="v">{f1(pc_z,'%')}</span> {chip(pf_z-pc_z, ppt=True)}</div></div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Swiggy - Premium cake share (>=Rs.699)</div>
        <div class="kpi-main">{f1(pf_s)}<span class="unit">%</span></div>
        <div class="kpi-compare"><div class="item">vs LW <span class="v">{f1(pc_s,'%')}</span> {chip(pf_s-pc_s, ppt=True)}</div></div>
      </div>
    </div>
    <div class="table-card scroll">
      <table class="data">
        <thead><tr>
          <th>Platform</th><th>Category</th>
          <th class="num">Qty</th><th>d Qty</th>
          <th class="num">Revenue</th><th>d Rev</th>
          <th class="num">Qty share</th><th>d Share</th>
          <th class="num">Avg Rs.</th>
        </tr></thead>
        <tbody>{"".join(rows)}</tbody>
      </table>
    </div>'''


def hour_section(outlet_h, brand_f, brand_c):
    hours = list(range(7, 26))
    totals = sorted(((o, sum(d.values())) for o, d in outlet_h.items()), key=lambda x: -x[1])
    top_outlets = [o for o, _ in totals[:25]]
    max_v = max((max(d.values(), default=0) for d in outlet_h.values()), default=1)
    rows = []
    for o in top_outlets:
        cells = []
        for h in hours:
            v = outlet_h[o].get(h, 0)
            i = v / max_v if max_v else 0
            cells.append(f'<td class="hm-cell" style="--i:{i:.3f}" title="{o} - {h if h<24 else h-24}h: {v}">{v if v else ""}</td>')
        rows.append(f'<tr><td class="hm-name">{escape(o)}</td>{"".join(cells)}</tr>')
    bf = [brand_f.get(h, 0) for h in hours]
    bc = [brand_c.get(h, 0) for h in hours]
    labels = [f"{h if h<24 else h-24}h" for h in hours]
    return f'''
    <div class="chart-card">
      <div class="chart-title">Brand orders by hour - yesterday vs same day last week</div>
      <div class="chart-wrap"><canvas id="hourBrand"></canvas></div>
    </div>
    <h3 class="sub-head">Outlet x hour heatmap (top 25 by volume)</h3>
    <div class="hm-wrap">
      <table class="hm-table">
        <thead><tr><th>Outlet</th>{"".join(f'<th>{h if h<24 else h-24}h</th>' for h in hours)}</tr></thead>
        <tbody>{"".join(rows)}</tbody>
      </table>
    </div>
    <script>
      window._hourBrand = {{
        labels: {json.dumps(labels)},
        focal: {json.dumps(bf)},
        comp: {json.dumps(bc)}
      }};
    </script>'''


def rank_shifts_section(shifts):
    """Two-column: biggest gainers (left), biggest losers (right). Shows top 10 each."""
    gainers = [s for s in shifts if s["delta"] > 0][:10]
    losers  = [s for s in shifts if s["delta"] < 0][:10]

    def row(s):
        arrow_cls = "rank-up" if s["delta"] > 0 else "rank-down"
        arrow = "↑" if s["delta"] > 0 else "↓"
        return f'''<tr>
          <td class="outlet-name">{escape(s["outlet"])}</td>
          <td class="small">{escape(s["city"])}</td>
          <td class="num">#{s["c_rank"]} <span class="rank-arrow">→</span> #{s["f_rank"]}</td>
          <td class="num"><span class="rank-delta {arrow_cls}">{arrow}{abs(s["delta"])}</span></td>
          <td class="num small">{n(s["c_orders"])} → {n(s["f_orders"])}</td>
        </tr>'''

    g_rows = "".join(row(s) for s in gainers) or '<tr><td colspan="5" class="empty">No notable rank gains.</td></tr>'
    l_rows = "".join(row(s) for s in losers)  or '<tr><td colspan="5" class="empty">No notable rank drops.</td></tr>'

    return f'''
    <p class="section-note">Outlets ranked by orders. A jump of 5+ positions catches drift the absolute % view often misses — a steady mid-tier outlet that quietly slipped 8 places is invisible in a "down vs LW" view.</p>
    <div class="two-col">
      <div class="table-card">
        <div class="table-header positive-tile">
          <span class="th-label">Biggest rank gainers</span>
          <span class="th-meta">moved up the leaderboard</span>
        </div>
        <table class="data">
          <thead><tr>
            <th>Outlet</th><th>City</th><th>Rank</th><th>Δ</th><th class="num">Orders</th>
          </tr></thead>
          <tbody>{g_rows}</tbody>
        </table>
      </div>
      <div class="table-card">
        <div class="table-header critical-tile">
          <span class="th-label">Biggest rank losers</span>
          <span class="th-meta">moved down the leaderboard</span>
        </div>
        <table class="data">
          <thead><tr>
            <th>Outlet</th><th>City</th><th>Rank</th><th>Δ</th><th class="num">Orders</th>
          </tr></thead>
          <tbody>{l_rows}</tbody>
        </table>
      </div>
    </div>'''


def sku_concentration_section(sc):
    f, c = sc["focal"], sc["comp"]
    new_skus = sc["new_skus"]; dropped = sc["dropped_skus"]

    def trend_chip(focal_pct, comp_pct):
        d = focal_pct - comp_pct
        if abs(d) < 0.5: cls, label = "neutral", "stable"
        elif d > 2:      cls, label = "bad", f"+{d:.1f}pp narrower"
        elif d > 0:      cls, label = "good-mute", f"+{d:.1f}pp"
        elif d < -2:     cls, label = "good", f"{d:.1f}pp broader"
        else:            cls, label = "good-mute", f"{d:.1f}pp"
        return f'<span class="chip mini {cls}">{label}</span>'

    new_html = ""
    if new_skus or dropped:
        new_list = ", ".join(escape(x) for x in new_skus[:10]) + (f" (+{len(new_skus)-10} more)" if len(new_skus) > 10 else "")
        drop_list = ", ".join(escape(x) for x in dropped[:10]) + (f" (+{len(dropped)-10} more)" if len(dropped) > 10 else "")
        new_html = f'''
        <div class="sku-churn">
          <div class="churn-row">
            <span class="churn-label new">New yesterday ({len(new_skus)})</span>
            <span class="churn-list">{new_list or "—"}</span>
          </div>
          <div class="churn-row">
            <span class="churn-label gone">Not sold yesterday ({len(dropped)})</span>
            <span class="churn-list">{drop_list or "—"}</span>
          </div>
        </div>'''

    return f'''
    <p class="section-note">High concentration means the catalog is leaning on a narrow base — fragile to single-SKU stockouts or trend shifts. Diffusing concentration usually means the menu is performing broadly. Worth watching weekly drift.</p>
    <div class="kpi-grid" style="margin-bottom:14px">
      <div class="kpi-tile">
        <div class="kpi-label">Top 5 SKUs — qty share</div>
        <div class="kpi-main">{f1(f['top5_qty'])}<span class="unit">%</span></div>
        <div class="kpi-compare">
          <div class="item">vs LW <span class="v">{f1(c['top5_qty'],'%')}</span> {trend_chip(f['top5_qty'], c['top5_qty'])}</div>
        </div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Top 5 SKUs — revenue share</div>
        <div class="kpi-main">{f1(f['top5_rev'])}<span class="unit">%</span></div>
        <div class="kpi-compare">
          <div class="item">vs LW <span class="v">{f1(c['top5_rev'],'%')}</span> {trend_chip(f['top5_rev'], c['top5_rev'])}</div>
        </div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Top 10 SKUs — qty share</div>
        <div class="kpi-main">{f1(f['top10_qty'])}<span class="unit">%</span></div>
        <div class="kpi-compare">
          <div class="item">vs LW <span class="v">{f1(c['top10_qty'],'%')}</span> {trend_chip(f['top10_qty'], c['top10_qty'])}</div>
        </div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">Top 20 SKUs — qty share</div>
        <div class="kpi-main">{f1(f['top20_qty'])}<span class="unit">%</span></div>
        <div class="kpi-compare">
          <div class="item">vs LW <span class="v">{f1(c['top20_qty'],'%')}</span> {trend_chip(f['top20_qty'], c['top20_qty'])}</div>
        </div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-label">SKUs sold yesterday</div>
        <div class="kpi-main">{n(f['n_skus_active'])}</div>
        <div class="kpi-compare">
          <div class="item">vs LW <span class="v">{n(c['n_skus_active'])}</span> <span class="chip mini neutral">{(f['n_skus_active']-c['n_skus_active']):+d}</span></div>
        </div>
      </div>
    </div>
    {new_html}'''


def skus_section(skus):
    rows = []
    for s in skus:
        rows.append(f'''<tr data-sku="{escape(s['sku'].lower())}" data-cat="{escape(s['category'])}">
          <td class="sku-name">{escape(s['sku'])}</td>
          <td><span class="cat-pill cat-{s['category'].lower()}">{escape(s['category'])}</span></td>
          <td class="num">{n(s['qty'])}</td>
          <td class="num small">{n(s['z_qty'])}/{n(s['s_qty'])}</td>
          <td class="num">Rs.{inr(s['rev'], k=True)}</td>
          <td class="num">Rs.{n(s['avg_price'])}</td>
          <td class="num">{n(s['comp_qty'])}</td>
          <td>{chip(s['delta_pct'])}</td>
        </tr>''')
    return f'''
    <div class="filter-bar">
      <input type="text" id="s-search" placeholder="Search SKUs..." />
      <select id="s-cat">
        <option value="">All categories</option>
        <option value="Cakes">Cakes</option>
        <option value="Desserts">Desserts</option>
        <option value="Cheesecakes">Cheesecakes</option>
        <option value="Cookies">Cookies</option>
        <option value="Snacks">Snacks</option>
        <option value="Hampers">Hampers</option>
      </select>
      <select id="s-mover">
        <option value="">All movers</option>
        <option value="up">Gainers (>+10%)</option>
        <option value="down">Losers (<-10%)</option>
      </select>
      <span class="filter-count" id="s-count">{len(skus)} SKUs</span>
    </div>
    <div class="table-card scroll">
      <table class="data sortable" id="sku-table">
        <thead><tr>
          <th data-sort="text">SKU</th>
          <th data-sort="text">Category</th>
          <th data-sort="num" class="active">Qty</th>
          <th data-sort="text">Z/S</th>
          <th data-sort="num">Revenue</th>
          <th data-sort="num">Avg Rs.</th>
          <th data-sort="num">LW Qty</th>
          <th data-sort="num">d LW</th>
        </tr></thead>
        <tbody>{"".join(rows)}</tbody>
      </table>
    </div>'''


def trend_section(trend):
    labels = [f"{x['dt'][-5:]} {x['dow']}" for x in trend]
    return f'''
    <div class="two-col">
      <div class="chart-card">
        <div class="chart-title">Orders by platform</div>
        <div class="chart-wrap"><canvas id="trend-orders"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">AOV (Rs.)</div>
        <div class="chart-wrap"><canvas id="trend-aov"></canvas></div>
      </div>
    </div>
    <div class="two-col" style="margin-top:12px">
      <div class="chart-card">
        <div class="chart-title">Cake share (%) of revenue</div>
        <div class="chart-wrap"><canvas id="trend-cake"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">Outlet discount (%) of GMV</div>
        <div class="chart-wrap"><canvas id="trend-disc"></canvas></div>
      </div>
    </div>
    <script>
      window._trend = {{
        labels: {json.dumps(labels)},
        z: {json.dumps([x['z_orders'] for x in trend])},
        s: {json.dumps([x['s_orders'] for x in trend])},
        aov: {json.dumps([x['aov'] for x in trend])},
        cake: {json.dumps([x['cake_share_rev'] for x in trend])},
        od: {json.dumps([x['out_disc_pct'] for x in trend])}
      }};
    </script>'''


# ---------- top-level ----------
def render(data):
    """Build the full HTML."""
    with open(os.path.join(HERE, "templates", "style.css")) as f:
        css = f.read()
    # Append v2 stylesheet additions
    v2_css_path = os.path.join(HERE, "templates", "style_v2.css")
    if os.path.exists(v2_css_path):
        with open(v2_css_path) as f:
            css += "\n" + f.read()
    with open(os.path.join(HERE, "templates", "script.js")) as f:
        js = f.read()
    # Append v2 javascript additions
    v2_js_path = os.path.join(HERE, "templates", "script_v2.js")
    if os.path.exists(v2_js_path):
        with open(v2_js_path) as f:
            js += "\n" + f.read()

    # Import v2 section renderers
    from render_v2 import (glance_section, lux_section_v2, city_section_v2,
                            discount_section_v2, category_section_v2,
                            sku_concentration_section_v2, cake_share_chart_section)

    fd, cd = data["focal_dt"], data["comp_dt"]
    fdow, cdow = data["focal_dow"], data["comp_dow"]

    body = f'''
<header>
  <div class="header-inner">
    <div>
      <div class="brand"><span class="accent">Creme Castle</span> &middot; Daily Operations</div>
      <div class="subhead">{fdow}, <strong>{fd}</strong> &nbsp;&middot;&nbsp; vs {cdow}, <strong>{cd}</strong> &amp; trailing 7/30-day avg</div>
    </div>
    <nav class="nav">
      <a href="#briefing">Briefing</a>
      <a href="#kpis">Glance</a>
      <a href="#trend">Trend</a>
      <a href="#cities">Cities</a>
      <a href="#outlets">Outlets</a>
      <a href="#ranks">Rank Shifts</a>
      <a href="#discount">Discount</a>
      <a href="#categories">Category</a>
      <a href="#hours">Hours</a>
      <a href="#concentration">Concentration</a>
      <a href="#skus">SKUs</a>
    </nav>
  </div>
</header>

<div class="container">

<section id="briefing">
  <div class="section-head"><span class="num">01</span><h2>Daily Briefing</h2>
    <span class="meta">{len(data['briefings'])} signals &middot; ranked by severity</span></div>
  <div class="briefings">{briefings(data['briefings'])}</div>
</section>

<section id="kpis">
  <div class="section-head"><span class="num">02</span><h2>Yesterday at a Glance</h2>
    <span class="meta">10 metrics &middot; 5 ranges &middot; Total / Zomato / Swiggy tabs</span></div>
  {glance_section(data['glance_block'])}
</section>

<section id="trend">
  <div class="section-head"><span class="num">03</span><h2>14-Day Trend</h2>
    <span class="meta">orders, AOV, cake share, outlet disc%</span></div>
  {trend_section(data['trend'])}
</section>

<section id="cities">
  <div class="section-head"><span class="num">04</span><h2>City Clusters</h2>
    <span class="meta">multi-range metrics &middot; platform mix per city</span></div>
  {city_section_v2(data['city_block'])}
</section>

<section id="outlets">
  <div class="section-head"><span class="num">05</span><h2>Outlet Performance</h2>
    <span class="meta">filter by city, platform mix, status &middot; click headers to sort</span></div>
  {outlet_grid(data['out_f'], data['out_c'], data['out_a'])}
</section>

<section id="ranks">
  <div class="section-head"><span class="num">06</span><h2>Outlet Rank Shifts</h2>
    <span class="meta">leaderboard movement vs same day last week</span></div>
  {rank_shifts_section(data['rank_shifts'])}
</section>

<section id="discount">
  <div class="section-head"><span class="num">07</span><h2>Discount Diagnostic</h2>
    <span class="meta">Outlet Disc / GMV &middot; multi-range &middot; biggest outlet shifts</span></div>
  {discount_section_v2(data['disc_diag'], data['bands_f'], data['bands_c'])}
</section>

<section id="categories">
  <div class="section-head"><span class="num">08</span><h2>Category &amp; Cake Health</h2>
    <span class="meta">cake share by platform &middot; category mix &middot; multi-range</span></div>
  {cake_share_chart_section(data['cake_share_trend'])}
  <h3 class="sub-head" style="margin-top:24px">Category breakdown</h3>
  {category_section_v2(data['cat_block'])}
</section>

<section id="hours">
  <div class="section-head"><span class="num">09</span><h2>Hour-of-Day Pattern</h2>
    <span class="meta">reveals mid-day cliffs and cutoff issues</span></div>
  {hour_section(data['hour_outlets'], data['hour_brand_f'], data['hour_brand_c'])}
</section>

<section id="concentration">
  <div class="section-head"><span class="num">10</span><h2>SKU Concentration</h2>
    <span class="meta">top 10 share + per-SKU comparison vs 4 ranges</span></div>
  {sku_concentration_section_v2(data['sku_concentration_v2'])}
</section>

<section id="skus">
  <div class="section-head"><span class="num">11</span><h2>Top SKU Movers</h2>
    <span class="meta">filter by category, mover direction &middot; click headers to sort</span></div>
  {skus_section(data['skus'])}
</section>

<footer>Creme Castle &middot; daily report &middot; generated {datetime.now().strftime('%Y-%m-%d %H:%M')}</footer>

</div>
'''

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CC Daily - {fd}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>{css}</style>
</head>
<body>
  {body}
  <script>{js}</script>
</body>
</html>
'''


# =====================================================================
# Belgian pricing experiment section
# =====================================================================
def belgian_section(b):
    if b is None:
        return '<div class="section-note">No Belgian Chocolate Cake sales data found.</div>'

    # Comparison cards: pre vs post for each group
    def grp_card(title, pre, post, group_class):
        if not pre or not post:
            return f'<div class="exp-card {group_class}"><div class="exp-card-head"><span class="grp-title">{title}</span></div><div class="exp-card-body"><span class="empty">Not enough data.</span></div></div>'
        d_qpd = pct_delta(post["qty_per_outlet_per_day"], pre["qty_per_outlet_per_day"])
        d_conv = pct_delta(post["conversion_pct"], pre["conversion_pct"])
        d_rpd = pct_delta(post["rev_per_outlet_per_day"], pre["rev_per_outlet_per_day"])
        return f'''
        <div class="exp-card {group_class}">
          <div class="exp-card-head">
            <span class="grp-title">{title}</span>
            <span class="grp-meta">{pre["n_outlets"]} outlets</span>
          </div>
          <div class="exp-card-body">
            <table class="exp-compare">
              <thead><tr><th></th><th>Pre ({pre["n_days"]}d)</th><th>Post ({post["n_days"]}d)</th><th>d</th></tr></thead>
              <tbody>
                <tr><td>Qty / outlet / day</td><td class="num">{pre["qty_per_outlet_per_day"]:.2f}</td><td class="num"><strong>{post["qty_per_outlet_per_day"]:.2f}</strong></td><td>{chip(d_qpd)}</td></tr>
                <tr><td>Conversion</td><td class="num">{pre["conversion_pct"]:.2f}%</td><td class="num"><strong>{post["conversion_pct"]:.2f}%</strong></td><td>{chip(d_conv)}</td></tr>
                <tr><td>Revenue / outlet / day</td><td class="num">Rs.{pre["rev_per_outlet_per_day"]:.0f}</td><td class="num"><strong>Rs.{post["rev_per_outlet_per_day"]:.0f}</strong></td><td>{chip(d_rpd)}</td></tr>
                <tr><td>Avg realised price</td><td class="num">Rs.{pre["avg_realised_price"]:.0f}</td><td class="num">Rs.{post["avg_realised_price"]:.0f}</td><td></td></tr>
                <tr><td>Total qty (window)</td><td class="num">{pre["qty"]}</td><td class="num">{post["qty"]}</td><td></td></tr>
              </tbody>
            </table>
          </div>
        </div>'''

    test_card = grp_card("Test (Rs.899 real)", b["pre_test"], b["post_test"], "exp-test")
    ctrl_card = grp_card("Control (Rs.899 → 699 strikethrough)", b["pre_control"], b["post_control"], "exp-control")

    # Verdict line
    verdict = ""
    if b["post_test"] and b["post_control"]:
        t_lift = pct_delta(b["post_test"]["conversion_pct"], b["pre_test"]["conversion_pct"]) or 0
        c_lift = pct_delta(b["post_control"]["conversion_pct"], b["pre_control"]["conversion_pct"]) or 0
        diff = c_lift - t_lift
        if abs(diff) < 5:
            verdict = f'<div class="verdict neutral">Both groups lifted similarly ({t_lift:+.0f}% vs {c_lift:+.0f}% conversion). Inconclusive — let it run longer.</div>'
        elif diff > 0:
            verdict = f'<div class="verdict bad">Strikethrough is winning: Control lifted +{c_lift:.0f}% conversion vs Test +{t_lift:.0f}% (gap {diff:+.0f}pp). Discount perception currently outperforms premium pricing.</div>'
        else:
            verdict = f'<div class="verdict good">Premium pricing is winning: Test lifted +{t_lift:.0f}% conversion vs Control +{c_lift:.0f}% (gap {-diff:+.0f}pp). Worth holding ₹899 at the test outlets.</div>'

    # Per-outlet focal-day breakdown
    rows = []
    for r in b["focal_per_outlet"]:
        cls = "exp-test-row" if r["group"].startswith("Test") else "exp-control-row"
        d_avg = pct_delta(r["qty_focal"], r["qty_7d_avg"]) if r["qty_7d_avg"] else None
        rows.append(f'''<tr class="{cls}">
          <td class="outlet-name">{escape(r["outlet"])}</td>
          <td><span class="grp-pill {cls}">{r["group"]}</span></td>
          <td class="num">{r["qty_focal"]}</td>
          <td class="num">{r["qty_7d_avg"]:.1f}</td>
          <td>{chip(d_avg)}</td>
          <td class="num">Rs.{inr(r["rev_focal"], k=False)}</td>
        </tr>''')

    missing_note = ""
    if b["test_outlets_missing"]:
        missing_note = f'<p class="caveat">Note: {len(b["test_outlets_missing"])} listed test outlet(s) had no Belgian sales in the dataset: {", ".join(b["test_outlets_missing"])}.</p>'

    return f'''
    <p class="section-note">Started <strong>{b["start_date"]}</strong>. Test outlets show Rs.899 (real premium price). Control outlets show Rs.899 struck through to Rs.699 (perceived discount). Same SKU. {len(b["test_outlets"])} test outlets vs {len(b["control_outlets"])} control outlets carrying this SKU. Goal: see which framing converts better.</p>
    {verdict}
    <div class="exp-grid">
      {test_card}
      {ctrl_card}
    </div>
    <h3 class="sub-head">Daily Belgian sales — qty per outlet per day</h3>
    <div class="chart-card">
      <div class="chart-wrap"><canvas id="belgian-trend"></canvas></div>
    </div>
    <h3 class="sub-head">Per-outlet on focal day</h3>
    <div class="table-card scroll">
      <table class="data sortable">
        <thead><tr>
          <th data-sort="text">Outlet</th>
          <th data-sort="text">Group</th>
          <th data-sort="num">Yesterday qty</th>
          <th data-sort="num">7-day avg</th>
          <th data-sort="num">d vs 7d</th>
          <th data-sort="num">Yesterday revenue</th>
        </tr></thead>
        <tbody>{"".join(rows)}</tbody>
      </table>
    </div>
    {missing_note}
    <script>
      window._belgianTrend = {{
        labels: {json.dumps(b["chart_dates"])},
        test: {json.dumps(b["chart_test"])},
        control: {json.dumps(b["chart_control"])},
        startDate: {json.dumps(str(b["start_date"]))}
      }};
    </script>'''


# =====================================================================
# Generic launch section (used by Lux + Mango)
# =====================================================================
def launch_section(L, anchor_id):
    if not L["active"]:
        return f'<div class="section-note"><strong>{escape(L["label"])}</strong> has no sales recorded yet. Section will populate once items start selling.</div>'

    # SKU summary cards
    sku_cards = []
    for s in L["skus"]:
        z_pct = safe_div(s["z_qty"], s["total_qty"]) * 100
        sku_cards.append(f'''
        <div class="launch-sku-card">
          <div class="launch-sku-head">
            <span class="launch-sku-name">{escape(s["sku"])}</span>
            <span class="launch-sku-meta">live {s["days_live"]}d</span>
          </div>
          <div class="launch-sku-stats">
            <div class="stat"><span class="stat-num">{s["total_qty"]}</span><span class="stat-label">total qty</span></div>
            <div class="stat"><span class="stat-num">{s["focal_qty"]}</span><span class="stat-label">yesterday</span></div>
            <div class="stat"><span class="stat-num">{s["n_outlets"]}</span><span class="stat-label">outlets</span></div>
            <div class="stat"><span class="stat-num">Rs.{inr(s["total_rev"], k=True)}</span><span class="stat-label">total rev</span></div>
          </div>
          <div class="launch-sku-split">
            <div class="split-bar">
              <div class="seg-z" style="flex:{z_pct:.1f}" title="Zomato {s['z_qty']}"></div>
              <div class="seg-s" style="flex:{100-z_pct:.1f}" title="Swiggy {s['s_qty']}"></div>
            </div>
            <div class="split-labels">
              <span><span class="dot dot-z"></span>Z {s["z_qty"]}</span>
              <span><span class="dot dot-s"></span>S {s["s_qty"]}</span>
            </div>
          </div>
          <div class="launch-sku-foot">Top: <strong>{escape(s["top_outlet"])}</strong> ({s["top_outlet_qty"]} sold)</div>
        </div>''')

    # Outlets adoption table
    adopt_rows = []
    for o in L["outlets_with_sales"]:
        adopt_rows.append(f'''<tr>
          <td class="outlet-name">{escape(o["outlet"])}</td>
          <td class="num">{o["qty"]}</td>
          <td class="num">{o["n_skus"]}</td>
          <td class="small">{o["first_sale"]}</td>
        </tr>''')

    no_sales_html = ""
    if L["outlets_no_sales"]:
        chips_html = "".join(f'<span class="no-sales-pill">{escape(o)}</span>' for o in L["outlets_no_sales"])
        no_sales_html = f'''
        <h3 class="sub-head">Outlets with NO {escape(L["label"])} sales yet ({len(L["outlets_no_sales"])})</h3>
        <p class="caveat">These outlets have not sold a single unit from this range. Consider menu push, photo refresh, or BOS-Cake bid.</p>
        <div class="no-sales-list">{chips_html}</div>'''

    return f'''
    <p class="section-note">Range first launched <strong>{L["launch_dt"]}</strong>. Total qty since launch: <strong>{L["total_qty_since_launch"]}</strong> across all outlets. Yesterday: <strong>{L["focal_total"]}</strong> sold across <strong>{L["focal_outlets"]}</strong> outlets.</p>

    <h3 class="sub-head">By SKU</h3>
    <div class="launch-sku-grid">
      {"".join(sku_cards)}
    </div>

    <h3 class="sub-head">Daily {escape(L["label"])} qty since launch</h3>
    <div class="chart-card">
      <div class="chart-wrap"><canvas id="{anchor_id}-trend"></canvas></div>
    </div>

    <h3 class="sub-head">Outlets selling {escape(L["label"])} ({len(L["outlets_with_sales"])})</h3>
    <div class="table-card scroll" style="max-height:340px;overflow-y:auto">
      <table class="data sortable">
        <thead><tr>
          <th data-sort="text">Outlet</th>
          <th data-sort="num" class="active">Total qty</th>
          <th data-sort="num">SKUs sold</th>
          <th data-sort="text">First sale</th>
        </tr></thead>
        <tbody>{"".join(adopt_rows)}</tbody>
      </table>
    </div>

    {no_sales_html}

    <script>
      window._{anchor_id.replace('-','_')}Trend = {{
        labels: {json.dumps([d["dt"] for d in L["daily"]])},
        qty: {json.dumps([d["qty"] for d in L["daily"]])},
        outlets: {json.dumps([d["n_outlets"] for d in L["daily"]])}
      }};
    </script>'''
