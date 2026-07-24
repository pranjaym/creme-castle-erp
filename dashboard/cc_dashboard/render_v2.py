"""V2 render functions. Used by render.py main()."""
import json
from html import escape
from datetime import datetime, timedelta
from render import inr, n, f1, f0, chip


def _fmt_val(val, unit):
    """Format a value based on type."""
    if val is None or val == 0 and unit != "count":
        return "-" if val is None else "0"
    if unit == "money":
        if val >= 100000: return f"₹{val/100000:.2f}L"
        if val >= 1000:   return f"₹{val/1000:.1f}K"
        return f"₹{val:.0f}"
    if unit == "pct":
        return f"{val:.1f}%"
    if unit == "count":
        return f"{val:,.0f}"
    return str(val)


def _micro_delta(focal_val, comp_val, unit, inverse=False):
    """Return small delta indicator HTML.
    inverse=True for metrics where higher = worse (e.g., outlet discount %)."""
    if comp_val is None or comp_val == 0: return ""
    if focal_val is None: return ""
    if unit == "pct":
        # For percent metrics, show pp difference
        d = focal_val - comp_val
        sign = "+" if d > 0 else ""
        if inverse:
            cls = "down" if d > 0 else "up" if d < 0 else ""
        else:
            cls = "up" if d > 0 else "down" if d < 0 else ""
        return f'<span class="micro-delta {cls}">{sign}{d:.1f}pp</span>'
    else:
        d = (focal_val - comp_val) / comp_val * 100
        sign = "+" if d > 0 else ""
        if inverse:
            cls = "down" if d > 5 else "up" if d < -5 else ""
        else:
            cls = "up" if d > 5 else "down" if d < -5 else ""
        return f'<span class="micro-delta {cls}">{sign}{d:.0f}%</span>'


# Metrics where "up" = bad (color inverted)
INVERSE_METRICS = {"out_disc_pct", "disc_pct"}


# =====================================================================
# SECTION 02 — Yesterday at a Glance (multi-metric × multi-range × platform tabs)
# =====================================================================

GLANCE_METRICS_DISPLAY = [
    ("orders",         "Orders",          "count",  "VOLUME"),
    ("net_rev",        "Net Revenue",     "money",  "VOLUME"),
    ("aov",            "AOV",             "money",  "VOLUME"),
    ("out_disc_pct",   "Outlet Disc %",   "pct",    "VOLUME"),
    ("cake_qty",       "Cake Qty",        "count",  "CAKE / DESSERT"),
    ("cake_rev",       "Cake Revenue",    "money",  "CAKE / DESSERT"),
    ("dessert_qty",    "Dessert Qty",     "count",  "CAKE / DESSERT"),
    ("dessert_rev",    "Dessert Revenue", "money",  "CAKE / DESSERT"),
    ("cake_qty_share", "Cake Qty %",      "pct",    "MIX"),
    ("cake_rev_share", "Cake Revenue %",  "pct",    "MIX"),
]


def glance_section(gb):
    """Build the multi-metric, multi-range table with platform tabs."""
    focal_dt = gb["focal_dt"]
    day_before_dt = gb["day_before_dt"]
    last_week_dt = gb["last_week_dt"]

    def _build_table(plat):
        rows_html = []
        last_group = None
        for key, label, unit, group in GLANCE_METRICS_DISPLAY:
            if group != last_group:
                rows_html.append(f'<tr class="section-header"><td colspan="6">{group}</td></tr>')
                last_group = group
            inv = key in INVERSE_METRICS
            f_val = gb["focal"][plat].get(key)
            db_val = gb["day_before"][plat].get(key) if gb["day_before"] else None
            lw_val = gb["last_week"][plat].get(key) if gb["last_week"] else None
            a7_val = gb["avg_7d"][plat].get(key) if gb["avg_7d"] else None
            a30_val = gb["avg_30d"][plat].get(key) if gb["avg_30d"] else None
            rows_html.append(f'''
            <tr>
              <td>{escape(label)}</td>
              <td class="focal-cell">{_fmt_val(f_val, unit)}</td>
              <td>{_fmt_val(db_val, unit)}{_micro_delta(f_val, db_val, unit, inv)}</td>
              <td>{_fmt_val(lw_val, unit)}{_micro_delta(f_val, lw_val, unit, inv)}</td>
              <td>{_fmt_val(a7_val, unit)}{_micro_delta(f_val, a7_val, unit, inv)}</td>
              <td>{_fmt_val(a30_val, unit)}{_micro_delta(f_val, a30_val, unit, inv)}</td>
            </tr>''')
        return "\n".join(rows_html)

    def _header():
        return f'''
        <thead>
          <tr>
            <th>Metric</th>
            <th>Yesterday<span class="dt-sub">{focal_dt.strftime('%a %d %b')}</span></th>
            <th>Day Before<span class="dt-sub">{day_before_dt.strftime('%a %d %b')}</span></th>
            <th>Same DOW LW<span class="dt-sub">{last_week_dt.strftime('%a %d %b')}</span></th>
            <th>7-Day Avg<span class="dt-sub">{gb["avg_7d_n"]} days</span></th>
            <th>30-Day Avg<span class="dt-sub">{gb["avg_30d_n"]} days</span></th>
          </tr>
        </thead>'''

    return f'''
    <div class="tab-control">
      <button class="active" onclick="switchTab(event, 'glance', 'all')">Total</button>
      <button class="plat-z" onclick="switchTab(event, 'glance', 'zomato')">Zomato</button>
      <button class="plat-s" onclick="switchTab(event, 'glance', 'swiggy')">Swiggy</button>
    </div>
    <div id="glance-all" class="tab-content active">
      <table class="range-table">{_header()}<tbody>{_build_table("All")}</tbody></table>
    </div>
    <div id="glance-zomato" class="tab-content">
      <table class="range-table">{_header()}<tbody>{_build_table("Zomato")}</tbody></table>
    </div>
    <div id="glance-swiggy" class="tab-content">
      <table class="range-table">{_header()}<tbody>{_build_table("Swiggy")}</tbody></table>
    </div>
    '''


# =====================================================================
# SECTION — Lux Cakes deep dive
# =====================================================================

def _clean_sku_name(name):
    """Strip trailing size suffix for display."""
    import re
    return re.sub(r'\s*\(\d+\s*Gm\)\s*$', '', name, flags=re.IGNORECASE).strip()


def lux_section_v2(lux):
    """Lux Cakes deep dive — cards per SKU + outlet × SKU heatmap."""
    skus = lux["skus"]
    summary = lux["summary"]
    daily = lux["daily"]
    outlet_matrix = lux["outlet_matrix"]

    # Cards row — one per SKU
    cards = []
    spark_data = {}
    for sku in skus:
        s = summary[sku]
        clean = _clean_sku_name(sku)
        qty_14 = s["qty_14d"]
        qty_14p = s["qty_14d_prior"]
        delta = qty_14 - qty_14p
        dpct = (delta / qty_14p * 100) if qty_14p else None
        if dpct is None: delta_html = '<span class="chip na">new</span>'
        else: delta_html = chip(dpct)

        total_z_s = s["zomato_qty"] + s["swiggy_qty"]
        z_share = (s["zomato_qty"] / total_z_s * 100) if total_z_s else 0
        s_share = (s["swiggy_qty"] / total_z_s * 100) if total_z_s else 0

        spark_id = f"lux-spark-{skus.index(sku)}"
        spark_data[spark_id] = [d["qty"] for d in daily[sku]]

        cards.append(f'''
        <div class="lux-card">
          <div class="lux-name">{escape(clean)}</div>
          <div class="lux-qty">{qty_14}<span class="unit">qty / 14d</span></div>
          <div class="lux-delta">{delta_html} <span style="color:var(--text-muted);font-size:11px;margin-left:4px">vs prior 14d ({qty_14p})</span></div>
          <div style="height:36px;position:relative;margin-top:6px"><canvas id="{spark_id}"></canvas></div>
          <div class="lux-meta">
            <div>Avg price<span class="v">₹{s["avg_price"]:.0f}</span></div>
            <div>Outlets active<span class="v">{s["outlets_selling"]} / {s["outlets_total"]}</span></div>
          </div>
          <div style="margin-top:10px;font-size:10.5px;color:var(--text-muted)">
            Platform mix (14d):
            <div class="lux-split-bar">
              <div class="seg seg-z" style="width:{z_share:.1f}%"></div>
              <div class="seg seg-s" style="width:{s_share:.1f}%"></div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:4px;font-size:10px">
              <span style="color:var(--critical)">Z {s["zomato_qty"]} ({z_share:.0f}%)</span>
              <span style="color:var(--watch)">S {s["swiggy_qty"]} ({s_share:.0f}%)</span>
            </div>
          </div>
        </div>''')

    # Heatmap matrix — SKU rows × outlet columns, value = qty in last 14d
    all_outlets = lux["outlets_total"]

    # Filter to outlets that sold at least 1 Lux item in last 14d
    active_outlets = []
    for o in all_outlets:
        total = sum(outlet_matrix[sku][o]["recent"] for sku in skus)
        if total > 0:
            active_outlets.append((o, total))
    active_outlets.sort(key=lambda x: -x[1])
    active_outlets = [o for o, _ in active_outlets]

    # Compute max for color scale
    max_val = 0
    for sku in skus:
        for o in active_outlets:
            max_val = max(max_val, outlet_matrix[sku][o]["recent"])

    def _heat_class(v, mx):
        if v == 0: return "h-0"
        if v <= mx * 0.10: return "h-1"
        if v <= mx * 0.25: return "h-2"
        if v <= mx * 0.50: return "h-3"
        if v <= mx * 0.80: return "h-4"
        return "h-5"

    # Build header row — outlet short labels
    def _short(o): return o.replace("CC-", "").replace("DL-","DL-").replace("ND-","ND-").replace("GGN-","GGN-")
    header_html = "<th>SKU \\ Outlet (last 14d qty)</th>" + "".join(
        f'<th style="font-size:9.5px;white-space:nowrap">{escape(_short(o))}</th>' for o in active_outlets
    )

    # Build data rows
    body_rows = []
    for sku in skus:
        clean = _clean_sku_name(sku)
        row_total = sum(outlet_matrix[sku][o]["recent"] for o in active_outlets)
        cells = [f"<td>{escape(clean)} <span style=\"color:var(--text-muted);font-weight:400\">({row_total})</span></td>"]
        for o in active_outlets:
            v = outlet_matrix[sku][o]["recent"]
            p = outlet_matrix[sku][o]["prior"]
            cls = _heat_class(v, max_val) if max_val > 0 else "h-0"
            delta = v - p
            micro = ""
            if v > 0 and p > 0 and abs(delta) >= 2:
                sign = "+" if delta > 0 else ""
                micro = f'<span class="micro">{sign}{delta}</span>'
            cells.append(f'<td class="{cls}">{v if v > 0 else "·"}{micro}</td>')
        body_rows.append(f"<tr>{''.join(cells)}</tr>")

    heatmap_html = f'''
    <div class="lux-matrix">
      <div class="lux-matrix-title">SKU × Outlet performance — last 14 days vs prior 14 days</div>
      <div class="lux-matrix-sub">
        Darker = higher qty. Small numbers show delta vs prior 14-day period (only shown when |Δ| ≥ 2 units).
        Showing {len(active_outlets)} of {len(all_outlets)} outlets that sold at least one Lux item in last 14 days.
      </div>
      <div style="overflow-x:auto">
        <table class="lux-heatmap">
          <thead><tr>{header_html}</tr></thead>
          <tbody>{''.join(body_rows)}</tbody>
        </table>
      </div>
    </div>
    '''

    # Embed daily series for spark charts
    spark_js = f"window._luxSparks = {json.dumps(spark_data)};"

    return f'''
    <div class="lux-grid">
      {''.join(cards)}
    </div>
    {heatmap_html}
    <script>{spark_js}</script>
    '''


# =====================================================================
# SECTION — City Clusters v2
# =====================================================================

def city_section_v2(cb):
    """City clusters — single Total view.

    5-range metric table + Z-vs-S side panel per city. In the Orders row,
    each period's total is shown with a small Zomato/Swiggy split beneath it,
    so the platform breakdown is visible in the same view without a toggle.
    """
    focal = cb["focal"]
    db = cb["day_before"]
    lw = cb["last_week"]
    a7 = cb["avg_7d"]
    a30 = cb["avg_30d"]

    focal_dt = cb["focal_dt"]
    day_before_dt = cb["day_before_dt"]
    last_week_dt = cb["last_week_dt"]

    # Sort cities by focal All orders desc
    city_order = sorted(focal.keys(), key=lambda c: -focal[c]["All"]["orders"])

    def _card(city):
        # Full per-period nodes (each has All / Zomato / Swiggy)
        node_f   = focal.get(city, {})
        node_db  = db.get(city, {}) if db else {}
        node_lw  = lw.get(city, {}) if lw else {}
        node_a7  = a7.get(city, {}) if a7 else {}
        node_a30 = a30.get(city, {}) if a30 else {}

        f_all = node_f.get("All", {})
        f_z = node_f.get("Zomato", {})
        f_s = node_f.get("Swiggy", {})
        if f_all.get("orders", 0) < 5:
            return ""  # too small to show meaningfully

        # "All" sub-dicts per period, for the non-Orders metric rows
        db_all  = node_db.get("All")
        lw_all  = node_lw.get("All")
        a7_all  = node_a7.get("All")
        a30_all = node_a30.get("All")

        # Platform share (focal day)
        tot_o = f_z.get("orders", 0) + f_s.get("orders", 0)
        z_o_share = (f_z["orders"] / tot_o * 100) if tot_o else 0
        s_o_share = (f_s["orders"] / tot_o * 100) if tot_o else 0

        # 30d platform share shift
        a30_z = node_a30.get("Zomato")
        a30_s = node_a30.get("Swiggy")
        if a30_z and a30_s:
            a30_tot_o = a30_z["orders"] + a30_s["orders"]
            a30_s_share = (a30_s["orders"] / a30_tot_o * 100) if a30_tot_o else 0
            share_shift = s_o_share - a30_s_share
        else:
            share_shift = None

        # ---- Orders row: total per period + small Z/S split beneath ----
        f_orders = f_all.get("orders")

        def _orders_cell(node, is_focal=False):
            alld = node.get("All") if node else None
            if not alld:
                return '<td>-</td>'
            allo = alld.get("orders")
            zo = node.get("Zomato", {}).get("orders", 0)
            so = node.get("Swiggy", {}).get("orders", 0)
            delta = "" if is_focal else _micro_delta(f_orders, allo, "count", False)
            zs = (f'<span class="zs-split">'
                  f'<span class="zs-z">Z {zo:,.0f}</span>'
                  f'<span class="zs-s">S {so:,.0f}</span>'
                  f'</span>')
            cls = ' class="focal-cell"' if is_focal else ''
            return f'<td{cls}>{_fmt_val(allo, "count")}{delta}{zs}</td>'

        orders_row = (
            '<tr>'
            '<td>Orders</td>'
            f'{_orders_cell(node_f, is_focal=True)}'
            f'{_orders_cell(node_db)}'
            f'{_orders_cell(node_lw)}'
            f'{_orders_cell(node_a7)}'
            f'{_orders_cell(node_a30)}'
            '</tr>'
        )

        # ---- Other metric rows (All only) ----
        def _row(label, key, unit):
            inv = key in INVERSE_METRICS
            f_v = f_all.get(key)
            db_v = db_all.get(key) if db_all else None
            lw_v = lw_all.get(key) if lw_all else None
            a7_v = a7_all.get(key) if a7_all else None
            a30_v = a30_all.get(key) if a30_all else None
            return f'''
            <tr>
              <td>{escape(label)}</td>
              <td class="focal-cell">{_fmt_val(f_v, unit)}</td>
              <td>{_fmt_val(db_v, unit)}{_micro_delta(f_v, db_v, unit, inv)}</td>
              <td>{_fmt_val(lw_v, unit)}{_micro_delta(f_v, lw_v, unit, inv)}</td>
              <td>{_fmt_val(a7_v, unit)}{_micro_delta(f_v, a7_v, unit, inv)}</td>
              <td>{_fmt_val(a30_v, unit)}{_micro_delta(f_v, a30_v, unit, inv)}</td>
            </tr>'''

        rows = (
            orders_row +
            _row("Net Revenue", "net_rev", "money") +
            _row("AOV", "aov", "money") +
            _row("Outlet Disc %", "out_disc_pct", "pct") +
            _row("Cake Qty %", "cake_qty_share", "pct") +
            _row("Cake Rev %", "cake_rev_share", "pct")
        )

        # ---- Z vs S comparison bars (yesterday) ----
        def _compare_bar(label, z_val, s_val, unit, inverse=False):
            if z_val is None and s_val is None: return ""
            z_val = z_val or 0
            s_val = s_val or 0
            mx = max(z_val, s_val, 0.0001)
            z_pct_w = (z_val / mx * 100) if mx else 0
            s_pct_w = (s_val / mx * 100) if mx else 0
            z_str = _fmt_val(z_val, unit)
            s_str = _fmt_val(s_val, unit)
            if inverse:
                z_cls = "winner" if z_val <= s_val else "loser"
                s_cls = "winner" if s_val < z_val else "loser"
            else:
                z_cls = "winner" if z_val >= s_val else "loser"
                s_cls = "winner" if s_val > z_val else "loser"
            return f'''
            <div class="zs-compare-row">
              <div class="zs-label">{escape(label)}</div>
              <div class="zs-bars">
                <div class="zs-z {z_cls}">
                  <span class="zs-bar" style="width:{z_pct_w:.0f}%"></span>
                  <span class="zs-val">{z_str}</span>
                </div>
                <div class="zs-s {s_cls}">
                  <span class="zs-bar" style="width:{s_pct_w:.0f}%"></span>
                  <span class="zs-val">{s_str}</span>
                </div>
              </div>
            </div>'''

        zs_compare = f'''
        <div class="zs-compare">
          <div class="zs-compare-head">
            <span class="zs-z-dot">Zomato</span> &middot; <span class="zs-s-dot">Swiggy</span>
            <span class="zs-meta">yesterday — side-by-side</span>
          </div>
          {_compare_bar("Orders", f_z.get("orders"), f_s.get("orders"), "count")}
          {_compare_bar("Net Rev", f_z.get("net_rev"), f_s.get("net_rev"), "money")}
          {_compare_bar("AOV", f_z.get("aov"), f_s.get("aov"), "money")}
          {_compare_bar("Disc %", f_z.get("out_disc_pct"), f_s.get("out_disc_pct"), "pct", inverse=True)}
          {_compare_bar("Cake Qty %", f_z.get("cake_qty_share"), f_s.get("cake_qty_share"), "pct")}
          {_compare_bar("Cake Rev %", f_z.get("cake_rev_share"), f_s.get("cake_rev_share"), "pct")}
        </div>
        '''

        shift_html = ""
        if share_shift is not None and abs(share_shift) >= 2:
            arrow = "\u2191" if share_shift > 0 else "\u2193"
            shift_html = f'<span style="font-size:10.5px;color:var(--text-muted);margin-left:8px">Swiggy share {arrow} {abs(share_shift):.1f}pp vs 30d</span>'

        return f'''
        <div class="city-card">
          <div class="city-head">
            <div class="city-name">{escape(city)}</div>
            <div class="city-outlets">{f_all.get("orders", 0):.0f} orders &middot; \u20b9{f_all.get("net_rev", 0)/1000:.1f}K</div>
            <div class="city-share">
              <div class="city-share-label">
                <span class="z">Z {z_o_share:.0f}%</span> / <span class="s">S {s_o_share:.0f}%</span>
              </div>
              <div class="city-share-bar">
                <div class="seg seg-z" style="width:{z_o_share:.1f}%"></div>
                <div class="seg seg-s" style="width:{s_o_share:.1f}%"></div>
              </div>
              {shift_html}
            </div>
          </div>
          <div class="city-body">
            <div class="city-left">
              <table class="range-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Yesterday<span class="dt-sub">{focal_dt.strftime('%a %d %b')}</span></th>
                    <th>Day Before<span class="dt-sub">{day_before_dt.strftime('%a %d %b')}</span></th>
                    <th>Same DOW LW<span class="dt-sub">{last_week_dt.strftime('%a %d %b')}</span></th>
                    <th>7-Day Avg</th>
                    <th>30-Day Avg</th>
                  </tr>
                </thead>
                <tbody>{rows}</tbody>
              </table>
            </div>
            <div class="city-right">
              {zs_compare}
            </div>
          </div>
        </div>'''

    cards = [_card(c) for c in city_order]
    cards = [c for c in cards if c]

    return f'''
    <div class="section-note">
      Each city card shows a multi-range metrics table (5 comparison periods) and Z vs S side-by-side bars for yesterday.
      In the Orders row, the platform split (<span style="color:var(--critical);font-weight:600">Z</span> / <span style="color:var(--watch);font-weight:600">S</span>) is shown beneath each period's total.
      Comparison-bar width is normalized to the higher of Z/S per metric; winner highlighted; for Disc %, lower is better.
    </div>
    <div class="city-grid">
      {''.join(cards)}
    </div>
    '''


# =====================================================================
# SECTION — Discount Diagnostic v2 (correct formula)
# =====================================================================

def discount_section_v2(disc_diag, bands_f, bands_c):
    """Multi-range discount diagnostic with platform tabs and sortable outlet tables.
    Formula: OD / GMV. Aggregator discount excluded.
    """
    brand = disc_diag["brand"]
    outlet_by_plat = disc_diag["outlet"]  # dict: All / Zomato / Swiggy

    def _brand_tile(plat, cls):
        b = brand[plat]
        f_val = b["focal"]
        lw_val = b["last_week"]
        a7_val = b["avg_7d"]
        a30_val = b["avg_30d"]
        return f'''
        <div class="disc-brand-tile {cls}">
          <div class="lbl">{escape(plat)} · Outlet Disc %</div>
          <div class="focal">{f_val:.2f}<span class="unit">%</span></div>
          <div class="ranges">
            <div class="item">Same DOW LW <span class="v">{lw_val:.2f}%</span> {_micro_delta(f_val, lw_val, "pct", inverse=True)}</div>
            <div class="item">7-day Avg <span class="v">{a7_val:.2f}%</span> {_micro_delta(f_val, a7_val, "pct", inverse=True)}</div>
            <div class="item">30-day Avg <span class="v">{a30_val:.2f}%</span> {_micro_delta(f_val, a30_val, "pct", inverse=True)}</div>
          </div>
        </div>'''

    brand_tiles = f'''
    <div class="disc-brand-grid">
      {_brand_tile("All", "")}
      {_brand_tile("Zomato", "plat-z")}
      {_brand_tile("Swiggy", "plat-s")}
    </div>
    '''

    # Build an outlet-level sortable table per platform
    def _build_outlet_table(plat):
        outlet_focal = outlet_by_plat[plat]["focal"]
        outlet_lw    = outlet_by_plat[plat]["last_week"]
        outlet_a7    = outlet_by_plat[plat]["avg_7d"]
        outlet_a30   = outlet_by_plat[plat]["avg_30d"]
        rows = []
        for o, d in outlet_focal.items():
            if d["orders"] < 10: continue  # skip low-volume
            lw_v = outlet_lw.get(o, {}).get("disc_pct")
            a7_v = outlet_a7.get(o, {}).get("disc_pct")
            a30_v = outlet_a30.get(o, {}).get("disc_pct")
            shift = (d["disc_pct"] - a30_v) if a30_v is not None else 0
            rows.append({
                "outlet": o,
                "orders": d["orders"],
                "focal":  d["disc_pct"],
                "lw":     lw_v,
                "a7":     a7_v,
                "a30":    a30_v,
                "shift":  shift,
                "outd":   d["outd"],
                "gmv":    d["gmv"],
            })

        # Default sort: by |shift| desc
        rows.sort(key=lambda r: -abs(r["shift"]))

        def _cell(v, unit="pct", data_v=None):
            if v is None: return '<td data-value="-999">-</td>'
            dv = data_v if data_v is not None else v
            return f'<td data-value="{dv:.4f}">{v:.1f}%</td>' if unit == "pct" else f'<td data-value="{dv}">{v}</td>'

        body = ""
        for r in rows:
            f_v = r["focal"]
            delta = r["shift"]
            # inverse: higher disc% = bad
            cls = "down" if delta > 0 else "up"
            sign = "+" if delta > 0 else ""
            body += f'''
            <tr>
              <td data-value="{escape(r["outlet"])}">{escape(r["outlet"])}</td>
              <td data-value="{r["orders"]}">{r["orders"]}</td>
              <td class="focal-cell" data-value="{f_v:.4f}">{f_v:.1f}%</td>
              {_cell(r["lw"])}
              {_cell(r["a7"])}
              {_cell(r["a30"])}
              <td data-value="{delta:.4f}"><span class="micro-delta {cls}">{sign}{delta:.1f}pp</span></td>
            </tr>'''
        return f'''
        <table class="range-table sortable">
          <thead>
            <tr>
              <th data-sort-type="string">Outlet</th>
              <th data-sort-type="number">Orders</th>
              <th data-sort-type="number">Yesterday</th>
              <th data-sort-type="number">Same DOW LW</th>
              <th data-sort-type="number">7-Day Avg</th>
              <th data-sort-type="number">30-Day Avg</th>
              <th data-sort-type="number">Δ vs 30d</th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>'''

    # Tabbed outlet section
    outlet_tabs = f'''
    <div class="table-header" style="margin-top:18px">
      <div class="th-label">Outlet-level discount % — sortable (click any column header)</div>
      <div class="th-meta">disc % = Outlet Discount / GMV · default sort by |Δ vs 30d|</div>
    </div>
    <div class="tab-control" style="margin-bottom:8px">
      <button class="active" onclick="switchTab(event, 'disc-outlet', 'all')">Total</button>
      <button class="plat-z" onclick="switchTab(event, 'disc-outlet', 'zomato')">Zomato</button>
      <button class="plat-s" onclick="switchTab(event, 'disc-outlet', 'swiggy')">Swiggy</button>
    </div>
    <div id="disc-outlet-all" class="tab-content active">
      <div class="table-card scroll">{_build_outlet_table("All")}</div>
    </div>
    <div id="disc-outlet-zomato" class="tab-content">
      <div class="table-card scroll">{_build_outlet_table("Zomato")}</div>
    </div>
    <div id="disc-outlet-swiggy" class="tab-content">
      <div class="table-card scroll">{_build_outlet_table("Swiggy")}</div>
    </div>
    '''

    # Discount bands charts (existing — leave as-is)
    bands_charts = f'''
    <div style="margin-top:24px">
      <h3 class="sub-head" style="margin-top:0">Discount band distribution — yesterday vs same day last week</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="table-card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Zomato</div>
          <div style="height:200px;position:relative"><canvas id="bandsZ"></canvas></div>
        </div>
        <div class="table-card" style="padding:12px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Swiggy</div>
          <div style="height:200px;position:relative"><canvas id="bandsS"></canvas></div>
        </div>
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
    </script>
    '''

    return f'''
    <div class="section-note">Disc % = Outlet Discount / GMV. Aggregator funding excluded.</div>
    {brand_tiles}
    {outlet_tabs}
    {bands_charts}
    '''


# =====================================================================
# SECTION — Z vs S Cake Share trend chart (30 days)
# =====================================================================

def cake_share_chart_section(trend_data):
    """30-day Z vs S cake quantity stacked bars + Z share % line."""
    rows = trend_data["rows"]
    labels = [r["dt"].strftime("%d %b") for r in rows]
    z_qty = [r["z"] for r in rows]
    s_qty = [r["s"] for r in rows]
    z_share = [r["z_share"] for r in rows]
    total = [r["total"] for r in rows]

    focal_row = rows[-1]
    avg_z_share = trend_data["avg_z_share"]
    z_30d = trend_data["z_total_30d"]
    s_30d = trend_data["s_total_30d"]

    # Build mini summary tiles
    return f'''
    <div class="cake-share-section">
      <div class="cake-share-header">
        <div class="cake-share-title">Cake quantity by platform — last 30 days</div>
        <div class="cake-share-sub">Yesterday: Z {focal_row["z"]} / S {focal_row["s"]} = {focal_row["z_share"]:.0f}% Zomato.
        30-day total: Z {z_30d:,} / S {s_30d:,} = {avg_z_share:.0f}% Zomato.</div>
      </div>
      <div class="cake-share-tiles">
        <div class="cake-share-tile">
          <div class="lbl">Yesterday Z share</div>
          <div class="val">{focal_row["z_share"]:.0f}<span class="unit">%</span></div>
          <div class="sub">{focal_row["z"]} cakes on Zomato</div>
        </div>
        <div class="cake-share-tile">
          <div class="lbl">Yesterday S share</div>
          <div class="val">{focal_row["s_share"]:.0f}<span class="unit">%</span></div>
          <div class="sub">{focal_row["s"]} cakes on Swiggy</div>
        </div>
        <div class="cake-share-tile">
          <div class="lbl">30-day avg Z share</div>
          <div class="val">{avg_z_share:.0f}<span class="unit">%</span></div>
          <div class="sub">{z_30d + s_30d:,} cakes total</div>
        </div>
      </div>
      <div class="cake-share-chart-wrap">
        <canvas id="cakeShareChart"></canvas>
      </div>
    </div>
    <script>
      window._cakeShareTrend = {{
        labels: {json.dumps(labels)},
        z_qty: {json.dumps(z_qty)},
        s_qty: {json.dumps(s_qty)},
        z_share: {json.dumps(z_share)},
        avg_z_share: {avg_z_share:.2f}
      }};
    </script>
    '''


# =====================================================================
# SECTION — Category cards with multi-range comparison
# =====================================================================

def category_section_v2(cat_block):
    """Category cards per category, showing focal + comparison + small trend."""
    all_data = cat_block["All"]
    focal = all_data["focal"]
    db = all_data["day_before"]
    lw = all_data["last_week"]
    a7 = all_data["avg_7d"]
    a30 = all_data["avg_30d"]

    cats = ["Cakes", "Desserts", "Cheesecakes", "Cookies"]
    cls_map = {"Cakes": "cat-cakes", "Desserts": "cat-desserts",
               "Cheesecakes": "cat-cheesecakes", "Cookies": "cat-cookies"}

    def _build_cards(period_data):
        f = period_data["focal"]
        db_p = period_data["day_before"]
        lw_p = period_data["last_week"]
        a7_p = period_data["avg_7d"]
        a30_p = period_data["avg_30d"]
        cards = []
        for c in cats:
            if c not in f: continue
            cd = f[c]
            qty = cd["qty"]
            rev = cd["rev"]
            q_share = cd["qty_share"]
            r_share = cd["rev_share"]
            # Multi-range comparison for qty
            def _trend(p, key):
                if not p or c not in p: return None
                return p[c][key]
            db_q = _trend(db_p, "qty")
            lw_q = _trend(lw_p, "qty")
            a7_q = _trend(a7_p, "qty")
            a30_q = _trend(a30_p, "qty")

            def _td(label, comp_v):
                if comp_v is None or comp_v == 0:
                    return f'<div class="item"><span class="lbl">{label}</span><span class="v">-</span></div>'
                d = (qty - comp_v) / comp_v * 100
                sign = "+" if d > 0 else ""
                cls = "up" if d > 5 else "down" if d < -5 else ""
                return f'<div class="item"><span class="lbl">{label}</span><span class="v {cls}">{sign}{d:.0f}%</span></div>'

            cards.append(f'''
            <div class="cat-card {cls_map[c]}">
              <div class="cat-name">{escape(c)}</div>
              <div class="cat-headline">{qty:.0f}<span class="unit">qty</span></div>
              <div class="cat-share">₹{rev/1000:.1f}K rev · <span class="v">{q_share:.1f}%</span> of qty, <span class="v">{r_share:.1f}%</span> of revenue</div>
              <div class="cat-trend">
                {_td("vs Day-1", db_q)}
                {_td("vs LW", lw_q)}
                {_td("vs 7d avg", a7_q)}
                {_td("vs 30d avg", a30_q)}
              </div>
            </div>''')
        return "".join(cards)

    return f'''
    <div class="tab-control">
      <button class="active" onclick="switchTab(event, 'cat', 'all')">Total</button>
      <button class="plat-z" onclick="switchTab(event, 'cat', 'zomato')">Zomato</button>
      <button class="plat-s" onclick="switchTab(event, 'cat', 'swiggy')">Swiggy</button>
    </div>
    <div id="cat-all" class="tab-content active">
      <div class="cat-grid">{_build_cards(cat_block["All"])}</div>
    </div>
    <div id="cat-zomato" class="tab-content">
      <div class="cat-grid">{_build_cards(cat_block["Zomato"])}</div>
    </div>
    <div id="cat-swiggy" class="tab-content">
      <div class="cat-grid">{_build_cards(cat_block["Swiggy"])}</div>
    </div>
    '''


# =====================================================================
# SECTION — SKU Concentration v2
# =====================================================================

def sku_concentration_section_v2(conc):
    """Top SKUs with multi-range change indicators."""
    rows = conc["rows"]
    conc_focal = conc["concentration_focal"]
    conc_lw = conc["concentration_lw"]

    delta_conc = conc_focal - conc_lw if conc_lw else None
    delta_conc_html = ""
    if delta_conc is not None:
        sign = "+" if delta_conc > 0 else ""
        cls = "up" if delta_conc > 0 else "down"
        delta_conc_html = f'<span class="micro-delta {cls}">{sign}{delta_conc:.1f}pp vs LW</span>'

    def _delta_chip(d):
        if d is None: return '<span class="chip na">-</span>'
        return chip(d)

    body = ""
    for r in rows:
        body += f'''
        <tr>
          <td>{escape(r["name"])}<br><span style="font-size:10px;color:var(--text-muted)">{escape(r["category"])}</span></td>
          <td class="focal-cell">{r["qty_focal"]:.0f}</td>
          <td>{r["qty_day_before"]:.0f}<br>{_delta_chip(r["delta_db_pct"])}</td>
          <td>{r["qty_last_week"]:.0f}<br>{_delta_chip(r["delta_lw_pct"])}</td>
          <td>{r["qty_avg_7d"]:.1f}<br>{_delta_chip(r["delta_7d_pct"])}</td>
          <td>{r["qty_avg_30d"]:.1f}<br>{_delta_chip(r["delta_30d_pct"])}</td>
        </tr>'''

    return f'''
    <div class="sku-conc-grid">
      <div class="conc-tile">
        <div class="conc-label">Top 10 share of qty</div>
        <div class="conc-value">{conc_focal:.1f}<span class="unit">%</span></div>
        <div class="conc-vs">vs Same DOW LW <span class="v">{conc_lw:.1f}% {delta_conc_html}</span></div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:14px;line-height:1.5">
          Of {conc["total_focal_qty"]:.0f} units sold yesterday, the top 10 SKUs accounted for {conc_focal:.0f}%.
          Higher concentration = more dependence on a narrow SKU base.
        </div>
      </div>
      <div class="table-card scroll">
        <table class="range-table">
          <thead>
            <tr>
              <th>Top SKU</th>
              <th>Yesterday<span class="dt-sub">qty</span></th>
              <th>Day Before<span class="dt-sub">qty + Δ%</span></th>
              <th>Same DOW LW<span class="dt-sub">qty + Δ%</span></th>
              <th>7-Day Avg<span class="dt-sub">qty + Δ%</span></th>
              <th>30-Day Avg<span class="dt-sub">qty + Δ%</span></th>
            </tr>
          </thead>
          <tbody>{body}</tbody>
        </table>
      </div>
    </div>
    '''
