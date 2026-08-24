#!/usr/bin/env python3
"""HTML renderers for the daily store/area/central mails.

Data comes exclusively from the spine functions dash_all / dash_store_detail /
dash_store_reasons (migration 150), the same functions the portal's /daily
module reads, so the mail and the portal can never disagree.

The pages are the approved sample templates: brand-neutral, interactive when
opened in a browser (Day / 7-day views, sortable columns, sparklines), and
honest about data limits (KPT excluded, last 3 days provisional).
"""
from __future__ import annotations
import html
import json

PORTAL = "https://creme-castle-erp.vercel.app"

CSS = """
  :root { color-scheme: light;
    --page:#FAF8F6; --surface:#FFFFFF; --ink:#2A1A1D; --ink-2:#6b5a5d; --muted:#7E6B6E;
    --grid:#EDE3E5; --baseline:#d8c9cc; --border:rgba(60,6,24,0.12);
    --maroon:#3C0618; --coral:#DB5436; --pink:#F4D4DA; --wash:#FFF5F7;
    --good-text:#2F5630; --critical:#B8401F; }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--page); color:var(--ink); font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
    font-size:15px; line-height:1.45; padding:24px 16px 48px; }
  .wrap { max-width:1080px; margin:0 auto; }
  .brand { font-size:13px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase; color:var(--maroon); }
  h1 { font-size:26px; font-weight:700; margin-top:2px; color:var(--maroon); }
  .sub { color:var(--ink-2); margin-top:2px; }
  .sub b { color:var(--ink); font-weight:600; }
  .revision-note { font-size:12.5px; color:var(--muted); margin-top:6px; }
  .views { display:inline-flex; border:1px solid var(--border); border-radius:8px; overflow:hidden; margin-top:12px; }
  .views button { font:inherit; font-size:13px; padding:6px 16px; border:0; background:var(--surface); color:var(--ink-2); cursor:pointer; }
  .views button.on { background:var(--maroon); color:#fff; font-weight:600; }
  body[data-view="y"] .only-wk { display:none !important; }
  body[data-view="wk"] .only-y { display:none !important; }
  .context { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:18px 0 22px; }
  .tile { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:12px 14px; }
  .tile .label { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; }
  .tile .value { font-size:24px; font-weight:700; margin-top:2px; }
  .tile .value small { font-size:13px; font-weight:400; color:var(--ink-2); }
  .tile .delta { font-size:12.5px; margin-top:2px; color:var(--ink-2); }
  .actions { background:var(--surface); border:1px solid var(--border); border-left:4px solid var(--coral);
    border-radius:12px; padding:14px 16px; margin-bottom:26px; }
  .actions h2 { font-size:14px; text-transform:uppercase; letter-spacing:0.06em; color:var(--ink-2); margin-bottom:8px; }
  .actions ol { padding-left:20px; }
  .actions li { margin-bottom:5px; }
  section { margin-bottom:26px; }
  .sec-head { display:flex; align-items:baseline; gap:10px; margin-bottom:10px; }
  .sec-head .num { font-size:13px; font-weight:700; color:var(--maroon); background:var(--pink); border-radius:6px; padding:2px 8px; }
  .sec-head h2 { font-size:18px; font-weight:700; color:var(--maroon); }
  .card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px 16px; }
  .row { display:flex; flex-wrap:wrap; gap:18px; align-items:flex-start; }
  .kpi { min-width:130px; }
  .kpi .label { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; }
  .kpi .value { font-size:22px; font-weight:700; margin-top:2px; }
  .kpi .value small { font-size:13px; font-weight:400; color:var(--ink-2); }
  .chip { display:inline-block; font-size:12.5px; font-weight:600; border-radius:999px; padding:2px 10px; margin-top:4px; }
  .chip.ok { color:var(--good-text); background:#E9F2E6; }
  .chip.watch { color:#872724; background:#FBEAE6; }
  .spark { margin-left:auto; text-align:right; }
  .spark .cap { font-size:11.5px; color:var(--muted); margin-top:2px; }
  svg text { font-family:system-ui,sans-serif; }
  .scroll-x { overflow-x:auto; }
  table { width:100%; border-collapse:collapse; margin-top:4px; font-size:13.5px; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; color:var(--muted);
    font-weight:600; padding:6px 7px; border-bottom:1px solid var(--baseline); white-space:nowrap; }
  table.sortable th { cursor:pointer; user-select:none; }
  table.sortable th:hover { color:var(--maroon); text-decoration:underline; }
  th .arrow { color:var(--coral); }
  td { padding:6px 7px; border-bottom:1px solid var(--grid); vertical-align:top; white-space:nowrap; }
  tr:last-child td { border-bottom:none; }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  td.store { font-weight:600; }
  .flag { color:var(--critical); font-weight:700; }
  .goodv { color:var(--good-text); font-weight:600; }
  .note { font-size:12.5px; color:var(--muted); margin-top:8px; white-space:normal; }
  .callout { margin-top:12px; padding:10px 12px; background:var(--wash); border-radius:8px; font-size:13.5px; }
  .hbar-block { margin-top:10px; max-width:560px; }
  .hbar { display:grid; grid-template-columns:190px 1fr 44px; align-items:center; gap:8px; margin-bottom:6px; }
  .hbar .name { font-size:13.5px; color:var(--ink-2); }
  .hbar .track { height:14px; position:relative; }
  .hbar .fill { position:absolute; left:0; top:0; bottom:0; background:var(--coral); border-radius:0 4px 4px 0; }
  .hbar .val { font-size:13px; text-align:right; font-variant-numeric:tabular-nums; }
  tr.me td { background:var(--wash); font-weight:600; }
  footer { margin-top:34px; border-top:1px solid var(--baseline); padding-top:14px; font-size:12.5px; color:var(--muted); }
"""

JS = """
  document.querySelectorAll('.views button').forEach(function(b){
    b.addEventListener('click', function(){
      document.body.dataset.view = b.dataset.view;
      document.querySelectorAll('.views button').forEach(function(x){ x.classList.toggle('on', x === b); });
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
  document.querySelectorAll('svg.sparkline').forEach(function(svg){
    var data, labels;
    try { data = JSON.parse(svg.dataset.points || '[]'); } catch (e) { return; }
    try { labels = JSON.parse(svg.dataset.labels || '[]'); } catch (e) { labels = []; }
    data = data.map(function(v){ return v === null ? null : Number(v); });
    var vals = data.filter(function(v){ return v !== null; });
    if (!vals.length) return;
    var W=252,H=56,padL=6,padR=52,padT=8,padB=14;
    var lo = svg.dataset.min !== '' && svg.dataset.min !== undefined ? Number(svg.dataset.min) : Math.min.apply(null, vals);
    var hi = svg.dataset.max !== '' && svg.dataset.max !== undefined ? Number(svg.dataset.max) : Math.max.apply(null, vals);
    if (hi === lo) hi = lo + 1;
    var suffix = svg.dataset.suffix || '';
    var n = data.length;
    var x = function(i){ return padL + i * (W-padL-padR) / Math.max(n-1,1); };
    var y = function(v){ return padT + (hi-v) * (H-padT-padB) / (hi-lo); };
    var ns='http://www.w3.org/2000/svg';
    var base=document.createElementNS(ns,'line');
    base.setAttribute('x1',padL); base.setAttribute('x2',W-padR);
    base.setAttribute('y1',H-padB); base.setAttribute('y2',H-padB);
    base.setAttribute('stroke','#d8c9cc'); base.setAttribute('stroke-width','1');
    svg.appendChild(base);
    var pts=[]; data.forEach(function(v,i){ if(v!==null) pts.push(x(i)+','+y(v)); });
    var line=document.createElementNS(ns,'polyline');
    line.setAttribute('points',pts.join(' ')); line.setAttribute('fill','none');
    line.setAttribute('stroke','#DB5436'); line.setAttribute('stroke-width','2');
    line.setAttribute('stroke-linejoin','round'); line.setAttribute('stroke-linecap','round');
    svg.appendChild(line);
    var li=-1; for (var i=n-1;i>=0;i--){ if(data[i]!==null){ li=i; break; } }
    if (li>=0){
      var last=data[li];
      var dot=document.createElementNS(ns,'circle');
      dot.setAttribute('cx',x(li)); dot.setAttribute('cy',y(last)); dot.setAttribute('r','4');
      dot.setAttribute('fill','#DB5436'); dot.setAttribute('stroke','#fff'); dot.setAttribute('stroke-width','2');
      svg.appendChild(dot);
      var lbl=document.createElementNS(ns,'text');
      lbl.setAttribute('x',x(li)+7); lbl.setAttribute('y',y(last)+4);
      lbl.setAttribute('font-size','11.5'); lbl.setAttribute('fill','#2A1A1D'); lbl.setAttribute('font-weight','600');
      lbl.textContent = (Math.round(last*100)/100) + suffix;
      svg.appendChild(lbl);
    }
    data.forEach(function(v,i){
      if (v===null) return;
      var c=document.createElementNS(ns,'circle');
      c.setAttribute('cx',x(i)); c.setAttribute('cy',y(v)); c.setAttribute('r','8');
      c.setAttribute('fill','transparent');
      var t=document.createElementNS(ns,'title');
      t.textContent=(labels[i]?labels[i]+': ':'')+v+suffix;
      c.appendChild(t);
      svg.appendChild(c);
    });
  });
"""

esc = html.escape


def money(v):
    if v is None:
        return "-"
    return "₹{:,}".format(int(round(v)))


def n0(v):
    return "-" if v is None else "{:,}".format(int(round(v)))


def n1(v):
    return "-" if v is None else "{:.1f}".format(float(v))


def flag(v, bad):
    return f'<span class="flag">{v} &#9650;</span>' if bad else str(v)


def page(title, body):
    return (
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        f"<title>{esc(title)}</title>\n<style>{CSS}</style>\n</head>\n"
        "<body data-view=\"y\">\n<div class=\"wrap\">\n" + body +
        f"\n</div>\n<script>{JS}</script>\n</body>\n</html>\n"
    )


def views_html():
    return ('<div class="views"><button class="on" data-view="y">Day</button>'
            '<button data-view="wk">Last 7 days</button></div>')


def tile(label, y_html, wk_html):
    return (f'<div class="tile"><div class="label">{label}</div>'
            f'<span class="only-y">{y_html}</span><span class="only-wk">{wk_html}</span></div>')


def spark(points, labels, caption, lo=None, hi=None, suffix=""):
    return (f'<div class="spark"><svg class="sparkline" width="252" height="56" '
            f"data-points='{json.dumps(points)}' data-labels='{json.dumps(labels)}' "
            f'data-min="{"" if lo is None else lo}" data-max="{"" if hi is None else hi}" '
            f'data-suffix="{suffix}"></svg><div class="cap">{esc(caption)}</div></div>')


def hbar(rows):
    rows = [r for r in rows if r[1]]
    if not rows:
        return ""
    mx = max(v for _, v in rows)
    out = ['<div class="hbar-block">']
    for name, v in sorted(rows, key=lambda r: -r[1]):
        out.append(f'<div class="hbar"><div class="name">{esc(name)}</div>'
                   f'<div class="track"><div class="fill" style="width:{round(100*v/mx)}%"></div></div>'
                   f'<div class="val">{v}</div></div>')
    out.append("</div>")
    return "".join(out)


def sec(num, title, inner):
    return (f'<section><div class="sec-head"><span class="num">{num}</span><h2>{esc(title)}</h2></div>'
            f'<div class="card">{inner}</div></section>')


def receipts_table(rows, cols, note=None):
    """cols: list of (key, label, formatter or None)."""
    if not rows:
        return '<p class="note">Nothing to list.</p>'
    out = ['<div class="scroll-x"><table class="sortable"><thead><tr>']
    out += [f"<th>{esc(label)}</th>" for _, label, _ in cols]
    out.append("</tr></thead><tbody>")
    for r in rows:
        out.append("<tr>")
        for key, _, fmt in cols:
            v = r.get(key)
            out.append(f"<td>{esc(str(fmt(v) if fmt else (v if v is not None else '-')))}</td>")
        out.append("</tr>")
    out.append("</tbody></table></div>")
    if note:
        out.append(f'<p class="note">{esc(note)}</p>')
    return "".join(out)


def vs_avg(day):
    o, a = day.get("orders"), day.get("avgord")
    if o is None or not a:
        return "-"
    d = round(100.0 * (o - a) / a)
    txt = ("+" if d >= 0 else "") + str(d) + "%"
    if d >= 10:
        return f'<span class="goodv">{txt}</span>'
    if d <= -15:
        return f'<span class="flag">{txt} &#9650;</span>'
    return txt


def league_tables(stores, highlight=None):
    head = ('<thead><tr><th class="num">#</th><th>Store</th><th>Locality</th><th>AM</th>'
            '<th class="num">Orders</th><th class="num">vs avg</th><th class="num">Online %</th>'
            '<th class="num">Rejections</th><th class="num">Complaints</th><th class="num">Rating</th>'
            '<th class="num">Rider wait</th><th class="num">False-ready wk</th><th class="num">Money lost wk</th></tr></thead>')

    def row(s, view):
        d, w = s["day"], s["wk"]
        me = ' class="me"' if s["code"] == highlight else ""
        if view == "y":
            rating = "-" if not d.get("rating") else n1(d["rating"])
            cells = [
                str(s.get("dayRank") or "-"), f'<span class="store">{esc(s["code"])}</span>',
                esc(s.get("locality") or ""), esc(s.get("am") or ""),
                n0(d.get("orders")), vs_avg(d),
                flag(n1(d["online"]), d["online"] < 99) if d.get("online") is not None else "-",
                flag(n0(d.get("srej")), (d.get("srej") or 0) >= 2),
                flag(n0(d.get("comps")), (d.get("comps") or 0) >= 3),
                flag(rating, bool(d.get("rating")) and d["rating"] <= 2),
                (flag(n1(d["wait"]) + " min", d["wait"] >= 3) if d.get("wait") is not None else "-"),
                flag(n0(w.get("fr")), (w.get("fr") or 0) >= 40),
                money((w.get("stockout") or 0) + (w.get("refunds") or 0)),
            ]
        else:
            cells = [
                str(s.get("wkRank") or "-"), f'<span class="store">{esc(s["code"])}</span>',
                esc(s.get("locality") or ""), esc(s.get("am") or ""),
                n0(w.get("orders")),
                (n0(round((w.get("orders") or 0) / 7)) + "/day") if w.get("orders") else "-",
                flag(n1(w["online"]), w["online"] < 99) if w.get("online") is not None else "-",
                flag(n0(w.get("srej")), (w.get("srej") or 0) >= 4),
                flag(n0(w.get("comps")), (w.get("comps") or 0) >= 20),
                n1(w.get("rating")) if w.get("rating") else "-",
                (flag(n1(w["wait"]) + " min", w["wait"] >= 2.2) if w.get("wait") is not None else "-"),
                flag(n0(w.get("fr")), (w.get("fr") or 0) >= 40),
                money((w.get("stockout") or 0) + (w.get("refunds") or 0)),
            ]
        return f"<tr{me}>" + "".join(f'<td class="num">{c}</td>' if i not in (1, 2, 3) else f"<td>{c}</td>"
                                     for i, c in enumerate(cells)) + "</tr>"

    day_rows = sorted(stores, key=lambda s: s.get("dayRank") or 99)
    wk_rows = sorted(stores, key=lambda s: s.get("wkRank") or 99)
    return (
        f'<div class="scroll-x only-y"><table class="sortable">{head}<tbody>'
        + "".join(row(s, "y") for s in day_rows) + "</tbody></table></div>"
        f'<div class="scroll-x only-wk"><table class="sortable">{head}<tbody>'
        + "".join(row(s, "wk") for s in wk_rows) + "</tbody></table></div>"
        '<p class="note">Ranked by clean-day score: complaints % + rejections % + offline penalty, lower is better. '
        "Click any column to re-sort. Rider wait and false-ready exist from August 2026 onward.</p>"
    )


def areas_tables(areas):
    head = ('<thead><tr><th class="num">#</th><th>Area manager</th><th class="num">Stores</th>'
            '<th class="num">Orders</th><th class="num">Complaints %</th><th class="num">Store rejections</th>'
            '<th class="num">Offline</th><th class="num">False-ready wk</th><th class="num">Money lost wk</th></tr></thead>')

    def rows(view):
        lst = sorted(areas, key=lambda a: a[view]["cpct"] if a[view]["cpct"] is not None else 99)
        out = []
        for i, a in enumerate(lst):
            v = a[view]
            out.append(
                f'<tr><td class="num">{i+1}</td><td class="store">{esc(a["am"])}</td>'
                f'<td class="num">{a["stores"]}</td><td class="num">{n0(v["orders"])}</td>'
                f'<td class="num">{"-" if v["cpct"] is None else "{:.2f}".format(v["cpct"])}</td>'
                f'<td class="num">{n0(v["srej"])}</td><td class="num">{n0(v["offmin"])} min</td>'
                f'<td class="num">{n0(a["wk"]["fr"])}</td>'
                f'<td class="num">{money(a["wk"]["stockout"] + a["wk"]["refunds"])}</td></tr>')
        return "".join(out)

    return (f'<div class="scroll-x only-y"><table class="sortable">{head}<tbody>{rows("day")}</tbody></table></div>'
            f'<div class="scroll-x only-wk"><table class="sortable">{head}<tbody>{rows("wk")}</tbody></table></div>'
            '<p class="note">Ranked by complaint rate for the period shown. Money lost = stockout rejections + refunds, 7 days.</p>')


def masthead(brand, title, subtitle, date_label):
    return (f'<div class="brand">{esc(brand)}</div><h1>{esc(title)}</h1>'
            f'<div class="sub"><b>{esc(date_label)}</b> &nbsp;·&nbsp; {esc(subtitle)}</div>'
            '<div class="revision-note">Zomato may revise the last 3 days of figures slightly. '
            'Open this file in a browser for sorting and the Day / 7-day switch.</div>'
            + views_html())


def footer_html():
    return (f'<footer><p>Every number comes from Creme Castle\'s own database and is reproducible. '
            f'Kitchen preparation time is excluded permanently (verified: it measures tablet button-pressing, '
            f'not kitchen work); rider wait is the verified speed measure. '
            f'Live version, any date, at <a href="{PORTAL}/daily">{PORTAL}/daily</a> (use your portal login).</p></footer>')
