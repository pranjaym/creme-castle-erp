#!/usr/bin/env python3
"""
Daily spine sync with self-verification (built 25 Jul 2026).

Re-pulls the last few business days from Petpooja and PROVES the spine matches.
Petpooja amends data after the fact (measured: 5% of one day's orders changed
between a 23 Jul and a 25 Jul pull), and an 8am scrape can catch a bad backend
moment. Checking T-1, T-2 and T-3 every morning means each business day is
independently confirmed three times before we trust it.

How it stays cheap (Pranjay's requirement: do not bloat the data):
  1. FINGERPRINT FIRST. Per (report, business day) we keep a row count + checksum.
     If a fresh pull matches, the day is confirmed and nothing else happens. Most
     mornings this is all that runs.
  2. Only on a mismatch do we diff row by row, matching on the natural key:
       new row      -> insert
       changed row  -> CORRECT IN PLACE, and log which fields changed
       missing row  -> void (never delete)
     So the tables hold one row per real order forever; only genuine corrections
     cost anything.
  3. Comparison is NORMALISED, so formatting noise is not mistaken for change.
     (Raw text flagged 292 rows on 22 Jul; normalised, only 176 truly changed.)

Usage (needs SPINE_DATABASE_URL, SPINE_SUPABASE_* like the other workers):
    python3 sync.py --days 3                 # scrape and verify the last 3 days
    python3 sync.py --days 3 --report online_orders
    python3 sync.py --file <path> --report online_orders   # verify from a file
"""
import argparse
import datetime as dt
import hashlib
import re
from decimal import Decimal, InvalidOperation

import psycopg2
from psycopg2.extras import execute_values

import ingest

# ---------------------------------------------------------------- config

SYNC_REPORTS = {
    "online_orders": {
        "table": "landing.petpooja_online_orders",
        "cols": ingest.ONLINE_COLS,
        "key_cols": ["aggregator_order_no"],
        # Changes worth telling a human about. Everything else is corrected
        # silently (e.g. a payment_type label being enriched later).
        "material": {"status", "my_amount", "total", "aggregator_discount",
                     "outlet_discount", "delivery_charges", "container_charges",
                     "additional_charge", "order_type", "outlet_name"},
        "window_days": 5,      # Petpooja caps this report's export range
    },
    "order_summary_item": {
        "table": "landing.petpooja_order_summary_item",
        "cols": ingest.ITEM_COLS,
        "key_cols": ["restaurant_name", "invoice_no", "item_name", "item_price",
                     "item_quantity"],
        "material": {"status", "my_amount", "total", "discount", "total_tax",
                     "delivery_charge", "container_charge", "item_total",
                     "item_quantity", "item_price", "item_name"},
        "window_days": 7,
    },
}


# ---------------------------------------------------------------- normalising

_WS = re.compile(r"\s+")
_DATE_FORMATS = ("%Y-%m-%d %H:%M:%S", "%d %b %Y", "%Y-%m-%d", "%d/%m/%Y")


def _canonical_number(s):
    """Full-precision canonical number, or None if not numeric.

    NEVER use float formatting here. A 15-digit aggregator order number like
    243712451100181 becomes '2.43712e+14' under %g, which silently collapses
    thousands of distinct orders onto one value. Decimal keeps every digit and
    only strips meaningless trailing zeros ('579.0' -> '579')."""
    try:
        d = Decimal(s)
    except (InvalidOperation, ValueError):
        return None
    if d == 0:
        return "0"
    d = d.normalize()
    return format(d, "f")          # plain notation, never an exponent


def key_norm(v):
    """Normalising for NATURAL KEY parts. Whitespace and float-artifact tolerant
    ('8761.0' -> '8761'), but never lossy: identity must be preserved exactly."""
    if v is None:
        return ""
    s = _WS.sub(" ", str(v)).strip()
    if s in ("nan", "None"):
        return ""
    n = _canonical_number(s)
    return n if n is not None else s


def normalise(v):
    """One canonical form for VALUE comparison, so cosmetic differences are not
    mistaken for real change. Verified against two real pulls of the same day: this
    removes date-format, whitespace and zero-vs-blank noise, leaving true changes."""
    if v is None:
        return ""
    s = _WS.sub(" ", str(v)).strip()
    if s in ("nan", "None", "-"):
        return ""
    for fmt in _DATE_FORMATS:
        try:
            return dt.datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    n = _canonical_number(s)
    if n is not None:
        return "" if n == "0" else n   # 0, 0.0 and blank all mean nothing
    return s


def day_checksum(rows, cols):
    """Order-independent fingerprint of one business day: md5 over the sorted,
    normalised rows. Two pulls of an unchanged day produce the same value."""
    lines = sorted("\x1f".join(normalise(r.get(c)) for c in cols) for r in rows)
    return hashlib.md5("\x1e".join(lines).encode("utf-8")).hexdigest()


def key_of(rec, key_cols):
    """The natural key. Uses key_norm (lossless), never the value normaliser."""
    return "|".join(key_norm(rec.get(c)) for c in key_cols)


def keyed_map(records, key_cols, get):
    """Build {key: record}, disambiguating genuine duplicates.

    A source file can legitimately repeat an identical line (the same item, price
    and quantity twice on one invoice: seen on 24 Jul). Those rows are real and must
    not collapse into one, so the second occurrence becomes '<key>#2', the third
    '#3', and so on. Because both sides are built in a stable order, the Nth
    duplicate in the source lines up with the Nth in the spine."""
    out, seen = {}, {}
    for r in records:
        rec = get(r)
        k = key_of(rec, key_cols)
        n = seen.get(k, 0) + 1
        seen[k] = n
        out[k if n == 1 else f"{k}#{n}"] = rec
    return out


# ---------------------------------------------------------------- window logic

def fully_covered_days(days_present):
    """Given the business days present in a downloaded file, return the ones we may
    JUDGE (correct and void against). A business day D runs 04:00 D to 03:59 D+1
    under the spine rule, so the FIRST day in any pull is missing its early hours
    and the LAST day is missing its tail. Both boundaries are therefore incomplete
    and only the days strictly between them are safe to judge.

    This is not theoretical: a pull of 22 to 25 July carried 3,194 fewer rows for
    business day 21 than the spine held, purely because the window started after
    that day began. Judging it would have voided real orders."""
    days = sorted(days_present)
    return set(days[1:-1]) if len(days) >= 3 else set()


# ---------------------------------------------------------------- the sync

def _fetch_spine_day(cur, spec, business_date):
    """Current (non voided) spine rows for one day, keyed the same way as the source.
    Ordered by id so duplicate-line numbering is stable across runs."""
    cols = spec["cols"]
    cur.execute(
        f"select id, {', '.join(cols)} from {spec['table']} "
        f"where business_date = %s and voided_at is null order by id", (business_date,))
    rows = cur.fetchall()

    def build(row):
        rec = dict(zip(cols, row[1:]))
        rec["_id"] = row[0]
        return rec

    return keyed_map(rows, spec["key_cols"], build)


def sync_day(cur, report, spec, business_date, source_recs, run_id, partial=False):
    """Verify (and if needed correct) one business day. Returns a summary dict.

    partial=True means this day is only partly inside the pull window (the first or
    last day of the file). Then we ONLY insert rows we have never seen: no
    corrections, no voids, no fingerprint, because the source is not the whole day
    and must never be treated as the truth about it."""
    cols = spec["cols"]
    src = keyed_map(source_recs, spec["key_cols"],
                    lambda r: dict(zip(cols, r["values"])))

    # GUARD 1: every source row must survive into the keyed map. keyed_map numbers
    # genuine duplicate lines, so this can now only trip if the key itself is broken
    # (as a lossy numeric key once was here: 15-digit order numbers collapsed under
    # float formatting). Refuse to touch the day rather than corrupt it.
    if len(src) != len(source_recs):
        return {"verdict": "aborted_key_collision", "src": len(source_recs),
                "spine": None, "inserted": 0, "corrected": 0, "voided": 0,
                "material": 0, "verify_count": 0,
                "note": f"{len(source_recs) - len(src)} source rows share a natural key"}

    # A partial day: insert anything genuinely new, then stop. Never judge it.
    if partial:
        spine = _fetch_spine_day(cur, spec, business_date)
        new_keys = [k for k in src if k not in spine]
        if new_keys:
            payload = [[run_id, business_date, *[src[k].get(c) for c in cols],
                        ingest.row_hash([business_date] + [src[k].get(c) for c in cols])]
                       for k in new_keys]
            execute_values(cur,
                f"insert into {spec['table']} (ingest_run_id, business_date, "
                f"{', '.join(cols)}, row_hash) values %s on conflict do nothing",
                payload, page_size=1000)
        return {"verdict": "partial", "src": len(src), "spine": len(spine),
                "inserted": len(new_keys), "corrected": 0, "voided": 0,
                "material": 0, "verify_count": 0}

    checksum = day_checksum(list(src.values()), cols)

    # 1. Fingerprint check: if it matches, the day is confirmed. No row work.
    cur.execute("select row_count, checksum, verify_count from "
                "landing.spine_day_fingerprints where report_key=%s and business_date=%s",
                (report, business_date))
    fp = cur.fetchone()
    if fp and fp[1] == checksum and fp[0] == len(src):
        cur.execute("update landing.spine_day_fingerprints set last_verified_at=now(), "
                    "verify_count=verify_count+1 where report_key=%s and business_date=%s",
                    (report, business_date))
        cur.execute(f"update {spec['table']} set last_verified_at=now(), "
                    f"verify_count=verify_count+1 where business_date=%s and voided_at is null",
                    (business_date,))
        return {"verdict": "confirmed", "src": len(src), "spine": fp[0],
                "inserted": 0, "corrected": 0, "voided": 0, "material": 0,
                "verify_count": fp[2] + 1}

    # 2. Fingerprint differs (or first sight): diff row by row on the natural key.
    spine = _fetch_spine_day(cur, spec, business_date)
    first_load = not spine

    # GUARD 2: a correct re-pull of a settled day should never wipe out a large
    # slice of it. If the source is missing more than a small share of what the
    # spine holds, the pull is more likely truncated than the data genuinely gone.
    # Refuse and report, rather than void en masse.
    if spine:
        missing = [k for k in spine if k not in src]
        if len(missing) > max(25, int(0.05 * len(spine))):
            return {"verdict": "aborted_mass_void", "src": len(src),
                    "spine": len(spine), "inserted": 0, "corrected": 0, "voided": 0,
                    "material": 0, "verify_count": 0,
                    "note": f"{len(missing)} of {len(spine)} spine rows absent from the "
                            f"pull; treating the pull as incomplete"}

    inserted = corrected = voided = material = 0
    changes = []

    new_keys = [k for k in src if k not in spine]
    if new_keys:
        payload = [[run_id, business_date, *[src[k].get(c) for c in cols],
                    ingest.row_hash([business_date] + [src[k].get(c) for c in cols])]
                   for k in new_keys]
        execute_values(cur,
            f"insert into {spec['table']} (ingest_run_id, business_date, "
            f"{', '.join(cols)}, row_hash) values %s "
            f"on conflict do nothing", payload, page_size=1000)
        inserted = len(new_keys)
        if not first_load:
            changes += [(run_id, report, business_date, k, "inserted", None, None, None, True)
                        for k in new_keys]

    for k, s in src.items():
        d = spine.get(k)
        if not d:
            continue
        diffs = [c for c in cols if normalise(s.get(c)) != normalise(d.get(c))]
        if not diffs:
            cur.execute(f"update {spec['table']} set last_verified_at=now(), "
                        f"verify_count=verify_count+1 where id=%s", (d["_id"],))
            continue
        sets = ", ".join(f"{c}=%s" for c in diffs)
        cur.execute(f"update {spec['table']} set {sets}, last_verified_at=now(), "
                    f"verify_count=verify_count+1 where id=%s",
                    [s.get(c) for c in diffs] + [d["_id"]])
        corrected += 1
        for c in diffs:
            is_mat = c in spec["material"]
            material += 1 if is_mat else 0
            changes.append((run_id, report, business_date, k, "corrected", c,
                            str(d.get(c))[:500], str(s.get(c))[:500], is_mat))

    for k, d in spine.items():
        if k in src:
            continue
        cur.execute(f"update {spec['table']} set voided_at=now(), "
                    f"void_reason='absent from a later verified pull' where id=%s", (d["_id"],))
        voided += 1
        material += 1
        changes.append((run_id, report, business_date, k, "voided", None, None, None, True))

    if changes:
        execute_values(cur,
            "insert into landing.spine_row_changes (ingest_run_id, report_key, business_date, "
            "natural_key, change_type, column_name, old_value, new_value, is_material) values %s",
            changes, page_size=1000)

    cur.execute(
        "insert into landing.spine_day_fingerprints "
        "(report_key, business_date, row_count, checksum, last_changed_at) "
        "values (%s,%s,%s,%s, case when %s then null else now() end) "
        "on conflict (report_key, business_date) do update set "
        "row_count=excluded.row_count, checksum=excluded.checksum, "
        "last_verified_at=now(), verify_count=landing.spine_day_fingerprints.verify_count+1, "
        "last_changed_at=case when %s then landing.spine_day_fingerprints.last_changed_at "
        "else now() end",
        (report, business_date, len(src), checksum, first_load, first_load))

    if first_load:
        verdict = "first_load"
    elif inserted or corrected or voided:
        verdict = "corrected"
    else:
        # Nothing differed: the day is confirmed. (Reached when there was no stored
        # fingerprint yet, so the fast path could not run, but the diff found no change.)
        verdict = "confirmed"
    return {"verdict": verdict,
            "src": len(src), "spine": len(spine), "inserted": inserted,
            "corrected": corrected, "voided": voided, "material": material,
            "verify_count": 1}


def sync_file(conn, report, path, run_id=None):
    """Verify every fully covered business day found in one downloaded report file."""
    spec = SYNC_REPORTS[report]
    records, skipped = ingest.REPORTS[report]["parse"](path)
    if not records:
        print(f"{report}: file parsed to 0 rows, nothing to verify.")
        return []

    by_day = {}
    for r in records:
        by_day.setdefault(r["business_date"], []).append(r)
    lo, hi = min(by_day), max(by_day)
    judgeable = fully_covered_days(by_day.keys())

    cur = conn.cursor()
    if run_id is None:
        cur.execute("insert into landing.ingest_runs (source_system, report_key, "
                    "window_from, window_to, status) values ('petpooja',%s,%s,%s,'started') "
                    "returning id", (report, lo, hi))
        run_id = cur.fetchone()[0]

    results = []
    for day in sorted(by_day):
        r = sync_day(cur, report, spec, day, by_day[day], run_id,
                     partial=(day not in judgeable))
        cur.execute(
            "insert into landing.spine_daily_checks (ingest_run_id, report_key, business_date, "
            "verdict, rows_in_source, rows_in_spine, rows_inserted, rows_corrected, "
            "rows_voided, material_changes) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (run_id, report, day, r["verdict"], r["src"], r["spine"], r["inserted"],
             r["corrected"], r["voided"], r["material"]))
        r["business_date"] = day
        r["report"] = report
        results.append(r)
        mark = {"confirmed": "OK", "corrected": "CORRECTED", "first_load": "NEW",
                "partial": "PARTIAL", "aborted_key_collision": "ABORTED",
                "aborted_mass_void": "ABORTED"}[r["verdict"]]
        if r["verdict"].startswith("aborted"):
            print(f"  {day}: {mark}  {r['note']}  (spine left untouched)")
        elif r["verdict"] == "partial":
            print(f"  {day}: PARTIAL  boundary day, {r['inserted']} new row(s) added, "
                  f"not judged")
        else:
            extra = ""
            if r["verdict"] != "confirmed":
                extra = (f"  (+{r['inserted']} new, {r['corrected']} corrected, "
                         f"{r['voided']} voided, {r['material']} material)")
            print(f"  {day}: {mark}  source={r['src']} spine={r['spine']}"
                  f" verified x{r['verify_count']}{extra}")

    cur.execute("update landing.ingest_runs set status='loaded', finished_at=now() "
                "where id=%s", (run_id,))
    conn.commit()
    return results


def sync_report(conn, report, days):
    """Scrape the last `days` days for one report and verify them into the spine."""
    from scrape import scrape_and_download
    spec = SYNC_REPORTS[report]
    today = dt.date.today()
    days = min(days, spec["window_days"] - 1)   # leave room for the +1 boundary day
    frm = (today - dt.timedelta(days=days)).isoformat()
    to = today.isoformat()
    print(f"\n[{report}] pulling {frm} .. {to}")
    path = scrape_and_download(report, from_date=frm, to_date=to, max_retries=1)
    return sync_file(conn, report, path)


def summarise(results):
    """One-line human summary, and the material changes worth surfacing."""
    if not results:
        return "no days verified", []
    conf = [r for r in results if r["verdict"] == "confirmed"]
    corr = [r for r in results if r["verdict"] == "corrected"]
    new = [r for r in results if r["verdict"] == "first_load"]
    abort = [r for r in results if r["verdict"].startswith("aborted")]
    bits = []
    if conf: bits.append(f"{len(conf)} day(s) confirmed unchanged")
    if corr: bits.append(f"{len(corr)} day(s) corrected")
    if new: bits.append(f"{len(new)} day(s) newly loaded")
    if bits and abort: bits.append(f"{len(abort)} day(s) ABORTED, needs a look")
    elif abort: bits.append(f"{len(abort)} day(s) ABORTED, needs a look")
    material = [r for r in results if r["material"] > 0 and r["verdict"] == "corrected"]
    return "; ".join(bits), material


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=4,
                    help="calendar days back to re-pull (default 4). The first and "
                         "last business day in a pull are always incomplete, so a "
                         "4-day pull fully verifies 3 business days.")
    ap.add_argument("--report", default="both",
                    choices=["both", "online_orders", "order_summary_item"])
    ap.add_argument("--file", help="verify from an already downloaded file instead of scraping")
    args = ap.parse_args()

    conn = psycopg2.connect(ingest.env("SPINE_DATABASE_URL"))
    try:
        results = []
        if args.file:
            if args.report == "both":
                raise SystemExit("--file needs an explicit --report")
            results = sync_file(conn, args.report, args.file)
        else:
            reports = (["online_orders", "order_summary_item"]
                       if args.report == "both" else [args.report])
            for rep in reports:
                results += sync_report(conn, rep, args.days)
        line, material = summarise(results)
        print(f"\nspine sync: {line}")
        for r in material:
            print(f"  MATERIAL: {r['report']} {r['business_date']}: "
                  f"{r['material']} meaningful change(s)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
