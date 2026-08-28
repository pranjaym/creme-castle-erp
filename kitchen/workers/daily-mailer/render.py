#!/usr/bin/env python3
"""HTML renderers for the daily store / area / central mails.

These build the SAME three pages the portal serves, from the same spine
functions, so the 07:30 mail and the site can never look or read differently:

    store   dash_all + dash_store_detail + dash_store_reasons   (150, 170)
    area    dash_all + dash_area_detail                         (180, 192)
    central dash_all + dash_central_detail                      (190, 192)

The mails carry each page as an HTML ATTACHMENT, which the reader opens in a
browser, so there is no email-client CSS to design around: this is the portal's
own stylesheet and the portal's own markup.

The seven locked design rules (settled with Pranjay over the review rounds of
25 and 26 August 2026) are implemented HERE as well as in the portal, and the
two must be changed together:

  1. No hidden day/week toggle. Each section shows a labelled day block, then a
     labelled "Last 7 days" block.
  2. No number without the orders behind it, and every receipt names its outlet.
     On the central page it names the area manager too.
  3. Week lists exclude the day already listed above; week totals still cover 7
     days and say so. Times show clock only, and the day label comes from the
     BUSINESS date, so a post-midnight order stays on the day it belongs to.
  4. Charts carry real axes: short labels along the bottom, the full date on
     hover, value ticks with gridlines. They are server-rendered SVG, so they
     draw even with scripting off.
  5. Every KPI carries a verdict and its goal, never a bare number.
  6. Compact: single-line rows, item baskets capped with the full text on hover,
     12.5px table type, long lists folded behind one tap.
  7. Complaint filters are built from the tags the ORDER rows carry, never from
     Zomato's daily-report words. Mixing the two made filters return nothing.
"""
from __future__ import annotations
import html
from datetime import datetime

PORTAL = "https://creme-castle-erp.vercel.app"

# The portal's dashboard stylesheet, trimmed to what a standalone page needs.
CSS = """
:root{--page:#FAF8F6;--card:#FFF;--ink:#2A1A1D;--muted:#7E6B6E;--line:#EDE3E5;--maroon:#3C0618;
 --coral:#DB5436;--pink:#F4D4DA;--wash:#FFF5F7;--ok-bg:#E9F2E6;--ok-fg:#2F5630;--warn-bg:#FBEAE6;--warn-fg:#872724}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--page);color:var(--ink);font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
 font-size:14px;line-height:1.4;padding:16px 12px 30px}
.wrap{max-width:1060px;margin:0 auto}
.brand{font-size:12.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--maroon)}
h1{font-size:22px;color:var(--maroon);margin-top:2px}
.sub{color:var(--muted);margin-top:2px}.sub b{color:var(--ink)}
.revision-note{font-size:12px;color:var(--muted);margin-top:4px;max-width:760px}
.context{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:8px;margin:12px 0 14px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 11px}
.tile .label{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.tile .value{font-size:20px;font-weight:700;margin-top:2px}
.tile .value small{font-size:12.5px;font-weight:400;color:var(--muted)}
.tile .delta{font-size:12px;margin-top:2px;color:var(--muted);min-height:2.4em}
.actions{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--coral);
 border-radius:11px;padding:11px 13px;margin-bottom:14px}
.actions h2{font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:7px}
.actions ol{padding-left:19px}.actions li{margin-bottom:3px;font-size:13.5px}
section{margin-bottom:11px}
.sec-head{display:flex;align-items:baseline;gap:8px;margin-bottom:5px}
.sec-head .num{font-size:12.5px;font-weight:700;color:var(--maroon);background:var(--pink);border-radius:6px;padding:2px 8px}
.sec-head h2{font-size:16px;color:var(--maroon)}
.lead{font-size:13px;color:var(--muted);margin:0 0 6px;max-width:820px}
.card{background:var(--card);border:1px solid var(--line);border-radius:11px;padding:2px 12px 7px}
.pblock{padding:7px 0 2px}
.pblock + .pblock{border-top:1px dashed var(--line)}
.ptitle{display:table;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
 color:var(--maroon);background:var(--wash);border-radius:6px;padding:2px 8px;margin-bottom:4px}
.tlabel{font-size:12.5px;font-weight:600;color:var(--ink);margin:8px 0 2px}
.krow{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;margin:2px 0 4px}
.kpi{min-width:140px}
.kpi .label{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.kpi .value{font-size:19px;font-weight:700;margin-top:1px}
.kpi .value small{font-size:12.5px;font-weight:400;color:var(--muted)}
.kpi .delta{font-size:12px;color:var(--muted)}
.chip{display:inline-block;font-size:12px;font-weight:600;border-radius:999px;padding:1px 9px;margin-top:4px}
.chip.okc{color:var(--ok-fg);background:var(--ok-bg)}
.chip.watch{color:var(--warn-fg);background:var(--warn-bg)}
.scroll-x{overflow-x:auto}
table{width:100%;border-collapse:collapse;margin-top:2px;font-size:12.5px}
th{text-align:left;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em;color:var(--muted);
 font-weight:600;padding:4px 7px;border-bottom:1.5px solid #d8c9cc;white-space:nowrap}
table.sortable th{cursor:pointer;user-select:none}
table.sortable th:hover{color:var(--maroon)}
th .arrow{color:var(--coral)}
td{padding:3px 7px;border-bottom:1px solid var(--line);vertical-align:top;white-space:nowrap}
tbody tr:nth-child(even){background:#FDFBFA}
tbody tr:hover{background:var(--wash)}
tr:last-child td{border-bottom:none}
th:not(:nth-child(1)):not(:nth-child(2)),td:not(:nth-child(1)):not(:nth-child(2))
 {text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
th:nth-child(1),td:nth-child(1){white-space:nowrap;font-weight:600}
td a{color:var(--maroon);font-weight:600;text-decoration:none}
.flag{color:#B8401F;font-weight:700}.goodv{color:var(--ok-fg);font-weight:600}
.rchip{display:inline-block;font-size:11px;font-weight:600;border-radius:5px;padding:0 6px;white-space:nowrap;text-align:left}
.r-packing{background:#FBEAE6;color:#872724}.r-taste{background:#FDF3D7;color:#7A5A12}
.r-missing{background:#EAF0FA;color:#2C4E82}.r-wrong{background:#F2E8FA;color:#5E3B82}
.r-stock{background:#EDEAF6;color:#4A3E7A}.r-other{background:#F0EDEB;color:#6b5a5d}
td:has(.rchip){text-align:left}
.rfilters{display:flex;flex-wrap:wrap;gap:5px;margin:2px 0 7px}
.rfilter{font:inherit;font-size:12px;border:1.5px solid var(--line);background:var(--card);
 border-radius:999px;padding:2px 11px;cursor:pointer}
.rfilter.on{border-color:var(--maroon);background:var(--maroon);color:#fff}
details.fold{margin-top:6px}
details.fold summary{cursor:pointer;font-size:12px;font-weight:600;color:var(--maroon);
 background:var(--wash);border-radius:7px;padding:5px 10px;list-style:none}
details.fold summary::-webkit-details-marker{display:none}
.minigrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:10px}
.minigrid.funnel3{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.minicard{border:1px solid var(--line);border-radius:9px;padding:8px 10px}
.mtitle{font-weight:700;font-size:14px}.mtitle small{font-weight:400;color:var(--muted)}
.mval{font-size:18px;font-weight:700;margin-top:2px}
.mval small{font-size:12px;font-weight:400;color:var(--muted)}
.mnote{font-size:12px;color:var(--muted);margin-bottom:4px}
.chartgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px}
.chart{display:inline-block;margin-top:4px;max-width:100%}.chart svg{max-width:100%;height:auto}
.charttitle{font-size:11.5px;color:var(--muted);margin-bottom:1px}
.hbar-block{margin-top:6px;max-width:560px}
.hbar{display:flex;align-items:center;gap:8px;margin-bottom:3px;font-size:12.5px}
.hbar .name{width:200px;flex:none;color:var(--muted)}
.hbar .track{flex:1;background:var(--line);border-radius:4px;height:9px;overflow:hidden}
.hbar .fill{background:var(--coral);height:100%}
.hbar .val{width:44px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.note{font-size:11.5px;color:var(--muted);margin-top:5px;white-space:normal}
footer{margin-top:18px;border-top:1px solid var(--line);padding-top:9px;font-size:11.5px;color:var(--muted)}
footer p{margin-bottom:6px;max-width:800px}
footer a{color:var(--maroon)}
@media (max-width:700px){body{padding:12px 8px 24px}h1{font-size:19px}.hbar .name{width:120px}}
"""

# Only two behaviours need script: click-to-sort, and the complaint tag filters.
# The charts are server-rendered SVG on purpose, so the page is complete with
# scripting off (some readers open the attachment in a viewer that blocks it).
JS = """
document.querySelectorAll('.rfilter').forEach(function(b){
  b.addEventListener('click', function(){
    var target = b.dataset.target;
    document.querySelectorAll('.rfilter[data-target="'+target+'"]').forEach(function(x){
      x.classList.toggle('on', x === b); });
    var want = b.dataset.reason;
    document.querySelectorAll('#'+target+' tbody tr').forEach(function(tr){
      tr.style.display = (!want || tr.dataset.reason === want) ? '' : 'none'; });
  });
});
function cellKey(td){
  var t = td.textContent.trim();
  var n = parseFloat(t.replace(/[\\u20B9,%]/g,'').replace(/,/g,''));
  return isNaN(n) ? null : n;
}
document.querySelectorAll('table.sortable').forEach(function(table){
  var ths = table.querySelectorAll('thead th');
  ths.forEach(function(th, ci){
    th.addEventListener('click', function(){
      var tbody = table.tBodies[0];
      var rows = Array.prototype.slice.call(tbody.rows);
      var dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
      ths.forEach(function(h){ delete h.dataset.dir; var a = h.querySelector('.arrow'); if (a) a.remove(); });
      th.dataset.dir = dir;
      var arrow = document.createElement('span'); arrow.className = 'arrow';
      arrow.textContent = dir === 'asc' ? ' \\u25B2' : ' \\u25BC';
      th.appendChild(arrow);
      rows.sort(function(a, b){
        var x = cellKey(a.cells[ci]), y = cellKey(b.cells[ci]);
        if (x === null && y === null) {
          var xs = a.cells[ci].textContent.trim().toLowerCase(), ys = b.cells[ci].textContent.trim().toLowerCase();
          return dir === 'asc' ? xs.localeCompare(ys) : ys.localeCompare(xs);
        }
        if (x === null) return 1;
        if (y === null) return -1;
        return dir === 'asc' ? x - y : y - x;
      });
      rows.forEach(function(r){ tbody.appendChild(r); });
    });
  });
});
"""

esc = html.escape


# ---------- numbers. Indian grouping, because the portal uses en-IN and a
# mail that says 1,234,567 next to a page that says 12,34,567 is two products.
def _grp(n: int) -> str:
    s = str(abs(int(n)))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return ("-" if n < 0 else "") + s


def money(v):
    return "-" if v is None else "&#8377;" + _grp(round(float(v)))


def n0(v):
    return "-" if v is None else _grp(round(float(v)))


def n1(v):
    return "-" if v is None else "{:.1f}".format(float(v))


def n2(v):
    return "-" if v is None else "{:.2f}".format(float(v))


def lakh(v):
    return "-" if v is None else "&#8377;{:.2f}L".format(float(v) / 100000.0)


def flag(v, bad):
    return f'<span class="flag">{v}</span>' if bad else str(v)


def goodv(v):
    return f'<span class="goodv">{v}</span>'


def pct(v, dp=1):
    """A null percentage prints a dash, never the word null with a % after it."""
    return "-" if v is None else ("{:." + str(dp) + "f}%").format(float(v))


# ---------- page furniture
def page(title, body):
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{esc(title)}</title>\n<style>{CSS}</style>\n</head>\n"
        '<body>\n<div class="wrap">\n' + body +
        f"\n</div>\n<script>{JS}</script>\n</body>\n</html>\n"
    )


def masthead(brand, title, subtitle, date_label, note):
    """brand, title, subtitle and note are HTML: they carry entities on purpose,
    so the CALLER escapes anything that came from data. Escaping here turned
    every &middot; in the brand line into visible text."""
    return (f'<div class="brand">{brand}</div><h1>{title}</h1>'
            f'<div class="sub"><b>{esc(date_label)}</b> &nbsp;&middot;&nbsp; {subtitle}</div>'
            f'<div class="revision-note">{note}</div>')


def tile(label, value, delta="", chip_html=""):
    return (f'<div class="tile"><div class="label">{esc(label)}</div>'
            f'<div class="value">{value}</div><div class="delta">{delta}</div>{chip_html}</div>')


def verdict(ok, text):
    mark = "&#10003; " if ok else "&#9650; "
    return f'<span class="chip {"okc" if ok else "watch"}">{mark}{text}</span>'


def vtile(label, value, delta, ok, text):
    return tile(label, value, delta, verdict(ok, text))


def kpi(label, value, delta="", chip_html=""):
    return (f'<div class="kpi"><div class="label">{esc(label)}</div><div class="value">{value}</div>'
            + (f'<div class="delta">{delta}</div>' if delta else "") + chip_html + "</div>")


def krow(*kpis):
    return '<div class="krow">' + "".join(kpis) + "</div>"


def context(*tiles):
    return '<div class="context">' + "".join(tiles) + "</div>"


def actions(heading, items):
    if not items:
        return ""
    return (f'<div class="actions"><h2>{esc(heading)}</h2><ol>'
            + "".join(f"<li>{i}</li>" for i in items) + "</ol></div>")


def sec(num, title, inner, lead=None):
    head = (f'<section><div class="sec-head"><span class="num">{num}</span><h2>{title}</h2></div>')
    if lead:
        head += f'<p class="lead">{lead}</p>'
    return head + f'<div class="card">{inner}</div></section>'


def period(label, inner):
    """The label is escaped, because it often carries a store name or a date.
    Write a curly apostrophe as the character, never as an entity."""
    return f'<div class="pblock"><div class="ptitle">{esc(label)}</div>{inner}</div>'


def tlabel(text):
    return f'<div class="tlabel">{text}</div>'


def fold(label, count, inner, open_=False):
    if not count:
        return '<p class="note">None.</p>'
    op = " open" if open_ else ""
    return (f'<details class="fold"{op}><summary>{label} ({count}) &rsaquo; tap to '
            f'{"close" if open_ else "open"}</summary>{inner}</details>')


def note(text):
    return f'<p class="note">{text}</p>'


def rows(cols, body_rows, empty="Nothing to list.", table_id=None, sortable=False, row_attrs=None):
    """body_rows is a list of lists of already-escaped cell HTML."""
    if not body_rows:
        return note(esc(empty))
    cls = ' class="sortable"' if sortable else ""
    tid = f' id="{table_id}"' if table_id else ""
    out = [f'<div class="scroll-x"><table{tid}{cls}><thead><tr>']
    out += [f"<th>{c}</th>" for c in cols]
    out.append("</tr></thead><tbody>")
    for i, r in enumerate(body_rows):
        attr = (row_attrs[i] if row_attrs else "")
        out.append(f"<tr{attr}>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>")
    out.append("</tbody></table></div>")
    return "".join(out)


def tag(reason):
    """Complaint or rejection reason chip, coloured by family. The text comes
    from the ORDER row, never from Zomato's daily report: rule 7."""
    r = (reason or "").lower()
    cls = ("packing" if ("packag" in r or "spill" in r)
           else "taste" if ("taste" in r or "quality" in r)
           else "missing" if "missing" in r
           else "wrong" if "wrong" in r
           else "stock" if "stock" in r
           else "other")
    return f'<span class="rchip r-{cls}">{esc(reason or "")}</span>'


def basket(text, n=52):
    """Long item lists were what made every table three lines tall. Cap them and
    put the full text on hover: the row stays one line and nothing is lost."""
    t = text or "-"
    if len(t) <= n:
        return esc(t)
    return f'<span title="{esc(t)}">{esc(t[:n - 1])}&hellip;</span>'


def store_link(code, date, label=None):
    return (f'<a href="{PORTAL}/daily/store/{esc(code)}?date={date}">{esc(label or code)}</a>')


def area_link(am, date, label=None):
    return (f'<a href="{PORTAL}/daily/area/{esc(am)}?date={date}">{esc(label or am)}</a>')


# ---------- a chart with real axes (rule 4). Server-rendered, no script.
def chart(series, labels, title, unit="", lo=None, hi=None, tips=None,
          width=430, height=124, dec=1):
    vals = [v for v in series if v is not None]
    if not vals:
        return note("No data for these days.")
    LO = min(vals) if lo is None else lo
    HI = max(vals) if hi is None else hi
    if HI == LO:
        HI = LO + 1
    L, R, T, B = 52, 14, 10, 22
    n = len(series)
    X = lambda i: L + i * (width - L - R) / max(n - 1, 1)
    Y = lambda v: T + (HI - v) * (height - T - B) / (HI - LO)

    def fmt(v):
        body = ("{:.0f}".format(round(v)) if abs(HI - LO) >= 5
                else ("{:." + str(dec) + "f}").format(v))
        return body + unit

    out = [f'<div class="chart"><div class="charttitle">{esc(title)}</div>',
           f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
           f'role="img" aria-label="{esc(title)}">']
    for tv in (LO, (LO + HI) / 2.0, HI):
        out.append(f'<line x1="{L}" y1="{Y(tv):.1f}" x2="{width - R}" y2="{Y(tv):.1f}" stroke="#EDE3E5"/>')
        out.append(f'<text x="{L - 5}" y="{Y(tv) + 3.5:.1f}" font-size="10" fill="#7E6B6E" '
                   f'text-anchor="end">{fmt(tv)}</text>')
    for i, la in enumerate(labels):
        anchor = "start" if i == 0 else ("end" if i == n - 1 else "middle")
        out.append(f'<text x="{X(i):.1f}" y="{height - 6}" font-size="10" fill="#7E6B6E" '
                   f'text-anchor="{anchor}">{esc(str(la))}</text>')
    pts = " ".join(f"{X(i):.1f},{Y(v):.1f}" for i, v in enumerate(series) if v is not None)
    out.append(f'<polyline points="{pts}" fill="none" stroke="#DB5436" stroke-width="2" stroke-linejoin="round"/>')
    for i, v in enumerate(series):
        if v is None:
            continue
        tip = (tips or labels)[i]
        out.append(f'<circle cx="{X(i):.1f}" cy="{Y(v):.1f}" r="2.8" fill="#DB5436">'
                   f"<title>{esc(str(tip))}: {fmt(v)}</title></circle>")
    out.append("</svg></div>")
    return "".join(out)


def hbar(bars):
    bars = [(k, v) for k, v in bars if v]
    if not bars:
        return ""
    mx = max(v for _, v in bars)
    out = ['<div class="hbar-block">']
    for name, v in sorted(bars, key=lambda r: -r[1]):
        out.append(f'<div class="hbar"><div class="name">{esc(name)}</div>'
                   f'<div class="track"><div class="fill" style="width:{round(100 * v / mx)}%"></div></div>'
                   f'<div class="val">{n0(v)}</div></div>')
    out.append("</div>")
    return "".join(out)


# ---------- the shut-shop tracker (migration 192), shared by the area and
# central pages exactly as the portal shares one component between them.
def shut_shop(block, dshort, wk_label, show_am, date):
    orders = block.get("shut_orders") or []
    stores = block.get("shut_stores") or []
    hours = block.get("shut_hours") or []
    if not orders:
        return period(wk_label, note("No order was turned away for a shut shop in these 7 days. "
                                     "This is the section that should stay empty."))
    total = sum((r.get("value") or 0) for r in orders)
    today = [r for r in orders if r.get("today")]
    listed_open = len([r for r in orders if (r.get("online_day") or 0) >= 99])
    peak = max(hours, key=lambda h: h["orders"]) if hours else None
    worst = stores[0] if stores else None

    def online_cell(r):
        o = r.get("online_day")
        if o is None:
            return "-"
        if o >= 99.9:
            return f'<span class="flag">{n2(o)}%, never off</span>'
        return f"{n2(o)}%, {n0(r.get('offmin_day'))} min off"

    cols = (["Store", "AM", "Day", "Time", "Reason", "What the customer wanted", "Value", "Store online, whole day"]
            if show_am else
            ["Store", "Day", "Time", "Reason", "What the customer wanted", "Value", "Store online, whole day"])
    body = []
    for r in orders:
        cells = [store_link(r["code"], date)]
        if show_am:
            cells.append(esc(r.get("am") or ""))
        cells += [esc(r.get("dlabel") or ""), esc(r.get("time") or ""), tag(r.get("reason")),
                  basket(r.get("basket")), money(r.get("value")), online_cell(r)]
        body.append(cells)

    head_line = (f'<b>{len(orders)} orders, {money(total)}</b>, {len(today)} of them on {esc(dshort)}. '
                 + ("Every one came to a store that was listed open all day. "
                    if listed_open == len(orders)
                    else f"{listed_open} of the {len(orders)} came to a store listed open all day. ")
                 + (f"The busiest hour for it is {peak['hour']}:00, with {peak['orders']} of them."
                    if peak else ""))

    scols = (["Store", "AM", "Orders turned away", "Value", "On how many days"] if show_am
             else ["Store", "Orders turned away", "Value", "On how many days"])
    sbody = []
    for s in stores:
        cells = [store_link(s["code"], date)]
        if show_am:
            cells.append(esc(s.get("am") or ""))
        cells += [f'<span class="flag">{n0(s["orders"])}</span>', money(s["value"]),
                  (f'<span class="flag">{s["days"]} days</span>' if s["days"] > 1 else f'{s["days"]} day')]
        sbody.append(cells)

    hbody = [[f'{h["hour"]}:00 to {h["hour"]}:59',
              (f'<span class="flag">{n0(h["orders"])}</span>' if h["orders"] >= 3 else n0(h["orders"])),
              money(h["value"])] for h in hours]

    out = period(f"{wk_label}, every one of them",
                 f'<p class="note" style="margin-top:0">{head_line}</p>'
                 + rows(cols, body)
                 + note("The last column is the store&rsquo;s online percentage for that whole day, from "
                        "Zomato&rsquo;s own report. It is here as proof: Zomato only sends an order to a store "
                        "whose listing it believes is open, so a store showing 100% online has been telling "
                        "customers it is trading. The shop being shut, or nobody being at the tablet, is the "
                        "thing to ask about."))
    out += period("Which outlets, worst first",
                  rows(scols, sbody)
                  + (note(f"<b>{esc(worst['code'])}</b> did it on {worst['days']} separate days, which makes it "
                          "a routine, not an accident. Start there.")
                     if worst and worst["days"] > 1 else ""))
    out += period("At what time of day",
                  rows(["Hour", "Orders turned away", "Value"], hbody)
                  + note("The clock is usually the answer, and the answer is mostly the closing hour: our stores "
                         "shut at 2am and Zomato keeps routing orders up to and past it. That is a listing-hours "
                         "question to take to Zomato, not store indiscipline. Orders inside trading hours are the "
                         "ones to ask the store about."))
    return out


# ---------- shared labels
def date_label(iso):
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%A, %-d %B %Y")


def short_label(iso):
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%-d %b")


def week_label(week_start, date):
    return f"Last 7 days ({short_label(week_start)} to {short_label(date)})"


def settled_note():
    return ("Settled data only: this covers the newest fully settled day, 2 days back, because Zomato keeps "
            "revising fresher days. Each section shows that day first, then the 7 days ending on it.")


def footer_html(extra=""):
    return ('<footer>'
            f'<p>{extra}</p>'
            "<p>Every number comes from Creme Castle&rsquo;s own database and is reproducible by query. Kitchen "
            "preparation time is excluded permanently (verified 23 Aug 2026: it measures tablet button-pressing, "
            "not kitchen work). Rider wait is the verified speed measure, identical across two independent Zomato "
            "feeds. Nothing here is an estimate and no number is produced by AI.</p>"
            "<p>Ratings and complaint counts on a day keep moving for several days after it; online time and "
            "rejections do not. Hover any shortened item list to read it in full.</p>"
            "<p>Item lists come from Zomato&rsquo;s item export, and fall back to the evening order feed "
            "when that export is missing, so a rejection or a complaint always names what the customer "
            "wanted.</p>"
            "<p><b>Reading this next to Petpooja?</b> Three things differ by design, and none of them is an "
            "error. This page is <b>Zomato only</b>, so Petpooja will show roughly twice the orders once Swiggy "
            "and walk-in are included: compare against Petpooja&rsquo;s Zomato channel alone. Zomato files an "
            "order under the CALENDAR day it was placed while Petpooja files it under the trading night, so "
            "orders between midnight and 2am sit on different days in the two systems. And rank 1 means the "
            "best-RUN store of the day (fewest complaints, fewest rejections, fully online), never the "
            "busiest.</p>"
            f'<p>Live version, any date, at <a href="{PORTAL}/daily">{PORTAL}/daily</a> '
            "(use your portal login). This file is the same page.</p></footer>")
