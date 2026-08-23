"""Supersede loader for the Zomato enterprise business reports.

Same contract as workers/zomato-ingest (migration 060): a re-pull never updates a
row. A changed row is stamped superseded_at, the replacement is inserted, then
superseded_by is linked. Current state is superseded_at is null. Nothing is ever
deleted (CLAUDE.md rule 6).

Schema: kitchen/migrations/130_zomato_business_reports.sql
"""
from __future__ import annotations

import os
from datetime import date

import psycopg2
from psycopg2.extras import execute_values

import parse as P

# natural key -> the columns that identify one logical row in each table
SHAPES = {
    "order":       ("landing.zomato_business_order",          ("zomato_order_id",)),
    "order_item":  ("landing.zomato_business_order_item",     ("zomato_order_id", "line_no")),
    "segment":     ("landing.zomato_outlet_day_segment",
                    ("restaurant_id", "business_date", "nrl_segment", "offer_sensitivity", "mealtime")),
    "ads_segment": ("landing.zomato_outlet_day_ads_segment",
                    ("restaurant_id", "business_date", "segment_type", "segment_value")),
    "quality":     ("landing.zomato_outlet_day_quality",      ("restaurant_id", "business_date")),
    "campaign":    ("landing.zomato_ad_campaign_day",         ("campaign_id", "business_date")),
}

# Excluded from the hash because it reorders between pulls without meaning anything;
# _items_canon (sorted pos_item_id:qty:cost) stands in for it. Same lesson as 060.
HASH_EXCLUDE = {"items_in_order"}


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


def _hashable(row):
    return [f"{k}={row[k]}" for k in sorted(row) if k not in HASH_EXCLUDE and not k.startswith("__")]


def open_run(cur, report_key, window_from, window_to, raw_path=None, sha=None):
    cur.execute(
        """insert into landing.ingest_runs
             (source_system, report_key, window_from, window_to, raw_file_path, sha256, status)
           values ('zomato', %s, %s, %s, %s, %s, 'started') returning id""",
        (report_key, window_from, window_to, raw_path, sha))
    return cur.fetchone()[0]


def close_run(cur, run_id, row_count, status="loaded", note=None):
    cur.execute(
        """update landing.ingest_runs
              set status=%s, row_count=%s, note=%s, finished_at=now() where id=%s""",
        (status, row_count, note, run_id))


def load_shape(cur, shape, rows, run_id, pull_date=None):
    """Insert-or-supersede `rows` into the table for `shape`.
    Returns (new, changed, unchanged)."""
    table, key_cols = SHAPES[shape]
    if not rows:
        return 0, 0, 0
    pull_date = pull_date or date.today()

    # data columns = whatever the parser produced, minus private keys
    data_cols = [c for c in rows[0] if not c.startswith("_")]
    for r in rows:                                   # every row must have the same shape
        missing = set(data_cols) - set(r)
        if missing:
            raise RuntimeError(f"{shape}: row missing columns {sorted(missing)[:5]}")

    # current state, keyed
    cur.execute(f"select id, row_hash, {', '.join(key_cols)} from {table} where superseded_at is null")
    current = {tuple(str(x) for x in rec[2:]): (rec[0], rec[1]) for rec in cur.fetchall()}

    to_insert, to_supersede, unchanged = [], [], 0
    per_day = {}
    for r in rows:
        h = P.row_hash(_hashable(r))
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
            """insert into landing.zomato_business_change_log
                 (ingest_run_id, report_shape, pull_date, business_date,
                  new_rows, changed_rows, unchanged_rows)
               values (%s,%s,%s,%s,%s,%s,%s)""",
            (run_id, shape, pull_date, bday, n, c, u))

    return len(to_insert) - len(to_supersede), len(to_supersede), unchanged


def upsert_outlets(cur, outlets):
    if not outlets:
        return 0
    execute_values(cur, """
        insert into landing.zomato_outlet
          (restaurant_id, restaurant_name, subzone, city, first_seen_date, last_seen_date)
        values %s
        on conflict (restaurant_id) do update set
          restaurant_name = coalesce(excluded.restaurant_name, landing.zomato_outlet.restaurant_name),
          subzone         = coalesce(excluded.subzone,  landing.zomato_outlet.subzone),
          city            = coalesce(excluded.city,     landing.zomato_outlet.city),
          first_seen_date = least(coalesce(landing.zomato_outlet.first_seen_date, excluded.first_seen_date),
                                  excluded.first_seen_date),
          last_seen_date  = greatest(coalesce(landing.zomato_outlet.last_seen_date, excluded.last_seen_date),
                                     excluded.last_seen_date),
          updated_at      = now()
    """, [(o["restaurant_id"], o.get("restaurant_name"), o.get("subzone"), o.get("city"),
           o.get("first_seen_date"), o.get("last_seen_date")) for o in outlets])
    return len(outlets)
