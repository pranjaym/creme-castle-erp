#!/usr/bin/env python3
"""Static email digest + PDF. No JavaScript, inline styles, table layout:
survives Gmail and Outlook, prints cleanly, readable on a phone."""
import html, pathlib
from collections import defaultdict
from datetime import date, timedelta

INK="#2B241D"; MUT="#7A6E60"; LINE="#E3D9C7"; CARD="#FBF7EF"; PAPER="#FFFFFF"
CRIT="#B23B2E"; CRITBG="#FBEBE8"; WARN="#9A6B12"; WARNBG="#FDF4E3"; OK="#3F7A52"
F="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
def esc(s): return html.escape(str(s or ""))
def n0(v): return f"{v:,.0f}"

def _roll(rows):
    o=sum(r[2] for r in rows); dl=sum(r[3] for r in rows)
    s=[0]+[sum(r[3+i] for r in rows) for i in range(1,6)]
    rated=sum(s[1:]); bad=s[1]+s[2]+s[3]; good=s[4]+s[5]
    tot=sum(i*s[i] for i in range(1,6))
    return dict(orders=o,delivered=dl,rated=rated,bad=bad,good=good,
        avg=(tot/rated) if rated else 0, ratedPct=(100*rated/dl) if dl else 0,
        badPct=(100*bad/rated) if rated else 0, goodPct=(100*good/rated) if rated else 0)

def _cell(v,align="right",bold=False,color=None,sub=None,pad="7px 10px"):
    st=f"padding:{pad};border-bottom:1px solid {LINE};text-align:{align};font-size:13px;"
    if bold: st+="font-weight:600;"
    if color: st+=f"color:{color};"
    inner=esc(v)
    if sub: inner+=f"<div style='font-size:11px;color:{MUT};font-weight:400'>{esc(sub)}</div>"
    return f"<td style=\"{st}\">{inner}</td>"

def build_digest(DAILY, RATED, OUTLETS, meta, day=None, dash_name="", pdf_name=""):
    dates=sorted({d[0] for d in DAILY}); day=day or dates[-1]
    dt=date.fromisoformat(day)
    byDate=defaultdict(list); [byDate[d[0]].append(d) for d in DAILY]
    ratedBy=defaultdict(list); [ratedBy[r["d"]].append(r) for r in RATED]

    D=_roll(byDate[day]); newest=dates[-1]
    ref=[]
    for k in range(1,5):
        x=(dt-timedelta(days=7*k)).isoformat()
        if x in byDate and (date.fromisoformat(newest)-date.fromisoformat(x)).days>=4:
            v=_roll(byDate[x])["ratedPct"]
            if v>0: ref.append(v)
    ref.sort(); med=ref[len(ref)//2] if ref else None
    filling = bool(med and D["ratedPct"] < med*0.85)
    w7=[d for d in dates if 0<=(dt-date.fromisoformat(d)).days<7]
    W=_roll([r for d in w7 for r in byDate[d]])

    day_rated=ratedBy.get(day,[]); low=[r for r in day_rated if r["r"]<=3]
    t1=[r for r in day_rated if r["e"]]; t2=[r for r in day_rated if r["q"] and not r["e"]]
    # 7-day tier 1 for context
    t1_7=[r for d in w7 for r in ratedBy.get(d,[]) if r["e"]]

    P=[]
    A=P.append
    A(f"<div style=\"margin:0;padding:0;background:{PAPER};color:{INK};font-family:{F}\">")
    A(f"<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background:{PAPER}'><tr><td align='center'>")
    A("<table role='presentation' width='680' cellpadding='0' cellspacing='0' style='width:680px;max-width:100%'>")

    # header
    A(f"<tr><td style='padding:22px 20px 6px'>"
      f"<div style='font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:{MUT}'>Creme Castle &middot; Zomato ratings</div>"
      f"<div style='font-size:25px;font-weight:700;margin-top:5px'>{dt.strftime('%A %d %B %Y')}</div></td></tr>")
    if filling:
        A(f"<tr><td style='padding:6px 20px'><table width='100%' cellpadding='0' cellspacing='0'><tr>"
          f"<td style='background:{WARNBG};border-left:4px solid {WARN};padding:11px 14px;font-size:13px;line-height:1.5'>"
          f"<b>Still filling in.</b> {D['ratedPct']:.1f}% of delivered orders rated, against {med:.1f}% for the same weekday "
          f"over the last four weeks. Unhappy customers rate within hours, happy ones take up to three days, so the "
          f"percentages below will improve. <b>The counts are real.</b></td></tr></table></td></tr>")
    else:
        A(f"<tr><td style='padding:6px 20px'><div style='font-size:12px;color:{MUT}'>"
          f"Settled: {D['ratedPct']:.1f}% rated, in line with the same weekday over the last four weeks.</div></td></tr>")

    # KPI grid
    def kpi(l,v,s,c=INK):
        return (f"<td width='25%' style='padding:11px 12px;border:1px solid {LINE};background:{CARD};vertical-align:top'>"
                f"<div style='font-size:10.5px;letter-spacing:.6px;text-transform:uppercase;color:{MUT}'>{l}</div>"
                f"<div style='font-size:22px;font-weight:700;margin-top:3px;color:{c}'>{v}</div>"
                f"<div style='font-size:11px;color:{MUT};margin-top:2px'>{s}</div></td>")
    A("<tr><td style='padding:14px 20px 4px'><table width='100%' cellpadding='0' cellspacing='0'><tr>")
    A(kpi("Orders", n0(D['orders']), f"{n0(D['delivered'])} delivered"))
    A(kpi("Ratings", n0(D['rated']), f"{D['ratedPct']:.1f}% of delivered"))
    A(kpi("Average", f"{D['avg']:.2f}", f"7-day {W['avg']:.2f}"))
    A(kpi("Bad 1-3&#9733;", n0(D['bad']), f"{D['badPct']:.0f}% &middot; 7-day {W['badPct']:.0f}%", CRIT if D['badPct']>W['badPct'] else INK))
    A("</tr></table></td></tr>")

    def h2(txt, sub=""):
        s=f"<div style='font-size:12px;color:{MUT};margin-top:3px;line-height:1.5'>{sub}</div>" if sub else ""
        return (f"<tr><td style='padding:26px 20px 2px'>"
                f"<div style='font-size:16px;font-weight:700;border-bottom:2px solid {INK};padding-bottom:6px'>{txt}</div>{s}</td></tr>")

    # tier 1
    if t1:
        A(h2("Act today", "A physical contaminant, an illness report, or an expiry or allergen failure. Star rating is irrelevant."))
        for r in t1:
            A(f"<tr><td style='padding:8px 20px'><table width='100%' cellpadding='0' cellspacing='0'><tr>"
              f"<td style='background:{CRITBG};border-left:5px solid {CRIT};padding:12px 15px'>"
              f"<div style='font-size:12px;color:{MUT}'><b style='color:{CRIT}'>{r['r']}&#9733;</b> &nbsp; "
              f"<b style='color:{INK}'>{esc(r['o'])}</b> &nbsp; {esc(r['t'])} &nbsp; #{esc(r['id'])}</div>"
              f"<div style='font-size:16px;line-height:1.55;margin-top:7px'>&ldquo;{esc(r['v'])}&rdquo;</div>"
              f"<div style='font-size:12px;color:{MUT};margin-top:7px'>{esc(', '.join(r['i']))}</div>"
              f"</td></tr></table></td></tr>")
    else:
        A(h2("Act today", f"Nothing today. {len(t1_7)} in the last 7 days."))

    # tier 2
    if t2:
        A(h2("Quality alerts", "Spoilage and staleness, at any star rating. A 4&#9733; customer who mentions a raw or stale taste is still telling you something. These belong with central production, not the outlet."))
        for r in t2:
            A(f"<tr><td style='padding:6px 20px'><table width='100%' cellpadding='0' cellspacing='0'><tr>"
              f"<td style='border:1px solid {LINE};border-left:4px solid {WARN};padding:11px 14px'>"
              f"<div style='font-size:12px;color:{MUT}'><b>{r['r']}&#9733;</b> &nbsp; <b style='color:{INK}'>{esc(r['o'])}</b> &nbsp; {esc(r['t'])}</div>"
              f"<div style='font-size:15px;line-height:1.5;margin-top:6px'>&ldquo;{esc(r['v'])}&rdquo;</div>"
              f"<div style='font-size:12px;color:{MUT};margin-top:6px'>{esc(', '.join(r['i']))}</div>"
              f"</td></tr></table></td></tr>")

    # verbatims
    rest=[r for r in low if not r["e"] and not r["q"] and r["v"]]
    A(h2("What they said", f"{len(low)} low ratings (1 to 3&#9733;), {sum(1 for r in low if r['v'])} with words."))
    if rest:
        for r in rest:
            A(f"<tr><td style='padding:5px 20px'><table width='100%' cellpadding='0' cellspacing='0'><tr>"
              f"<td style='border:1px solid {LINE};padding:11px 14px'>"
              f"<div style='font-size:12px;color:{MUT}'><b>{r['r']}&#9733;</b> &nbsp; <b style='color:{INK}'>{esc(r['o'])}</b> &nbsp; {esc(r['t'])}"
              f" &nbsp; <span style='color:{MUT}'>{esc(r['th'])}</span></div>"
              f"<div style='font-size:15px;line-height:1.5;margin-top:6px'>&ldquo;{esc(r['v'])}&rdquo;</div>"
              f"<div style='font-size:12px;color:{MUT};margin-top:6px'>{esc(', '.join(r['i']))}</div>"
              f"</td></tr></table></td></tr>")
    silent=[r for r in low if not r["v"]]
    if silent:
        A(f"<tr><td style='padding:10px 20px 0'><div style='font-size:12.5px;color:{MUT}'>"
          f"<b>{len(silent)}</b> more gave a low rating with no words: "
          + "; ".join(f"{esc(r['o'])} {r['r']}&#9733;" for r in silent[:14])
          + ("&hellip;" if len(silent)>14 else "") + "</div></td></tr>")

    # outlet table
    A(h2("Every outlet", "Rated % is the share of delivered orders that got a rating, which is the number store managers move by calling customers. An average rating is not comparable across outlets unless you read it beside rated %."))
    rowsD=byDate[day]; per={}
    for d in rowsD: per[d[1]]=_roll([d])
    A("<tr><td style='padding:6px 20px 20px'><table width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse'>")
    hdr=("Outlet","Orders","Rated","Rated %","Avg","Bad","Good")
    A("<tr>"+"".join(f"<th style=\"text-align:{'left' if i==0 else 'right'};padding:6px 10px;font-size:10.5px;"
      f"letter-spacing:.6px;text-transform:uppercase;color:{MUT};border-bottom:2px solid {LINE}\">{h}</th>"
      for i,h in enumerate(hdr))+"</tr>")
    for o in sorted(per, key=lambda o:(per[o]["avg"] if per[o]["rated"] else 9, -per[o]["orders"])):
        v=per[o]; thin=v["rated"]<5
        A("<tr>"+_cell(o,"left",True,sub=OUTLETS.get(o,""))
          +_cell(n0(v["orders"]))+_cell(n0(v["rated"]))
          +_cell(f"{v['ratedPct']:.1f}%",color=WARN if v["ratedPct"]<6 else None)
          +_cell(f"{v['avg']:.2f}" if v["rated"] else "-", color=(MUT if thin else (CRIT if v["avg"]<4 else None)))
          +_cell(n0(v["bad"]) if v["bad"] else "-", color=CRIT if v["bad"] else MUT)
          +_cell(n0(v["good"]))+"</tr>")
    A("<tr>"+ "".join([
        f"<td style='padding:9px 10px;border-top:2px solid {INK};background:{CARD};font-weight:700;font-size:13px'>TOTAL"
        f"<div style=\"font-size:11px;color:{MUT};font-weight:400\">{len(per)} outlets</div></td>"]
        +[f"<td style='padding:9px 10px;border-top:2px solid {INK};background:{CARD};font-weight:700;font-size:13px;text-align:right'>{v}</td>"
          for v in (n0(D['orders']), n0(D['rated']), f"{D['ratedPct']:.1f}%", f"{D['avg']:.2f}", n0(D['bad']), n0(D['good']))])
      +"</tr>")
    A("</table></td></tr>")

    links=[]
    if dash_name: links.append(f"<b>{esc(dash_name)}</b> is attached: download and open it in a browser for the full interactive dashboard, any day, any window.")
    if pdf_name: links.append(f"<b>{esc(pdf_name)}</b> is the printable version.")
    A(f"<tr><td style='padding:6px 20px 26px'><div style='border-top:1px solid {LINE};padding-top:12px;"
      f"font-size:12px;color:{MUT};line-height:1.6'>"
      + (" ".join(links)+"<br><br>" if links else "")
      + "<b>Method.</b> Source: Zomato order history, spine table landing.zomato_order_details, current rows only. "
        "Bad is 1 to 3&#9733;, good is 4 to 5&#9733;. Outlets are keyed on the Zomato restaurant ID and shown by their internal "
        "Creme Castle name, so a Zomato relabel cannot split a store's history. Orders is every order; rated % is measured "
        "against delivered orders only, since a rejected order cannot be rated. A rating belongs to the whole order, not one "
        "item, so an item in a multi-item order may be innocent. Never compare these against Swiggy: Zomato ratings are partly "
        "solicited by manager calls, Swiggy's are not."
      + "</div></td></tr>")
    A("</table></td></tr></table></div>")
    return "\n".join(P)

STANDALONE_HEAD = ('<!doctype html><html><head><meta charset="utf-8">'
  '<meta name="viewport" content="width=device-width,initial-scale=1">'
  '<title>Creme Castle daily ratings</title>'
  '<style>@page{size:A4;margin:0} body{margin:0} '
  'table{page-break-inside:auto} tr{page-break-inside:avoid;page-break-after:auto}</style>'
  '</head><body>')

def standalone(body_html):
    """Wrap the email fragment so it renders correctly as a file (charset!) and prints."""
    return STANDALONE_HEAD + body_html + "</body></html>"

def to_pdf(html_path, pdf_path):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b=p.chromium.launch(); pg=b.new_page()
        pg.goto(pathlib.Path(html_path).resolve().as_uri(), wait_until="load")
        pg.pdf(path=str(pdf_path), format="A4", print_background=True,
               margin={"top":"12mm","bottom":"14mm","left":"10mm","right":"10mm"},
               display_header_footer=True, header_template="<div></div>",
               footer_template=("<div style=\"font-size:8px;color:#7A6E60;width:100%;padding:0 12mm;"
                                "font-family:Helvetica,Arial\"><span style='float:left'>Creme Castle daily ratings</span>"
                                "<span style='float:right'>Page <span class='pageNumber'></span> of "
                                "<span class='totalPages'></span></span></div>"))
        b.close()
    return pdf_path
