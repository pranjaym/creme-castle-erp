"""Spine loader for the SupplyNote landing tables (migration 252).
Insert-or-supersede, never update a data column, never delete (CLAUDE.md rule 6).
One landing.ingest_runs row per dataset per run. Every connection carries TCP
keepalives (F47).
"""
from __future__ import annotations
import os

import shapes as S


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


def env(key):
    v = os.environ.get(key)
    if not v:
        raise RuntimeError(f"{key} is not set")
    return v


def connect():
    import psycopg2
    return psycopg2.connect(env("SPINE_DATABASE_URL"), connect_timeout=30, keepalives=1,
                            keepalives_idle=30, keepalives_interval=10, keepalives_count=5)


def open_run(cur, report_key, window_from, window_to, note=None):
    cur.execute("""insert into landing.ingest_runs (source_system, report_key, window_from, window_to, status, note)
                   values ('supplynote', %s, %s, %s, 'started', %s) returning id""",
                (report_key, window_from, window_to, note))
    return cur.fetchone()[0]


def close_run(cur, run_id, row_count, status="loaded", note=None):
    cur.execute("update landing.ingest_runs set status=%s, row_count=%s, note=%s, finished_at=now() where id=%s",
                (status, row_count, note, run_id))


def key_of(row, keys):
    return "|".join(str(row[c]) for c in keys)


def split(rows, keys, current):
    """Pure: sort a batch into new, changed and unchanged against the current
    rows. current is {key string: (id, row_hash)}. Returns (fresh, changed, unchanged_count)
    where changed is [(old_id, row)]."""
    fresh, changed, unchanged = [], [], 0
    for r in rows:
        prev = current.get(key_of(r, keys))
        if prev is None:
            fresh.append(r)
        elif prev[1] == r["row_hash"]:
            unchanged += 1
        else:
            changed.append((prev[0], r))
    return fresh, changed, unchanged


def load_rows(cur, report_key, rows, run_id):
    """Insert new rows, supersede changed rows, leave unchanged rows alone.
    Returns (new, changed, unchanged)."""
    import psycopg2.extras
    table, keys = S.TABLES[report_key]
    if not rows:
        return 0, 0, 0
    S.check_keys(report_key, rows)
    cols = list(rows[0].keys()) + ["ingest_run_id"]

    # current rows for exactly the keys in this batch, read through a temp table
    cur.execute("create temp table if not exists _sn_keys (k text primary key) on commit drop")
    cur.execute("truncate _sn_keys")
    kexpr = " || '|' || ".join(f"t.{c}::text" for c in keys)
    psycopg2.extras.execute_values(cur, "insert into _sn_keys (k) values %s",
                                   [(key_of(r, keys),) for r in rows], page_size=5000)
    cur.execute(f"select {kexpr}, t.id, t.row_hash from {table} t join _sn_keys s on s.k = {kexpr} "
                f"where t.superseded_at is null")
    current = {k: (i, h) for k, i, h in cur.fetchall()}

    fresh, changed, unchanged = split(rows, keys, current)
    tpl = "(" + ", ".join(["%s"] * len(cols)) + ")"
    ins = f"insert into {table} ({', '.join(cols)}) values "
    if fresh:
        psycopg2.extras.execute_values(cur, ins + "%s", [[r[c] for c in cols[:-1]] + [run_id] for r in fresh],
                                       template=tpl, page_size=2000)
    for old_id, r in changed:
        # retire the old row FIRST: the key index is partial on superseded_at is null
        cur.execute(f"update {table} set superseded_at = now() where id = %s", (old_id,))
        cur.execute(ins + tpl + " returning id", [r[c] for c in cols[:-1]] + [run_id])
        cur.execute(f"update {table} set superseded_by = %s where id = %s", (cur.fetchone()[0], old_id))
    return len(fresh), len(changed), unchanged
