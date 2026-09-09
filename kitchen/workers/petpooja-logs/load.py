"""Spine loader for the Petpooja witness logs. Insert-or-supersede, never
update, never delete (CLAUDE.md rule 6). One ingest_runs row per (screen,
window). Same shape as the Swiggy loader, plus the F47 lesson: every
connection carries TCP keepalives so a stalled socket dies in about 80
seconds instead of 4.5 hours.
"""
from __future__ import annotations
import os
from datetime import date

import psycopg2
import psycopg2.extras

import parse as P

HERE = os.path.dirname(os.path.abspath(__file__))


def env(key, default=None):
    v = os.environ.get(key, default)
    if v is None:
        raise RuntimeError(f"{key} is not set")
    return v


def load_env_file(path):
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def connect():
    # F47: keepalives on every connect site, so a dead network never hangs a run
    return psycopg2.connect(env("SPINE_DATABASE_URL"), connect_timeout=30,
                            keepalives=1, keepalives_idle=30, keepalives_interval=10,
                            keepalives_count=5)


# shape -> (table, natural key columns). dup_seq is appended by the loader.
SHAPES = {
    "store_log": ("landing.petpooja_store_status_log",
                  ["petpooja_rest_id", "logged_at", "app", "request_type"]),
    "item_log": ("landing.petpooja_item_toggle_log",
                 ["petpooja_rest_id", "logged_at", "app", "action", "item_ids"]),
    "activity": ("landing.petpooja_order_activity",
                 ["petpooja_rest_id", "order_id"]),
}


def open_run(cur, report_key, window_from, window_to, note=None):
    cur.execute(
        """insert into landing.ingest_runs
             (source_system, report_key, window_from, window_to, status, note)
           values ('petpooja', %s, %s, %s, 'started', %s) returning id""",
        (report_key, window_from, window_to, note))
    return cur.fetchone()[0]


def close_run(cur, run_id, row_count, status="loaded", note=None):
    cur.execute(
        """update landing.ingest_runs
              set status=%s, row_count=%s, note=%s, finished_at=now() where id=%s""",
        (status, row_count, note, run_id))


def upsert_outlets(cur, outlets, hashes=None):
    """outlets: [(rest_id, label)], hashes: {rest_id: client_hash}."""
    hashes = hashes or {}
    for rid, label in outlets:
        code = label.split(" - ", 1)[1].strip() if " - " in label else None
        cur.execute(
            """insert into landing.petpooja_outlet_map
                 (petpooja_rest_id, outlet_label, internal_code, client_hash)
               values (%s, %s, %s, %s)
               on conflict (petpooja_rest_id) do update
                 set outlet_label = excluded.outlet_label,
                     internal_code = coalesce(excluded.internal_code, landing.petpooja_outlet_map.internal_code),
                     client_hash = coalesce(excluded.client_hash, landing.petpooja_outlet_map.client_hash),
                     last_seen_at = now()""",
            (str(rid), label, code, hashes.get(str(rid))))


def _assign_dup_seq(rows, key_cols):
    seen = {}
    for r in rows:
        k = tuple(str(r[c]) for c in key_cols)
        seen[k] = seen.get(k, 0) + 1
        r["dup_seq"] = seen[k]


def load_shape(cur, shape, rows, run_id, window_from=None, window_to=None):
    """Insert new rows, supersede changed rows, leave unchanged rows alone.
    Only the current rows inside the window (and for these outlets) are
    compared, so a daily run reads a few thousand rows, not the whole table.
    Returns (new, changed, unchanged)."""
    table, key_cols = SHAPES[shape]
    if not rows:
        return 0, 0, 0
    keys_with_seq = key_cols + (["dup_seq"] if shape != "activity" else [])
    if shape != "activity":
        _assign_dup_seq(rows, key_cols)
    data_cols = [c for c in rows[0] if not c.startswith("_")]

    rids = sorted({str(r["petpooja_rest_id"]) for r in rows})
    where = "superseded_at is null and petpooja_rest_id = any(%s)"
    params = [rids]
    if window_from and window_to:
        where += " and business_date between %s and %s"
        params += [window_from, window_to]
    cur.execute(f"select id, row_hash, {', '.join(keys_with_seq)} from {table} where {where}", params)
    current = {tuple(str(x) for x in rec[2:]): (rec[0], rec[1]) for rec in cur.fetchall()}

    new = changed = unchanged = 0
    for r in rows:
        h = P.row_hash(r)
        k = tuple(str(r[c]) for c in keys_with_seq)
        prev = current.get(k)
        if prev is not None and prev[1] == h:
            unchanged += 1
            continue
        cols = data_cols + ["row_hash", "ingest_run_id"]
        vals = [r[c] for c in data_cols] + [h, run_id]
        if prev is not None:
            # retire the old row FIRST: the natural-key index is partial on
            # superseded_at is null, so the new row can only be inserted once
            # the old one has left the "current" set (found on the first reload)
            cur.execute(f"update {table} set superseded_at=now() where id=%s", (prev[0],))
        cur.execute(f"insert into {table} ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))}) returning id", vals)
        new_id = cur.fetchone()[0]
        if prev is None:
            new += 1
        else:
            cur.execute(f"update {table} set superseded_by=%s where id=%s", (new_id, prev[0]))
            changed += 1
    return new, changed, unchanged
