#!/usr/bin/env python3
"""
The intraday pulse: take an hourly snapshot of today's sales and say where the day
stands, right now, against a normal day of the same weekday.

Built 28 August 2026 (Raksha Bandhan) on Pranjay's instruction.

What one run does
  1. pulls Petpooja's Online Order Report in its "latest/current" scope, which is
     the only scope that returns orders placed in the last few minutes;
  2. pulls the Order Summary Item report for today, for the item side;
  3. lands both in the `intraday` schema (migration 200), append only, tagged with
     this run, so nothing already stored is ever overwritten;
  4. prints the hour by hour picture and the comparison.

What it deliberately does NOT do
  It does not write to landing.petpooja_*. Those tables are the settled record of a
  finished business day and the 08:00 job verifies them against a fresh pull each
  morning; a part-day write would make that verification argue with itself. Today's
  settled rows will arrive there tomorrow morning exactly as they always have. The
  pulse is a second, parallel view of the same source, never a replacement.

Usage
  python3 run_pulse.py                 # pull, store, report   (the hourly job)
  python3 run_pulse.py --report-only   # report from what is already stored, no pull
  python3 run_pulse.py --no-items      # order side only, the faster pull
  python3 run_pulse.py --date 2026-08-28 --occasion "Raksha Bandhan"

Environment comes from dashboard/auto/.env (the same file the morning job uses):
SPINE_DATABASE_URL for the spine, SPINE_SUPABASE_* for the saved Petpooja session.
"""
import argparse
import datetime as dt
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))   # ~/creme-castle-erp
AUTO = os.path.join(REPO, "dashboard", "auto")
SCRAPER = os.path.join(REPO, "kitchen", "workers", "petpooja-ingest")

# Failures that are the network flapping, not the job being wrong. An hourly job is
# superseded sixty minutes later, so these must DEFER quietly (exit 75) and never
# raise an alarm: the F23 rule, that a transport failure is only a real problem once
# a later slot has also failed. Deliberately NOT here: a missing or expired Petpooja
# session, which must alarm loudly and immediately, because only a hand OTP login
# fixes it and no amount of retrying ever will (F24). Bare OSError stays out for the
# same reason, even though it would catch the NAT64 EADDRNOTAVAIL of F22, which the
# message check below picks up instead.
TRANSPORT_TYPES = ("OperationalError", "InterfaceError", "NetworkError",
                   "ConnectionError", "ReadTimeout", "ConnectTimeout", "TimeoutError")
TRANSPORT_WORDS = ("network", "connection", "timeout", "timed out", "temporarily",
                   "eaddrnotavail", "econnreset", "ssl", "reset by peer",
                   "server closed the connection", "could not translate host")


def is_transport(err):
    """True when the message reads as the network, not as a broken job."""
    low = str(err).lower()
    if "session" in low and ("missing" in low or "expired" in low or "not set" in low):
        return False                      # F24: this one must be loud
    return (any(t.lower() in low for t in TRANSPORT_TYPES)
            or any(w in low for w in TRANSPORT_WORDS))


# The business day starts at 04:00 IST. A 01:30 order belongs to the day before, and
# every comparison in this file is cut on the same rule so both sides match.
DAY_START_HOUR = 4


def load_env():
    """Reuse the morning job's .env rather than keeping a second copy of the same
    secrets. Anything already in the environment wins."""
    path = os.path.join(AUTO, ".env")
    if not os.path.exists(path):
        return
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def occasion_for(business_date):
    """Look the day up in occasions.json. Returns (occasion, anchor_date), both None
    when the day is not listed, which is not an error: an ordinary day is a perfectly
    good thing to watch hourly, it just has no festival name and no festival anchor."""
    path = os.path.join(HERE, "occasions.json")
    if not os.path.exists(path):
        return None, None
    try:
        import json
        cfg = json.load(open(path, encoding="utf-8")).get(business_date.isoformat())
        if not cfg:
            return None, None
        anchor = cfg.get("anchor")
        return cfg.get("occasion"), (dt.date.fromisoformat(anchor) if anchor else None)
    except Exception as e:
        print(f"occasions.json unreadable ({type(e).__name__}), continuing without it")
        return None, None


def business_date_now(now=None):
    now = now or dt.datetime.now()
    d = now.date()
    return d - dt.timedelta(days=1) if now.hour < DAY_START_HOUR else d


# --------------------------------------------------------------------- storage --

ORDER_COLS = ["order_date", "invoice_date", "aggregator_order_no", "pos_invoice_no",
              "order_from", "outlet_name", "outlet_display_name", "petpooja_identifier",
              "order_type", "customer_name", "customer_phone", "payment_type",
              "delivery_status", "status", "my_amount", "aggregator_discount",
              "outlet_discount", "delivery_charges", "container_charges",
              "additional_charge", "total", "order_acceptance_time",
              "order_delivery_time", "cancelled_by", "reason", "tip", "complimentary"]

ITEM_COLS = ["restaurant_name", "invoice_no", "order_ts", "payment_type", "order_type",
             "status", "area", "virtual_brand_name", "brand_grouping", "assign_to",
             "customer_phone", "customer_name", "customer_address", "persons",
             "order_cancel_reason", "my_amount", "total_tax", "discount",
             "delivery_charge", "container_charge", "service_charge",
             "additional_charge", "deduction_charge", "waived_off", "round_off",
             "total", "item_name", "category_name", "sap_code", "item_price",
             "item_quantity", "item_total"]

TARGET = {
    "online_orders":      ("intraday.pp_online_orders", ORDER_COLS),
    "order_summary_item": ("intraday.pp_order_items",   ITEM_COLS),
}


def open_run(conn, report, business_date, occasion):
    with conn.cursor() as cur:
        cur.execute(
            "insert into intraday.pulse_run (run_ist, business_date, occasion, report) "
            "values (%s, %s, %s, %s) returning id",
            (dt.datetime.now().replace(microsecond=0), business_date, occasion, report))
        run_id = cur.fetchone()[0]
    conn.commit()
    return run_id


def close_run(conn, run_id, status, parsed=0, skipped=0, new=0, max_ts=None,
              receipt=None, note=None):
    with conn.cursor() as cur:
        cur.execute(
            "update intraday.pulse_run set finished_at = now(), status = %s, "
            "rows_parsed = %s, rows_skipped = %s, rows_new = %s, source_max_ts = %s, "
            "receipt_sha = %s, note = %s where id = %s",
            (status, parsed, skipped, new, max_ts, receipt, note, run_id))
    conn.commit()


def store(conn, report, records, run_id):
    """Insert what this run saw. A row identical to one already stored is not stored
    again: it only has its last_seen marker moved forward, which is how the schema
    records 'this order still looked exactly like this an hour later'. Returns the
    count of genuinely new rows."""
    from psycopg2.extras import execute_values
    table, cols = TARGET[report]
    if not records:
        return 0
    sql = (
        f"insert into {table} (first_seen_run_id, last_seen_run_id, business_date, "
        f"{', '.join(cols)}, row_hash) values %s "
        f"on conflict (business_date, row_hash) do update "
        f"  set last_seen_run_id = excluded.last_seen_run_id, "
        f"      last_seen_at = now(), "
        f"      seen_count = {table}.seen_count + 1 "
        f"returning (xmax = 0) as is_new")
    payload = [[run_id, run_id, r["business_date"], *r["values"], r["row_hash"]]
               for r in records]
    with conn.cursor() as cur:
        execute_values(cur, sql, payload, page_size=500)
        new = sum(1 for row in cur.fetchall() if row[0])
    conn.commit()
    return new


# ---------------------------------------------------------------------- pulling --

def pull(conn, report, business_date, occasion):
    """Scrape one report and land it. Returns (new_rows, max_ts, error_or_None).

    Best effort per report on purpose: if the item pull fails, the order pull has
    already landed and the sales number still gets to Pranjay. A pulse that says
    nothing because half of it broke is worse than a pulse that says which half.
    scrape_and_download raises SystemExit when it gives up, hence the two-class
    except (the same trap documented in run_daily.py)."""
    sys.path.insert(0, SCRAPER)
    import scrape
    import ingest

    run_id = open_run(conn, report, business_date, occasion)
    t0 = time.time()
    try:
        if report == "online_orders":
            # NO date range, server_type=1. Proven in run_daily.scrape_orders_today:
            # asking this report for today's date makes the picker clamp back to
            # yesterday and the export returns the wrong day. Left alone, the
            # "latest/current" scope returns today by itself. Do not add dates.
            path = scrape.scrape_and_download("online_orders", server_type="1",
                                              max_retries=1)
            records, skipped = ingest.parse_online_orders(path)
        else:
            day = business_date.isoformat()
            path = scrape.scrape_and_download("order_summary_item", from_date=day,
                                              to_date=day, max_retries=1)
            records, skipped = ingest.parse_item_report(path)

        # The freshness marker. The order timestamp sits at a known index in the
        # fixed column list, so read it by name rather than by position.
        _, cols = TARGET[report]
        ts_at = cols.index("order_date" if report == "online_orders" else "order_ts")
        stamps = [r["values"][ts_at] for r in records if r["values"][ts_at]]
        max_ts = max(stamps) if stamps else None

        try:
            receipt = ingest.store_receipt(path)
        except Exception as e:
            # The immutable receipt is nice to have, not load bearing for a pulse
            # that is superseded an hour later.
            receipt = None
            print(f"  receipt not stored ({type(e).__name__}), rows loaded anyway")

        new = store(conn, report, records, run_id)
        close_run(conn, run_id, "ok", len(records), skipped, new, max_ts,
                  receipt if isinstance(receipt, str) else None)
        print(f"  {report}: {len(records)} rows parsed, {new} new, "
              f"fresh to {max_ts}, {round(time.time() - t0, 1)}s")
        return new, max_ts, None
    except (Exception, SystemExit) as e:
        err = f"{type(e).__name__}: {str(e)[:200]}"
        # F20, reborn in every new worker that forgets it: when the cause is the
        # network going away, the connection is already dead and the rollback ITSELF
        # raises. Unguarded, that escapes this handler and abandons the other report.
        try:
            conn.rollback()
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            try:
                import psycopg2 as _pg
                conn = _pg.connect(os.environ["SPINE_DATABASE_URL"])
                print("  spine connection was dead; reconnected.")
            except Exception:
                print("  spine unreachable; this run is recorded as failed by the "
                      "next run that can reach it.")
                return 0, None, err
        try:
            close_run(conn, run_id, "failed", note=err)
        except Exception:
            pass
        print(f"  {report} FAILED: {err}")
        return 0, None, err


# --------------------------------------------------------------------- reading --

def rupees(n):
    """Indian digit grouping: 3,48,120 not 348,120. Pranjay reads lakhs, not
    thousands-of-thousands."""
    if n is None:
        return "-"
    n = int(round(float(n)))
    sign, s = ("-" if n < 0 else ""), str(abs(n))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts) + "," + tail
    return f"{sign}{s}"


def pct(now, base):
    if not base:
        return "  n/a"
    d = (float(now) - float(base)) / float(base) * 100
    return f"{d:+6.1f}%"


def baseline_days(conn, business_date, weeks=4):
    """The last `weeks` same-weekday business days that the settled table actually
    holds. Same weekday because a Friday does not look like a Tuesday, and settled
    rather than intraday because those days are finished and verified."""
    wanted = [business_date - dt.timedelta(days=7 * i) for i in range(1, weeks + 1)]
    with conn.cursor() as cur:
        cur.execute("select distinct business_date from landing.petpooja_online_orders "
                    "where business_date = any(%s)", (wanted,))
        have = {r[0] for r in cur.fetchall()}
    return sorted(d for d in wanted if d in have)


def cut_window(business_date, now=None):
    """The slice of the business day that has actually happened: 04:00 to the clock.
    Every comparison uses the identical slice of its own day, so a part day is never
    laid against a whole one (the spot-check trap: an intraday AOV compared to a full
    day's AOV is an artefact, the same window against the same window is not)."""
    now = now or dt.datetime.now()
    start = dt.datetime.combine(business_date, dt.time(DAY_START_HOUR))
    return start, now, (now - start)


def totals_today(conn, business_date, start, end):
    with conn.cursor() as cur:
        cur.execute("""
            select count(*) filter (where status <> 'Cancelled'),
                   coalesce(sum(order_value) filter (where status <> 'Cancelled'), 0),
                   count(*) filter (where status = 'Cancelled'),
                   coalesce(sum(order_value) filter (where status = 'Cancelled'), 0)
            from intraday.v_orders_now
            where business_date = %s and placed_at >= %s and placed_at <= %s
        """, (business_date, start, end))
        return cur.fetchone()


def totals_baseline(conn, days, elapsed):
    """The same elapsed slice of each baseline day, one row per day."""
    if not days:
        return []
    with conn.cursor() as cur:
        cur.execute("""
            select business_date,
                   count(*) filter (where status <> 'Cancelled'),
                   coalesce(sum(intraday.money(total)) filter (where status <> 'Cancelled'), 0)
            from landing.petpooja_online_orders
            where voided_at is null and business_date = any(%s)
              and intraday.ts(order_date) >= business_date + interval '4 hours'
              and intraday.ts(order_date) <  business_date + interval '4 hours' + %s
            group by 1 order by 1
        """, (days, elapsed))
        return cur.fetchall()


def hourly_today(conn, business_date, start, end):
    with conn.cursor() as cur:
        cur.execute("""
            select hour, orders, sales, cancelled_orders, aov
            from intraday.v_pulse_hourly
            where business_date = %s and hour >= %s and hour <= %s
            order by hour
        """, (business_date, start, end))
        return cur.fetchall()


def hourly_baseline(conn, days):
    """Mean orders and sales per clock hour across the baseline days.

    Divided by the NUMBER OF BASELINE DAYS, not by the number of days that happened
    to have an order in that hour. An hour with no orders is a real zero and must
    pull the mean down; averaging only over the days that traded would quietly make
    a dead 05:00 look like a normal one."""
    if not days:
        return {}
    n = len(days)
    with conn.cursor() as cur:
        cur.execute("""
            select extract(hour from hour)::int as h,
                   sum(orders)::numeric, sum(sales)::numeric
            from intraday.v_settled_hourly
            where business_date = any(%s)
            group by 1
        """, (days,))
        return {r[0]: (float(r[1]) / n, float(r[2]) / n) for r in cur.fetchall()}


def split(conn, business_date, start, end, column, limit=None):
    with conn.cursor() as cur:
        cur.execute(f"""
            select coalesce(nullif({column}, ''), '(blank)'),
                   count(*) filter (where status <> 'Cancelled'),
                   coalesce(sum(order_value) filter (where status <> 'Cancelled'), 0),
                   count(*) filter (where status = 'Cancelled')
            from intraday.v_orders_now
            where business_date = %s and placed_at >= %s and placed_at <= %s
            group by 1 order by 3 desc
            {'limit ' + str(limit) if limit else ''}
        """, (business_date, start, end))
        return cur.fetchall()


def top_items(conn, business_date, start, end, limit=15):
    with conn.cursor() as cur:
        cur.execute("""
            select item_name,
                   round(sum(qty)) as units,
                   round(sum(item_value)) as value,
                   count(distinct invoice_no) as in_orders
            from intraday.v_items_now
            where business_date = %s and placed_at >= %s and placed_at <= %s
              and status <> 'Cancelled'
            group by 1 order by 2 desc nulls last limit %s
        """, (business_date, start, end, limit))
        return cur.fetchall()


def freshness(conn, business_date):
    with conn.cursor() as cur:
        cur.execute("""
            select report, max(source_max_ts), max(run_ist), count(*)
            from intraday.pulse_run
            where business_date = %s and status = 'ok'
            group by 1 order by 1
        """, (business_date,))
        return cur.fetchall()


# ---------------------------------------------------------------------- report --

W = 78


def rule(ch="="):
    return ch * W


def report(conn, business_date, occasion, now=None, festival_anchor=None):
    start, end, elapsed = cut_window(business_date, now)
    mins = int(elapsed.total_seconds() // 60)
    days = baseline_days(conn, business_date)
    daylabel = business_date.strftime("%A %d %B %Y")
    weekday = business_date.strftime("%A")

    out = [rule(), "  CREME CASTLE, INTRADAY PULSE",
           f"  {occasion + ', ' if occasion else ''}{daylabel}",
           f"  Clock {end.strftime('%H:%M')} IST   business day counted from "
           f"{DAY_START_HOUR:02d}:00, {mins // 60}h {mins % 60:02d}m elapsed", rule()]

    # Freshness first. A number nobody can date is not evidence.
    fresh = freshness(conn, business_date)
    if fresh:
        out.append("")
        out.append("DATA FRESHNESS")
        for rep, maxts, lastrun, runs in fresh:
            lag = ""
            try:
                lag = f", {int((end - dt.datetime.strptime(maxts, '%Y-%m-%d %H:%M:%S')).total_seconds() // 60)} min behind the clock"
            except Exception:
                pass
            out.append(f"  {rep:<20} newest order {maxts or 'none'}{lag}"
                       f"   ({runs} pull{'s' if runs != 1 else ''} today)")

    orders, sales, canc_n, canc_v = totals_today(conn, business_date, start, end)
    base = totals_baseline(conn, days, elapsed)
    b_orders = sum(r[1] for r in base) / len(base) if base else None
    b_sales = sum(float(r[2]) for r in base) / len(base) if base else None
    last = base[-1] if base else None

    out += ["", f"TODAY SO FAR   ({start.strftime('%H:%M')} to {end.strftime('%H:%M')})", rule("-")]
    out.append(f"  {'Orders':<14}{orders:>12}"
               + (f"   normal {weekday} {b_orders:>8.0f}   {pct(orders, b_orders)}" if b_orders else ""))
    out.append(f"  {'Sales':<14}{'Rs ' + rupees(sales):>12}"
               + (f"   normal {weekday} {'Rs ' + rupees(b_sales):>8}   {pct(sales, b_sales)}" if b_sales else ""))
    aov = float(sales) / orders if orders else 0
    b_aov = (b_sales / b_orders) if (b_sales and b_orders) else None
    out.append(f"  {'AOV':<14}{'Rs ' + rupees(aov):>12}"
               + (f"   normal {weekday} {'Rs ' + rupees(b_aov):>8}   {pct(aov, b_aov)}" if b_aov else ""))
    crate = (canc_n / (orders + canc_n) * 100) if (orders + canc_n) else 0
    out.append(f"  {'Cancelled':<14}{canc_n:>12}   Rs {rupees(canc_v)}   ({crate:.1f}% of all orders)")

    if last:
        out.append(f"  Last {weekday} ({last[0].strftime('%d %b')}) at this same point: "
                   f"{last[1]} orders, Rs {rupees(last[2])}")
    if days:
        out.append(f"  'Normal {weekday}' is the mean of "
                   + ", ".join(d.strftime("%d %b") for d in days)
                   + ", each cut at the same {}h {:02d}m point.".format(mins // 60, mins % 60))

    # The verdict, because a bare number is not an instruction (locked design rule 5).
    if b_sales:
        gap = (float(sales) - b_sales) / b_sales * 100
        if gap >= 25:
            v = f"WELL AHEAD. Rakhi is landing: {gap:+.0f}% on a normal {weekday}."
        elif gap >= 8:
            v = f"AHEAD by {gap:+.0f}% on a normal {weekday}."
        elif gap >= -8:
            v = f"FLAT. {gap:+.0f}% on a normal {weekday}, inside normal noise."
        else:
            v = f"BEHIND by {gap:.0f}% on a normal {weekday}. Worth a look now, not tonight."
        out += ["", f"  VERDICT: {v}"]
        # Run rate projection: today's slice divided by the baseline's identical
        # slice, applied to the baseline's whole day. Honest arithmetic, but it
        # assumes the rest of today behaves like the rest of a normal day, which on
        # a festival is exactly the assumption most likely to be wrong. Labelled as
        # an estimate every time it is shown (project rule 5).
    # ------------------------------------------------------- where the day lands --
    # Deliberately a RANGE across named reference shapes, not a single number. See
    # shape_anchor: the same morning projects to wildly different days depending on
    # whether today behaves like a normal trading day or like a festival, and at
    # 11am nobody knows which. A single figure here would be false precision.
    anchors = [(f"a normal {weekday}", days)]
    if festival_anchor:
        anchors.append((f"last year's festival ({festival_anchor:%d %b %Y})",
                        [festival_anchor]))
    lines = []
    for label, ref in anchors:
        a = shape_anchor(conn, ref, elapsed)
        if not a or a[0] <= 0:
            continue
        frac, whole, n = a
        lines.append((label, frac, whole, float(sales) / frac))
    if lines:
        out += ["", "WHERE THE DAY LANDS   (estimate, not measurement)", rule("-")]
        for label, frac, whole, proj in lines:
            out.append(f"  If today follows {label:<38} Rs {rupees(proj):>12}")
            out.append(f"     (that day had {frac * 100:.1f}% of its sales in by this point, "
                       f"and finished at Rs {rupees(whole)})")
        lo, hi = min(l[3] for l in lines), max(l[3] for l in lines)
        if hi > lo * 1.15:
            out.append(f"  So: somewhere between Rs {rupees(lo)} and Rs {rupees(hi)}. "
                       f"The spread is the point.")
        out.append("  A festival front loads: gifting is bought in the morning, dinner is not.")
        out.append("  Every figure ABOVE this block is measured. Only this block is estimated.")

    # ------------------------------------------------------------ hour by hour --
    out += ["", "HOUR BY HOUR   (by the hour the order was placed)", rule("-")]
    out.append(f"  {'Hour':<8}{'Orders':>8}{'Sales':>12}{'Running':>12}   "
               f"{'Normal ' + weekday[:3]:>13}{'Diff':>9}")
    hb = hourly_baseline(conn, days)
    running = 0
    for hour, o, s, c, a in hourly_today(conn, business_date, start, end):
        running += float(s)
        bo, bs = hb.get(hour.hour, (None, None))
        part = hour.hour == end.hour
        # The hour in progress holds only `end.minute` minutes of trade, so the
        # baseline it is judged against is cut to the same minutes. Comparing 18
        # minutes of today with a full hour of a normal Friday reads as a collapse
        # when nothing has happened at all.
        if part and bs:
            bs = bs * (end.minute / 60.0)
        out.append(f"  {hour.strftime('%H:%M') + (' *' if part else ''):<8}"
                   f"{o:>8}{rupees(s):>12}{rupees(running):>12}   "
                   + (f"{rupees(bs):>13}{pct(s, bs):>9}" if bs else f"{'-':>13}{'-':>9}"))
    out.append(f"  * the hour still running ({end.minute} min in). Its baseline is cut "
               f"to the same {end.minute} min, so the comparison is like for like.")

    # -------------------------------------------------------------- the splits --
    out += ["", "BY CHANNEL", rule("-")]
    for name, o, s, c in split(conn, business_date, start, end, "order_from"):
        share = float(s) / float(sales) * 100 if sales else 0
        out.append(f"  {name:<24}{o:>7} orders  Rs {rupees(s):>10}  {share:5.1f}% of sales"
                   + (f"   {c} cancelled" if c else ""))

    out += ["", "TOP OUTLETS", rule("-")]
    for name, o, s, c in split(conn, business_date, start, end, "outlet_name", limit=12):
        out.append(f"  {name[:34]:<34}{o:>7} orders  Rs {rupees(s):>10}"
                   + (f"   {c} cancelled" if c else ""))

    items = top_items(conn, business_date, start, end)
    if items:
        out += ["", "TOP ITEMS TODAY   (units sold)", rule("-")]
        for nm, units, val, in_orders in items:
            out.append(f"  {str(nm)[:40]:<40}{int(units or 0):>7} units  "
                       f"Rs {rupees(val):>9}   in {in_orders} orders")
    else:
        out += ["", "TOP ITEMS TODAY: the item feed has nothing stored yet for this day."]

    out += ["", rule()]
    return "\n".join(out)


def shape_anchor(conn, days, elapsed):
    """How much of a finished day was already done at this same point in it.

    This is the whole trick of an honest intraday projection. A normal Friday has
    only about 6 percent of its sales in by 11am because Creme Castle's day is an
    evening day. Raksha Bandhan 2025 had 19 percent in by 11am, because gifting is a
    morning act. Multiplying today's morning by a normal Friday's remaining-day
    curve therefore triples the answer. So the projection is anchored on the SHAPE of
    a named reference day, and more than one shape is shown, because which one today
    turns out to follow is not yet knowable at 11am.

    Returns (fraction_done, whole_day_sales, days_used) or None when the reference
    days are not in the settled table."""
    if not days:
        return None
    with conn.cursor() as cur:
        cur.execute("""
            select coalesce(sum(intraday.money(total)) filter (
                     where status <> 'Cancelled'
                       and intraday.ts(order_date) >= business_date + interval '4 hours'
                       and intraday.ts(order_date) <  business_date + interval '4 hours' + %s), 0),
                   coalesce(sum(intraday.money(total)) filter (where status <> 'Cancelled'), 0),
                   count(distinct business_date)
            from landing.petpooja_online_orders
            where voided_at is null and business_date = any(%s)
        """, (elapsed, days))
        so_far, whole, n = cur.fetchone()
    if not whole or not n:
        return None
    return float(so_far) / float(whole), float(whole) / n, n


def revive(conn):
    """Return a connection that is proven usable: the one given if it still answers,
    a fresh one if it does not."""
    import psycopg2
    try:
        with conn.cursor() as cur:
            cur.execute("select 1")
        return conn
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
        return psycopg2.connect(os.environ["SPINE_DATABASE_URL"])


# ------------------------------------------------------------------------ main --

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="business date (YYYY-MM-DD); default: now, 04:00 rule")
    ap.add_argument("--occasion", default=os.environ.get("PULSE_OCCASION", ""),
                    help="a label kept with the run, e.g. 'Raksha Bandhan'")
    ap.add_argument("--report-only", action="store_true",
                    help="read what is already stored, pull nothing")
    ap.add_argument("--no-items", action="store_true", help="order side only")
    ap.add_argument("--festival-anchor", default=os.environ.get("PULSE_FESTIVAL_ANCHOR", ""),
                    help="a past festival date (YYYY-MM-DD) whose SHAPE is a second "
                         "projection anchor, e.g. 2025-08-09 for last Raksha Bandhan")
    args = ap.parse_args()
    load_env()

    if not os.environ.get("SPINE_DATABASE_URL"):
        sys.exit("SPINE_DATABASE_URL is not set (expected in dashboard/auto/.env)")

    import psycopg2
    business_date = (dt.date.fromisoformat(args.date) if args.date
                     else business_date_now())
    # The config is the default; an explicit flag always wins over it.
    cfg_occasion, cfg_anchor = occasion_for(business_date)
    occasion = args.occasion or cfg_occasion or None
    anchor = (dt.date.fromisoformat(args.festival_anchor) if args.festival_anchor
              else cfg_anchor)
    conn = psycopg2.connect(os.environ["SPINE_DATABASE_URL"])
    errors = []
    try:
        if not args.report_only:
            print(f"pulse for {business_date} at {dt.datetime.now():%H:%M:%S} ...")
            _, _, e1 = pull(conn, "online_orders", business_date, occasion)
            if e1:
                errors.append(e1)
                # pull() may have reconnected inside itself, which does not reach
                # this variable, so the connection is proven again here before the
                # second report is asked to use it. Without this, one flap during
                # the order pull silently takes the item pull down with it.
                conn = revive(conn)
            if not args.no_items:
                _, _, e2 = pull(conn, "order_summary_item", business_date, occasion)
                if e2:
                    errors.append(e2)
                    conn = revive(conn)
        print()
        print(report(conn, business_date, occasion, festival_anchor=anchor))
        if errors:
            print("\nWARNING: this pulse is incomplete, "
                  f"{len(errors)} pull(s) failed:\n  - " + "\n  - ".join(errors))
            print("The figures above are from the last pull that DID succeed, so they "
                  "are older than the clock. Check DATA FRESHNESS above.")
    finally:
        conn.close()
    # Exit codes the wrapper reads:
    #   0  everything pulled
    #   75 a pull deferred on transport; the next hourly slot will heal it, say nothing
    #   1  a real failure that a human has to look at (an expired session, most likely)
    if not errors:
        sys.exit(0)
    if all(is_transport(e) for e in errors):
        print("\nAll of the above are transport failures. The next hourly slot heals "
              "them, so this is not being alerted (F23).")
        sys.exit(75)
    sys.exit(1)


if __name__ == "__main__":
    main()
