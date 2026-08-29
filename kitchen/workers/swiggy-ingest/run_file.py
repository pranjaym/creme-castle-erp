"""Load ONE Swiggy Daily-MTD xlsx from disk (Phase 1 entry point, and the
shared core that run_daily.py calls after fetching the mail).

    python3 run_file.py "<path to Daily-MTD ... .xlsx>" [--force] [--dry-run]

Prints a per-sheet count check (file rows vs database action) so the load can
be verified by hand against the file.

Exit codes: 0 loaded (or clean skip of an already-loaded file), 1 failure.
A failure rolls back the whole transaction: the register never says loaded
for a partial load (F22 lesson).
"""
from __future__ import annotations

import hashlib
import os
import sys

import load as L
import parse as P

HERE = os.path.dirname(os.path.abspath(__file__))


def load_path(path, force=False, raw_file_path=None, log=print):
    """Parse and load one file inside one transaction.
    Returns 'loaded' or 'skipped'. Raises on failure (nothing committed).
    `raw_file_path` is what the register records as the receipt (the storage
    path when called from run_daily, the local path otherwise)."""
    sha = hashlib.sha256(open(path, "rb").read()).hexdigest()
    log(f"file: {os.path.basename(path)}")
    log(f"sha256: {sha}")

    shapes, sheet_report = P.parse_file(path)
    for sheet, n in sheet_report.items():
        log(f"  parsed [{sheet}] {n} source rows")
    absent = [s for s in P.SHEETS if s not in sheet_report]
    if absent:
        log(f"  sheets ABSENT in this file (tolerated, contract 5): {absent}")

    dates = [r["business_date"] for rows in shapes.values() for r in rows]
    window_from, window_to = min(dates), max(dates)
    log(f"window: {window_from} to {window_to}")

    conn = L.connect()
    try:
        with conn:
            with conn.cursor() as cur:
                prior = L.already_loaded(cur, sha)
                if prior and not force:
                    log(f"already loaded as ingest_run {prior}, skipping (use --force to reload).")
                    return "skipped"
                run_id = L.open_run(cur, window_from, window_to,
                                    raw_path=raw_file_path or path, sha=sha)
                log(f"ingest_run {run_id}")
                total = 0
                log(f"  {'shape':<16} {'file':>7} {'new':>7} {'changed':>7} {'unchanged':>9}")
                for shape in L.SHAPES:
                    rows = shapes.get(shape, [])
                    new, changed, unchanged = L.load_shape(cur, shape, rows, run_id)
                    total += len(rows)
                    ok = "" if (new + changed + unchanged) == len(rows) else "  MISMATCH"
                    log(f"  {shape:<16} {len(rows):>7} {new:>7} {changed:>7} {unchanged:>9}{ok}")
                    if ok:
                        raise RuntimeError(f"{shape}: loaded {new + changed + unchanged} of {len(rows)} rows")
                note = "sheets: " + ", ".join(f"{k}={v}" for k, v in sheet_report.items())
                L.close_run(cur, run_id, total, note=note)
                log(f"loaded, {total} parsed rows across {len(sheet_report)} sheets.")
        return "loaded"
    finally:
        conn.close()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    dry = "--dry-run" in sys.argv
    if len(args) != 1:
        print(__doc__)
        return 1
    path = args[0]
    if not os.path.exists(path):
        print(f"no such file: {path}")
        return 1

    L.load_env_file(os.path.join(HERE, "..", "..", ".env.local"))

    if dry:
        shapes, sheet_report = P.parse_file(path)
        for sheet, n in sheet_report.items():
            print(f"  parsed [{sheet}] {n} source rows")
        absent = [s for s in P.SHEETS if s not in sheet_report]
        if absent:
            print(f"  sheets ABSENT in this file (tolerated, contract 5): {absent}")
        print("dry run, nothing written.")
        return 0

    load_path(path, force=force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
