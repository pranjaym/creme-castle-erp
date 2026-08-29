"""Supersede loader for the Swiggy Daily-MTD report.

Same contract as workers/zomato-ingest (060) and workers/zomato-business (130):
a re-load never updates a row. A changed row is stamped superseded_at, the
replacement is inserted, then superseded_by is linked. Current state is
superseded_at is null. Nothing is ever deleted (CLAUDE.md rule 6).

Because every daily file restates the whole month, most rows hash unchanged
and are skipped; landing.swiggy_change_log records new/changed/unchanged per
sheet per business day (the restatement evidence, Swiggy edition).

Schema: kitchen/migrations/210_swiggy_daily_mtd.sql
"""
from __future__ import annotations

import os
from datetime import date

import psycopg2
from psycopg2.extras import execute_values

import parse as P

# shape -> (table, natural key columns). dup_seq is part of every key
# (loader contract 3 in the migration header).
SHAPES = {
    "sales":          ("landing.swiggy_sales_daily",
                       ("business_date", "restaurant_id", "dup_seq")),
    "funnel":         ("landing.swiggy_funnel_daily",
                       ("business_date", "restaurant_id", "dup_seq")),
    "ntr_rr":         ("landing.swiggy_ntr_rr_daily",
                       ("business_date", "restaurant_id", "order_type", "dup_seq")),
    "item_feedback":  ("landing.swiggy_item_feedback",
                       ("order_id", "item_name", "dup_seq")),
    "item_sales":     ("landing.swiggy_item_sales",
                       ("order_id", "item_id", "variant_name", "price_per_item", "dup_seq")),
    "outlet_rating":  ("landing.swiggy_outlet_rating_daily",
                       ("business_date", "restaurant_id", "dup_seq")),
    "slot_sales":     ("landing.swiggy_slot_sales",
                       ("business_date", "restaurant_id", "slot", "dup_seq")),
    "ads_slot":       ("landing.swiggy_ads_slot",
                       ("business_date", "restaurant_id", "time_slot", "flag", "dup_seq")),
    "cancellations":  ("landing.swiggy_cancellations",
                       ("order_id", "item_name", "dup_seq")),
    "coupon_orders":  ("landing.swiggy_coupon_orders",
                       ("order_id", "coupon_code", "dup_seq")),
    "serviceability": ("landing.swiggy_serviceability_daily",
                       ("business_date", "restaurant_id", "dup_seq")),
}


def env(key: str, default=None):
    v = os.environ.get(key, default)
    if v is None:
        raise RuntimeError(f"missing env {key}")
    return v


def load_env_file(path):
    if not os.path.exists(path):
        return
    for line in open(path):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k, v.strip().strip('"').strip("'"))


def connect():
    return psycopg2.connect(env("SPINE_DATABASE_URL"), connect_timeout=30)


def open_run(cur, window_from, window_to, raw_path=None, sha=None):
    cur.execute(
        """insert into landing.ingest_runs
             (source_system, report_key, window_from, window_to, raw_file_path, sha256, status)
           values ('swiggy', 'daily_mtd', %s, %s, %s, %s, 'started') returning id""",
        (window_from, window_to, raw_path, sha))
    return cur.fetchone()[0]


def close_run(cur, run_id, row_count, status="loaded", note=None):
    cur.execute(
        """update landing.ingest_runs
              set status=%s, row_count=%s, note=%s, finished_at=now() where id=%s""",
        (status, row_count, note, run_id))


def already_loaded(cur, sha):
    cur.execute("""select id from landing.ingest_runs
                    where source_system='swiggy' and report_key='daily_mtd'
                      and sha256=%s and status='loaded' limit 1""", (sha,))
    rec = cur.fetchone()
    return rec[0] if rec else None


def load_shape(cur, shape, rows, run_id, pull_date=None):
    """Insert-or-supersede `rows` into the table for `shape`.
    Returns (new, changed, unchanged)."""
    table, key_cols = SHAPES[shape]
    if not rows:
        return 0, 0, 0
    pull_date = pull_date or date.today()

    data_cols = [c for c in rows[0] if not c.startswith("_")]
    for r in rows:
        missing = set(data_cols) - set(r)
        if missing:
            raise RuntimeError(f"{shape}: row missing columns {sorted(missing)[:5]}")

    cur.execute(f"select id, row_hash, {', '.join(key_cols)} from {table} where superseded_at is null")
    current = {tuple(str(x) for x in rec[2:]): (rec[0], rec[1]) for rec in cur.fetchall()}

    to_insert, to_supersede, unchanged = [], [], 0
    per_day = {}
    for r in rows:
        h = P.row_hash(r)
        k = tuple(str(r[c]) for c in key_cols)
        bucket = per_day.setdefault(r.get("business_date"), [0, 0, 0])
        prev = current.get(k)
        if prev is None:
            to_insert.append((r, h, None)); bucket[0] += 1
        elif prev[1] != h:
            to_supersede.append(prev[0]); to_insert.append((r, h, prev[0])); bucket[1] += 1
        else:
            unchanged += 1; bucket[2] += 1

    if to_supersede:
        execute_values(cur, f"update {table} t set superseded_at = now() "
                            f"from (values %s) as v(id) where t.id = v.id::bigint",
                       [(i,) for i in to_supersede])

    if to_insert:
        cols = data_cols + ["ingest_run_id", "row_hash"]
        collist = ", ".join(cols)
        values = [tuple([r[c] for c in data_cols] + [run_id, h]) for r, h, _ in to_insert]
        # fetch=True so ids come back across ALL pages, not just the last one
        returned = execute_values(cur,
                                  f"insert into {table} ({collist}) values %s returning id",
                                  values, page_size=500, fetch=True)
        new_ids = [x[0] for x in returned]
        links = [(old, nid) for (_, _, old), nid in zip(to_insert, new_ids) if old is not None]
        if links:
            execute_values(cur, f"update {table} t set superseded_by = v.new_id::bigint "
                                f"from (values %s) as v(old_id, new_id) where t.id = v.old_id::bigint",
                           links)

    for bday, (n, c, u) in per_day.items():
        cur.execute(
            """insert into landing.swiggy_change_log
                 (ingest_run_id, report_sheet, pull_date, business_date,
                  new_rows, changed_rows, unchanged_rows)
               values (%s,%s,%s,%s,%s,%s,%s)""",
            (run_id, shape, pull_date, bday, n, c, u))

    return len(to_insert) - len(to_supersede), len(to_supersede), unchanged
