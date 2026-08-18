#!/usr/bin/env python3
"""
Zomato Order Details loader: parses an Order history / Customer details export
(zip-of-CSV, or the xlsx shape large manual ranges come in) and lands it in
landing.zomato_order_details with SUPERSEDE semantics.

Unlike the Petpooja landing tables (insert-if-new by row_hash), Zomato orders keep
mutating after the order day (status, ratings, reviews, complaints, phones), so:
  * current state  = rows where superseded_at is null, one per zomato_order_id
    (superseded_at frees the slot first; superseded_by links lineage after);
  * a re-pulled order whose content changed gets a NEW row, and the old row is
    stamped superseded_by/superseded_at (full revision history, nothing deleted);
  * an unchanged order is left alone (row_hash match).

row_hash rules (must match migration 060, never change silently):
  * the 30 raw columns EXCEPT kpt_duration_minutes (F19: KPT flaps between export
    runs and would supersede every row every evening for nothing);
  * items_in_order canonicalised (split on ', ', sorted) for hashing only;
  * customer_phone cleaned of trailing control bytes before hashing AND storing.

Every pull also writes landing.zomato_change_log (new/changed/unchanged per order
date), the measurement that will justify shrinking the 7-day window (feed doc s.6).

Run:
  python3 ingest.py --file order_history_20260728_20260803.zip
  python3 ingest.py --file "Zomato Order Details.xlsx" --dry-run
Env (real load only): SPINE_DATABASE_URL, SPINE_SUPABASE_URL,
  SPINE_SUPABASE_SERVICE_ROLE_KEY, SPINE_STORAGE_BUCKET_ZOMATO (default zomato-raw).
"""
import argparse
import csv
import datetime as dt
import hashlib
import io
import os
import re
import sys
import time
import zipfile

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

# Export header -> column, in export order (verified 4 Aug 2026 on both the CSV and
# xlsx shapes; the two are identical except encoding quality, CSV is cleaner).
COL_MAP = [
    ("Restaurant ID", "restaurant_id"),
    ("Restaurant name", "restaurant_name"),
    ("Subzone", "subzone"),
    ("City", "city"),
    ("Order ID", "zomato_order_id"),
    ("Order Placed At", "order_placed_at_raw"),
    ("Order Status", "order_status"),
    ("Delivery", "delivery"),
    ("Distance", "distance"),
    ("Items in order", "items_in_order"),
    ("Instructions", "instructions"),
    ("Discount construct", "discount_construct"),
    ("Bill subtotal", "bill_subtotal"),
    ("Packaging charges", "packaging_charges"),
    ("Restaurant discount (Promo)", "restaurant_discount_promo"),
    ("Restaurant discount (Flat offs, Freebies & others)", "restaurant_discount_flat"),
    ("Gold discount", "gold_discount"),
    ("Brand pack discount", "brand_pack_discount"),
    ("Total", "total"),
    ("Rating", "rating"),
    ("Review", "review"),
    ("Cancellation / Rejection reason", "cancellation_rejection_reason"),
    ("Restaurant compensation (Cancellation)", "restaurant_compensation_cancellation"),
    ("Restaurant penalty (Rejection)", "restaurant_penalty_rejection"),
    ("KPT duration (minutes)", "kpt_duration_minutes"),
    ("Rider wait time (minutes)", "rider_wait_minutes"),
    ("Order Ready Marked", "order_ready_marked"),
    ("Customer complaint tag", "customer_complaint_tag"),
    ("Customer ID", "customer_id"),
    ("Customer Phone", "customer_phone"),
]
COLS = [c for _, c in COL_MAP]
HASH_COLS = [c for c in COLS if c != "kpt_duration_minutes"]


def env(k, required=True):
    v = os.environ.get(k)
    if required and not v:
        sys.exit(f"{k} is not set")
    return v


def _clean(v):
    """Normalise one raw cell: None for blanks, strip whitespace and control bytes
    (Customer Phone ends in repeated 0x14 in the real exports), keep everything else
    verbatim. Numbers stay text; the landing zone is raw fidelity."""
    if v is None:
        return None
    s = str(v).strip()
    s = "".join(ch for ch in s if ch >= " " or ch in "\n\t")
    s = s.strip()
    if s == "" or s.lower() == "nan":
        return None
    return s


def parse_placed_at(raw):
    """'12:00 AM, January 01 2026' -> aware IST datetime, else None (never guessed)."""
    if not raw:
        return None
    try:
        return dt.datetime.strptime(raw.strip(), "%I:%M %p, %B %d %Y").replace(tzinfo=IST)
    except ValueError:
        return None


def canonical_items(s):
    """Sort the item list for hashing: Zomato reorders it between export runs
    (verified: 427 of 2,368 rows differed by order alone, 0 after sorting)."""
    if not s:
        return ""
    return " | ".join(sorted(part.strip() for part in s.split(",")))


def row_hash(rec):
    parts = []
    for c in HASH_COLS:
        v = rec.get(c)
        if c == "items_in_order":
            v = canonical_items(v)
        parts.append("" if v is None else str(v))
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()


def _rows_from_file(path):
    """Yield dict rows from a zip-of-CSV, a bare CSV, or an xlsx export."""
    lower = path.lower()
    if lower.endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            names = [n for n in z.namelist() if n.lower().endswith(".csv")]
            if not names:
                raise ValueError(f"no CSV inside {path}")
            with z.open(names[0]) as f:
                text = io.TextIOWrapper(f, encoding="utf-8-sig", errors="replace")
                yield from csv.DictReader(text)
    elif lower.endswith(".csv"):
        with open(path, newline="", encoding="utf-8-sig", errors="replace") as f:
            yield from csv.DictReader(f)
    elif lower.endswith((".xlsx", ".xls")):
        import pandas as pd
        df = pd.read_excel(path, dtype=str)
        for _, row in df.iterrows():
            yield {k: (None if pd.isna(v) else v) for k, v in row.items()}
    else:
        raise ValueError(f"unrecognised export file type: {path}")


def parse_export(path):
    """Returns (records, skipped, in_file_dupes). One record per order: an order id
    seen twice in one file keeps the LAST occurrence (the 7-month sample had exactly
    one such duplicate). A row with no parseable timestamp or no order id is skipped
    and counted, never guessed."""
    by_id, order, skipped, dupes = {}, [], 0, 0
    for raw in _rows_from_file(path):
        rec = {col: _clean(raw.get(src)) for src, col in COL_MAP}
        placed = parse_placed_at(rec.get("order_placed_at_raw"))
        oid = rec.get("zomato_order_id")
        if not oid or placed is None:
            skipped += 1
            continue
        rec["order_placed_at"] = placed
        rec["order_date"] = placed.date()
        rec["row_hash"] = row_hash(rec)
        if oid in by_id:
            dupes += 1
        else:
            order.append(oid)
        by_id[oid] = rec
    return [by_id[o] for o in order], skipped, dupes


def _pin_to_ipv4():
    """Force outbound HTTP to IPv4.

    F22, 17 Aug 2026: the customer_details receipt upload died with OSError 49
    (EADDRNOTAVAIL) one second after the order_history upload had succeeded over
    the same host. This network answers with NAT64 addresses (64:ff9b::/96), so
    Supabase is reached over IPv6, and the moment the Mac has no usable IPv6
    source address connect() cannot even start. Supabase Storage sits behind
    Cloudflare and always publishes A records, so IPv4 is the safe path. Same
    family of trouble as F15 (direct db host IPv6-only, hence the pooler).
    Off switch: CC_FORCE_IPV4=0 restores the default dual-stack behaviour.
    """
    if os.environ.get("CC_FORCE_IPV4", "1") == "0":
        return
    try:
        import urllib3.util.connection as urllib3_conn
        urllib3_conn.HAS_IPV6 = False
    except Exception:
        pass          # never let a hardening tweak be the thing that fails


def store_receipt(path, max_retries=3, retry_wait_s=10):
    """Upload the raw export to Storage as an immutable receipt (sha256 named).

    Retried and timed out, because this used to be the one network call in the
    worker with a single attempt and no deadline: the scraper retries twice and
    the wrapper has a network gate, but a one-second flap here lost a whole
    export (F22), and with no timeout a stalled upload could hang the slot.
    """
    import requests
    _pin_to_ipv4()
    with open(path, "rb") as f:
        blob = f.read()
    sha = hashlib.sha256(blob).hexdigest()
    bucket = os.environ.get("SPINE_STORAGE_BUCKET_ZOMATO", "zomato-raw")
    storage_path = f"{dt.date.today()}/{sha}-{os.path.basename(path)}"
    url = f"{env('SPINE_SUPABASE_URL')}/storage/v1/object/{bucket}/{storage_path}"
    key = env("SPINE_SUPABASE_SERVICE_ROLE_KEY")
    headers = {
        "Authorization": f"Bearer {key}", "apikey": key,
        "Content-Type": "application/octet-stream", "x-upsert": "true",
    }
    for attempt in range(1, max_retries + 1):
        try:
            resp = requests.post(url, data=blob, headers=headers, timeout=(10, 180))
            resp.raise_for_status()
            break
        except requests.exceptions.RequestException as e:
            # A 4xx is a real problem (wrong key, missing bucket) and retrying it
            # only delays the alert; transport failures and 5xx deserve another go.
            status = getattr(getattr(e, "response", None), "status_code", None)
            if attempt == max_retries or (status is not None and status < 500):
                raise
            print(f"receipt upload attempt {attempt}/{max_retries} failed "
                  f"({type(e).__name__}: {str(e)[:120]}); retrying in {retry_wait_s}s")
            time.sleep(retry_wait_s)
    print(f"receipt stored: {sha[:12]}… -> {bucket}/{storage_path}")
    return sha, f"{bucket}/{storage_path}"


def load_records(records, skipped, dupes, conn, receipt, report_key="order_history"):
    """Supersede-aware load. Returns (new, changed, unchanged)."""
    from psycopg2.extras import execute_values
    sha, storage_path = receipt if receipt else (None, None)
    days = [r["order_date"] for r in records]
    lo, hi = (min(days), max(days)) if days else (None, None)

    cur = conn.cursor()
    cur.execute(
        "insert into landing.ingest_runs "
        "(source_system, report_key, window_from, window_to, raw_file_path, sha256, status) "
        "values ('zomato', %s, %s, %s, %s, %s, 'started') returning id",
        (report_key, lo, hi, storage_path, sha))
    run_id = cur.fetchone()[0]

    # Current rows for every order in this pull, one round trip.
    ids = [r["zomato_order_id"] for r in records]
    current = {}
    if ids:
        cur.execute(
            "select zomato_order_id, id, row_hash from landing.zomato_order_details "
            "where superseded_at is null and zomato_order_id = any(%s)", (ids,))
        current = {oid: (rid, h) for oid, rid, h in cur.fetchall()}

    to_insert, to_supersede = [], []   # to_supersede: (old_id, position in to_insert)
    stats = {}                          # order_date -> [new, changed, unchanged]
    for r in records:
        st = stats.setdefault(r["order_date"], [0, 0, 0])
        cur_row = current.get(r["zomato_order_id"])
        if cur_row is None:
            st[0] += 1
            to_insert.append(r)
        elif cur_row[1] != r["row_hash"]:
            st[1] += 1
            to_supersede.append((cur_row[0], len(to_insert)))
            to_insert.append(r)
        else:
            st[2] += 1

    # Order matters (uq_zomato_order_current is partial on superseded_at is null):
    # 1. stamp the outgoing rows superseded_at, freeing each order's current slot;
    # 2. insert the replacement rows;
    # 3. link lineage (superseded_by) now that the new ids exist.
    # All one transaction, so no reader ever sees a gap or a double.
    if to_supersede:
        cur.execute(
            "update landing.zomato_order_details set superseded_at = now() "
            "where id = any(%s)", ([old_id for old_id, _ in to_supersede],))

    inserted_ids = []
    if to_insert:
        insert_sql = (
            f"insert into landing.zomato_order_details "
            f"(ingest_run_id, order_date, order_placed_at, {', '.join(COLS)}, row_hash) "
            f"values %s returning id")
        payload = [[run_id, r["order_date"], r["order_placed_at"],
                    *[r.get(c) for c in COLS], r["row_hash"]] for r in to_insert]
        inserted_ids = [row[0] for row in
                        execute_values(cur, insert_sql, payload, page_size=1000, fetch=True)]

    if to_supersede:
        pairs = [(old_id, inserted_ids[pos]) for old_id, pos in to_supersede]
        execute_values(cur,
                       "update landing.zomato_order_details t "
                       "set superseded_by = v.new_id "
                       "from (values %s) as v(old_id, new_id) where t.id = v.old_id",
                       pairs, page_size=1000)

    # Settling-horizon measurement: one row per order date in this pull.
    today = dt.date.today()
    execute_values(cur,
                   "insert into landing.zomato_change_log "
                   "(ingest_run_id, pull_date, order_date, new_rows, changed_rows, "
                   "unchanged_rows) values %s",
                   [[run_id, today, d, s[0], s[1], s[2]] for d, s in sorted(stats.items())])

    new = sum(s[0] for s in stats.values())
    changed = sum(s[1] for s in stats.values())
    unchanged = sum(s[2] for s in stats.values())
    cur.execute(
        "update landing.ingest_runs set status='loaded', row_count=%s, finished_at=now(), "
        "note=%s where id=%s",
        (new + changed,
         f"new={new} changed={changed} unchanged={unchanged} "
         f"skipped={skipped} in_file_dupes={dupes}", run_id))
    conn.commit()
    print(f"{report_key}: {new} new, {changed} superseded, {unchanged} unchanged "
          f"(of {len(records)} orders; {skipped} skipped, {dupes} in-file dupes). "
          f"run_id={run_id}")
    return new, changed, unchanged


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", required=True)
    ap.add_argument("--report-key", default="order_history",
                    choices=["order_history", "customer_details"])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    records, skipped, dupes = parse_export(args.file)
    days = sorted({r["order_date"] for r in records})
    if args.dry_run:
        phones = sum(1 for r in records if r.get("customer_phone"))
        print(f"[dry-run] {args.file}")
        print(f"  orders parsed:  {len(records)} ({skipped} skipped, {dupes} in-file dupes)")
        print(f"  order dates:    {days[0] if days else '-'} .. {days[-1] if days else '-'}")
        print(f"  with phone:     {phones}")
        print("  no database connection opened, nothing written.")
        return

    receipt = store_receipt(args.file)
    import psycopg2
    conn = psycopg2.connect(env("SPINE_DATABASE_URL"))
    try:
        load_records(records, skipped, dupes, conn, receipt, args.report_key)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
