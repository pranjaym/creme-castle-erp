#!/usr/bin/env python3
"""The 7:30 daily dashboard mailer (Pranjay's spec, 24 Aug 2026).

48 mails from one data pull:
  41 store mails   -> the store's own page, to its store email
   5 area mails    -> the area page + that AM's store pages attached
   1 central mail A -> all 5 area pages + the network page
   1 central mail B -> all 41 store pages in one mail
Central mails go to the central team with Pranjay in CC.

Data: the spine functions dash_all / dash_store_detail / dash_store_reasons,
the same ones the portal /daily module reads. The mail covers the LATEST
LOADED day (dash_latest_date) and says so plainly; it never claims
"yesterday".

Exit codes follow the house pattern: 0 sent (wrapper stamps success),
75 defer (transient problem, a later slot retries), 1 hard failure (alert
mail already sent). CC_MAILER_TEST=1 sends a 4-mail sample to Pranjay only.
"""
from __future__ import annotations
import os
import re
import smtplib
import ssl
import sys
import traceback
from datetime import date, datetime
from email.message import EmailMessage

import psycopg2

import render as R
import pages as P

HERE = os.path.dirname(os.path.abspath(__file__))
TEST = os.environ.get("CC_MAILER_TEST") == "1"
# Render every page to ./dryrun and send nothing. This is how the designs
# are checked before a change goes near the 07:30 run.
DRYRUN = os.environ.get("CC_MAILER_DRYRUN") == "1"
OWNER = "pranjay@cremecastle.in"
CENTRAL = ["pawan.g@cremecastle.in", "rishabh.k@cremecastle.in", "bhagwan@cremecastle.in"]
AM_EMAIL = {"Ajay": "ajay.rana@cremecastle.in", "Gopal": "gopal.ch@cremecastle.in",
            "Sanjeev": "sanjeev.sejwal@cremecastle.in", "Mukesh": "am.chandigarh@cremecastle.in",
            "Santosh": "am.jaipur@cremecastle.in"}


def load_env():
    env = {}
    for p in [os.path.join(HERE, "../../../dashboard/auto/.env"),
              os.path.join(HERE, "../../.env.local")]:
        p = os.path.abspath(p)
        if os.path.exists(p):
            for line in open(p):
                m = re.match(r"([A-Z_]+)=(.*)", line.strip())
                if m and m.group(1) not in env:
                    env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env


def _write(out_dir, name, html_str):
    path = os.path.join(out_dir, name)
    with open(path, "w") as fh:
        fh.write(html_str)
    return path


def fetch_all(cur, d):
    cur.execute("select public.dash_all(%s::date)", (d,))
    data = cur.fetchone()[0]
    # score + rank, same arithmetic as the portal's lib/daily.ts
    for s in data["stores"]:
        day, wk = s["day"], s["wk"]
        if day.get("cpct") is None and day.get("rpct") is None and day.get("online") is None:
            s["dayScore"] = None
        else:
            s["dayScore"] = (day.get("cpct") or 0) + (day.get("rpct") or 0) + (100 - (day.get("online") or 100))
        s["wkScore"] = (
            (100 * (wk.get("comps") or 0)) / wk["orders"] + (100 * (wk.get("rej") or 0)) / wk["orders"]
            + (100 - (wk.get("online") or 100))
        ) if wk.get("orders") else None
    for key, rkey, rat, orders in [("dayScore", "dayRank", lambda s: s["day"].get("rating") or 0, lambda s: s["day"].get("orders") or 0),
                                   ("wkScore", "wkRank", lambda s: s["wk"].get("rating") or 0, lambda s: s["wk"].get("orders") or 0)]:
        ranked = sorted([s for s in data["stores"] if s.get(key) is not None],
                        key=lambda s: (s[key], -rat(s), -orders(s)))
        for i, s in enumerate(ranked):
            s[rkey] = i + 1
    return data


def area_aggs(stores, money_by):
    """Per-area rollups, the same arithmetic the portal does in lib/daily.ts.
    Money comes from the central function's per-store figures, not from
    dash_all, so one definition of "money lost" is used everywhere."""
    by = {}
    for s in stores:
        by.setdefault(s.get("am") or "Unassigned", []).append(s)

    def tot(xs, sel):
        return sum((sel(x) or 0) for x in xs)

    def mean(xs, sel):
        vs = [sel(x) for x in xs if sel(x)]
        return sum(vs) / len(vs) if vs else None

    out = []
    for am, xs in by.items():
        do, dc = tot(xs, lambda s: s["day"].get("orders")), tot(xs, lambda s: s["day"].get("comps"))
        wo, wc = tot(xs, lambda s: s["wk"].get("orders")), tot(xs, lambda s: s["wk"].get("comps"))
        out.append({
            "am": am, "stores": len(xs),
            "d_orders": do, "d_comps": dc, "d_cpct": (100.0 * dc / do) if do else None,
            "d_srej": tot(xs, lambda s: s["day"].get("srej")),
            "d_off": tot(xs, lambda s: s["day"].get("offmin")),
            "d_rating": mean(xs, lambda s: s["day"].get("rating")),
            "w_orders": wo, "w_comps": wc, "w_cpct": (100.0 * wc / wo) if wo else None,
            "w_srej": tot(xs, lambda s: s["wk"].get("srej")),
            "w_off": tot(xs, lambda s: s["wk"].get("offmin")),
            "w_fr": tot(xs, lambda s: s["wk"].get("fr")),
            "w_wait": mean(xs, lambda s: s["wk"].get("wait")),
            "w_money": sum(money_by.get(s["code"], 0) for s in xs),
        })
    return sorted(out, key=lambda a: a["d_cpct"] if a["d_cpct"] is not None else 99)


def date_label(iso):
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%A, %d %B %Y")


def _tls_context():
    """The python.org build has no OS cert store; use certifi's bundle (present
    on this Mac) so the TLS connection is verified rather than unverified."""
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


def smtp_connect(host, port):
    """465 = implicit SSL; anything else = STARTTLS (the house default is 587)."""
    if int(port) == 465:
        return smtplib.SMTP_SSL(host, port, context=_tls_context(), timeout=120)
    s = smtplib.SMTP(host, port, timeout=120)
    s.starttls(context=_tls_context())
    return s


def build_mail(sender, to, cc, subject, body_text, attachments):
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = ", ".join(to)
    if cc:
        msg["Cc"] = ", ".join(cc)
    msg["Subject"] = subject
    msg.set_content(body_text)
    for name, html_str in attachments:
        msg.add_attachment(html_str.encode("utf-8"), maintype="text", subtype="html", filename=name)
    return msg


def main():
    env = load_env()
    conn = psycopg2.connect(env["SPINE_DATABASE_URL"])
    conn.autocommit = True
    cur = conn.cursor()

    cur.execute("select public.dash_latest_date()")
    d = cur.fetchone()[0].isoformat()
    # CC_MAILER_DATE points a dry run or a test at any settled day, which is how
    # a design change is checked against a day rich enough to exercise every
    # section. The scheduled job never sets it; the log says so when it is set.
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", os.environ.get("CC_MAILER_DATE", "")):
        d = os.environ["CC_MAILER_DATE"]
        print(f"CC_MAILER_DATE is set: rendering {d} instead of the latest settled day")
    dlabel = date_label(d)
    data = fetch_all(cur, d)
    stores = data["stores"]
    if not stores or all(s["day"].get("orders") is None for s in stores):
        print(f"no data for {d}; deferring")
        return 75

    # The central function carries the sections the pages share (shut shop,
    # per-store money on the corrected rejection vocabulary, the levers) and is
    # the single source for money everywhere, so it is fetched before the
    # rollups that depend on it.
    cur.execute("select public.dash_central_detail(%s::date)", (d,))
    central = cur.fetchone()[0]
    money_by = {m["code"]: m["total_wk"] for m in (central.get("money_stores") or [])}
    areas = area_aggs(stores, money_by)

    cur.execute("select internal_code, store_email from public.outlets where active")
    store_email = dict(cur.fetchall())

    # Render everything once.
    store_html = {}
    for s in stores:
        cur.execute("select public.dash_store_detail(%s, %s::date)", (s["code"], d))
        detail = cur.fetchone()[0]
        cur.execute("select public.dash_store_reasons(%s, %s::date)", (s["code"], d))
        reasons = cur.fetchone()[0] or {}
        store_html[s["code"]] = P.store_page(s, detail, reasons, stores, d)
    area_html = {}
    for a in areas:
        if a["am"] not in AM_EMAIL:
            continue
        cur.execute("select public.dash_area_detail(%s, %s::date)", (a["am"], d))
        area_html[a["am"]] = P.area_page(
            a["am"], [s for s in stores if (s.get("am") or "Unassigned") == a["am"]],
            cur.fetchone()[0], stores, areas, d)
    central_html = P.central_page(data, central, areas, d)
    conn.close()

    if DRYRUN:
        out = os.path.join(HERE, "dryrun")
        os.makedirs(out, exist_ok=True)
        written = []
        for code, h in store_html.items():
            written.append(_write(out, f"{code} {d}.html", h))
        for am, h in area_html.items():
            written.append(_write(out, f"Area {am} {d}.html", h))
        written.append(_write(out, f"Network {d}.html", central_html))
        print(f"dry run: wrote {len(written)} pages for {d} to {out}; nothing sent")
        return 0

    fname = lambda code: f"{code} {d}.html"
    body_common = (f"Daily Zomato dashboard for {dlabel}.\n\n"
                   "Open the attached file in a browser (tap it on your phone) for the full page. Every "
                   "section shows the day first, then the 7 days ending on it, and every number lists the "
                   "orders behind it.\n\n"
                   f"Live version with any date: {R.PORTAL}/daily (your portal login).\n")

    sender = env.get("DASH_EMAIL_SENDER") or env.get("CC_MAIL_USER")
    password = env.get("DASH_EMAIL_APP_PASSWORD") or env.get("CC_MAIL_APP_PASSWORD")
    host = env.get("DASH_SMTP_HOST", "smtp.gmail.com")
    port = int(env.get("DASH_SMTP_PORT", "587"))

    mails = []
    for s in stores:
        to = store_email.get(s["code"])
        if not to:
            continue
        mails.append(([to], [], f"Store Daily {s['code']}: {dlabel}",
                      body_common, [(fname(s["code"]), store_html[s["code"]])]))
    for am, mail_addr in AM_EMAIL.items():
        if am not in area_html:
            continue
        atts = [(f"Area {am} {d}.html", area_html[am])]
        atts += [(fname(s["code"]), store_html[s["code"]]) for s in stores if (s.get("am") or "") == am]
        mails.append(([mail_addr], [], f"Area Daily {am}: {dlabel}", body_common, atts))
    atts_a = [(f"Network {d}.html", central_html)] + [(f"Area {am} {d}.html", h) for am, h in area_html.items()]
    mails.append((CENTRAL, [OWNER], f"Network Daily: {dlabel}", body_common, atts_a))
    atts_b = [(fname(code), h) for code, h in sorted(store_html.items())]
    mails.append((CENTRAL, [OWNER], f"All store pages: {dlabel}", body_common, atts_b))

    if TEST:
        sample = [m for m in mails if "CC-ND-Sector 45" in m[2] or "Area Daily Gopal" in m[2]
                  or m[2].startswith("Network Daily") or m[2].startswith("All store pages")]
        mails = [([OWNER], [], "[TEST] " + m[2], m[3], m[4]) for m in sample]

    sent = 0
    with smtp_connect(host, port) as smtp:
        smtp.login(sender, password)
        for to, cc, subject, body_text, atts in mails:
            smtp.send_message(build_mail(sender, to, cc, subject, body_text, atts))
            sent += 1
    print(f"sent {sent} mails for {d} (test={TEST})")
    return 0


def alert(env, text):
    try:
        sender = env.get("DASH_EMAIL_SENDER") or env.get("CC_MAIL_USER")
        password = env.get("DASH_EMAIL_APP_PASSWORD") or env.get("CC_MAIL_APP_PASSWORD")
        msg = EmailMessage()
        msg["From"], msg["To"] = sender, OWNER
        msg["Subject"] = "Daily mailer FAILED"
        msg.set_content(text)
        with smtp_connect(env.get("DASH_SMTP_HOST", "smtp.gmail.com"),
                          env.get("DASH_SMTP_PORT", "587")) as s:
            s.login(sender, password)
            s.send_message(msg)
    except Exception:
        pass


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        tb = traceback.format_exc()
        print(tb)
        # Before ~08:40 IST a later slot will retry silently; after that, alert.
        now = datetime.now()
        if now.hour > 8 or (now.hour == 8 and now.minute >= 40):
            alert(load_env(), f"The 7:30 daily dashboard mailer failed on its last slot.\n\n{tb}\n"
                              "Manual retry: python3 kitchen/workers/daily-mailer/run_mailer.py")
            sys.exit(1)
        sys.exit(75)
