#!/usr/bin/env python3
"""Creme Castle daily ratings: build the three surfaces and (optionally) mail them.

  python3 run.py                      build only, nothing sent
  python3 run.py --send               send to CC_RATINGS_RECIPIENTS
  python3 run.py --send --to a@b.com  send to an explicit list

Surfaces:
  CC_Daily_Ratings_<date>.html   full interactive dashboard (attach, opens in a browser)
  CC_Daily_Ratings_<date>.pdf    printable
  digest                         static HTML, becomes the email body itself
"""
import argparse, json, os, pathlib, smtplib, ssl, sys
from datetime import date, timedelta
from email.message import EmailMessage
import build, digest

HERE = pathlib.Path(__file__).parent
OUT = HERE/"out"

def make(days=45, day=None):
    OUT.mkdir(parents=True, exist_ok=True)
    D, R, C, O, M = build.build(days)
    target = day or M["to"]
    stamp = target.replace("-", "")
    dash = OUT/f"CC_Daily_Ratings_{stamp}.html"
    pdf  = OUT/f"CC_Daily_Ratings_{stamp}.pdf"
    build.render(HERE/"template.html", dash, D, R, C, O, M)
    body = digest.build_digest(D, R, O, M, day=target, dash_name=dash.name, pdf_name=pdf.name)
    dstd = OUT/f"CC_Digest_{stamp}.html"
    dstd.write_text(digest.standalone(body), encoding="utf-8")
    digest.to_pdf(dstd, pdf)
    return dict(day=target, body=body, dash=dash, pdf=pdf, digest=dstd, meta=M, rated=R, daily=D)

def load_groups(path=None):
    p = pathlib.Path(path or HERE/"recipients.json")
    return json.loads(p.read_text())["groups"]

def _sslctx():
    """This python.org build ships no system CA bundle, so verification fails
    against smtp.gmail.com unless we point at certifi explicitly. Verify, do not
    disable."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()

ATTACH = {"dashboard": ("dash", "text", "html"), "pdf": ("pdf", "application", "pdf")}

def send_group(art, group, dry=False):
    host = os.environ.get("DASH_SMTP_HOST"); port = int(os.environ.get("DASH_SMTP_PORT", 465))
    sender = os.environ.get("DASH_EMAIL_SENDER"); pw = os.environ.get("DASH_EMAIL_APP_PASSWORD")
    if not (host and sender and pw):
        print("  SMTP not configured; cannot send."); return False
    d = date.fromisoformat(art["day"])
    files = [art[ATTACH[a][0]] for a in group["attach"]]
    msg = EmailMessage()
    msg["Subject"] = f"Creme Castle ratings, {d.strftime('%a %d %b')}"
    msg["From"] = sender; msg["To"] = ", ".join(group["to"])
    msg.set_content("This report is HTML. See the attachment for the full report.")
    msg.add_alternative(art["body"], subtype="html")
    for a in group["attach"]:
        key, mt, st = ATTACH[a]; f = art[key]
        msg.add_attachment(f.read_bytes(), maintype=mt, subtype=st, filename=f.name)
    size = sum(f.stat().st_size for f in files)/1024
    if dry:
        print(f"  DRY RUN [{group['name']}] -> {len(group['to'])} recipients, "
              f"attachment {', '.join(f.name for f in files)} ({size:,.0f} KB)")
        for r in group["to"]: print(f"      {r}")
        return True
    # 465 is implicit SSL; 587 (Gmail, what we use) needs STARTTLS. Same as run_daily.py:440.
    if port == 465:
        with smtplib.SMTP_SSL(host, port, timeout=60, context=_sslctx()) as s:
            s.login(sender, pw); s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=60) as s:
            s.starttls(context=_sslctx())
            s.login(sender, pw); s.send_message(msg)
    print(f"  sent [{group['name']}] to {len(group['to'])} recipients ({size:,.0f} KB)")
    return True

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=45)
    ap.add_argument("--day", default=None, help="YYYY-MM-DD, defaults to the newest day in the spine")
    ap.add_argument("--send", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--recipients", default=None, help="path to recipients.json")
    ap.add_argument("--only", default=None, help="send just one group by name")
    ap.add_argument("--defer-if-stale", action="store_true",
                    help="exit 75 (defer, no alert) unless the spine already holds YESTERDAY. "
                         "Early evening slots use this so a late Zomato pull is waited for; "
                         "the last slot omits it and mails whatever the newest day is.")
    a = ap.parse_args()
    if a.defer_if_stale and not a.day:
        import build as _b
        _rows, _s, _e = _b.fetch(1)
        yesterday = date.today() - timedelta(days=1)
        if _e != yesterday:
            print(f"  spine newest day is {_e}, expected {yesterday}. "
                  f"Deferring to the next slot rather than mailing a stale day.")
            sys.exit(75)
    art = make(a.days, a.day)
    M = art["meta"]
    print(f"Built for {art['day']}")
    print(f"  {M['orders']:,} orders ({M['delivered']:,} delivered), {M['rated']:,} rated, "
          f"{M['outlets']} outlets, {M['days']} days of history")
    print(f"  dashboard {art['dash'].name}  ({art['dash'].stat().st_size/1024:.0f} KB)")
    print(f"  pdf       {art['pdf'].name}  ({art['pdf'].stat().st_size/1024:.0f} KB)")
    if M["unmapped"]:
        print(f"  WARNING unmapped outlet id(s): {', '.join(M['unmapped'])}")
    if a.send or a.dry_run:
        groups = load_groups(a.recipients)
        if a.only:
            groups = [g for g in groups if g["name"].lower() == a.only.lower()]
        for g in groups:
            send_group(art, g, dry=a.dry_run)
