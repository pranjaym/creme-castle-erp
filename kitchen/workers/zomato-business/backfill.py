"""Historical backfill for the Zomato enterprise business reports.

    python3 backfill.py --from 2025-01 --to 2026-08            # all five shapes
    python3 backfill.py --from 2025-01 --to 2026-08 --dry-run
    python3 backfill.py --from 2025-01 --to 2026-08 --shapes order

Window = one calendar month, because Zomato caps a pull at 31 days.

RESUMABLE. Before each (month, shape) it asks landing.ingest_runs whether that
exact window already loaded, and skips it. So a run that dies at month 9 can be
restarted with the same arguments and picks up where it stopped, and a month that
loaded but whose data later needs refreshing can be forced with --redo.

Deliberately sequential and unhurried: reports are generated server-side and
arrive by mail, so firing a hundred at once buys nothing and risks a rate limit
nobody has measured. One month at a time, all its shapes together, then wait.
"""
from __future__ import annotations

import argparse
import calendar
import os
import sys
import time
from datetime import date, datetime, timezone

import harvest as H
import load as L
import parse as P
import request as R
import run_business as RB

HERE = os.path.dirname(os.path.abspath(__file__))
SESSION = os.path.expanduser(os.environ.get("ZOMATO_SESSION_FILE",
                                            "~/.creme-castle/zomato_session.json"))


def months(m_from: str, m_to: str, last_available=None):
    """Yield (first, last) for each calendar month. The final window is clamped to
    `last_available` (default yesterday): Zomato holds nothing for today or beyond,
    and a window whose end date is in the future is accepted and then silently
    never generated. That cost the whole of August 2026 on the first run."""
    y1, mo1 = (int(x) for x in m_from.split("-"))
    y2, mo2 = (int(x) for x in m_to.split("-"))
    if last_available is None:
        last_available = date.today() - __import__("datetime").timedelta(days=1)
    y, mo = y1, mo1
    while (y, mo) <= (y2, mo2):
        last = date(y, mo, calendar.monthrange(y, mo)[1])
        if last > last_available:
            last = last_available
        first = date(y, mo, 1)
        if first > last_available:
            break
        yield first, last
        mo += 1
        if mo == 13:
            y, mo = y + 1, 1


def already_loaded(cur, shape, d1, d2):
    cur.execute("""select 1 from landing.ingest_runs
                   where source_system='zomato' and report_key=%s
                     and window_from=%s and window_to=%s and status='loaded' limit 1""",
                (RB.RUN_KEY[shape], d1, d2))
    return cur.fetchone() is not None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="m_from", required=True, help="YYYY-MM")
    ap.add_argument("--to", dest="m_to", required=True, help="YYYY-MM")
    ap.add_argument("--shapes", default=",".join(RB.SHAPES))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--redo", action="store_true", help="ignore what already loaded")
    ap.add_argument("--wait", type=int, default=1800)
    args = ap.parse_args()

    L.load_env_file(os.path.join(HERE, "..", "..", ".env.local"))
    shapes = [s for s in args.shapes.split(",") if s]
    windows = list(months(args.m_from, args.m_to))

    conn = L.connect()
    plan = []
    with conn.cursor() as cur:
        for d1, d2 in windows:
            todo = [s for s in shapes
                    if args.redo or not already_loaded(cur, s, d1, d2)]
            if todo:
                plan.append((d1, d2, todo))
    conn.close()

    done_already = len(windows) * len(shapes) - sum(len(t) for _, _, t in plan)
    RB.log(f"{len(windows)} months, {len(shapes)} shapes = {len(windows)*len(shapes)} pulls; "
           f"{done_already} already loaded, {sum(len(t) for _,_,t in plan)} to do")
    if args.dry_run:
        for d1, d2, todo in plan:
            RB.log(f"  would pull {d1} to {d2}: {','.join(todo)}")
        return 0

    failed = []
    for n, (d1, d2, todo) in enumerate(plan, 1):
        RB.log(f"[{n}/{len(plan)}] {d1} to {d2}  shapes={','.join(todo)}")
        since = datetime.now(timezone.utc)
        try:
            res = R.request_reports(SESSION, todo, d1, d2)
        except Exception as e:
            RB.log(f"  request failed: {type(e).__name__}: {e}"); failed.append((d1, todo)); continue
        bad = [r for r in res if r["status"] != 200]
        if bad:
            RB.log(f"  Zomato refused: {[(b['shape'], b['status']) for b in bad]}")
            failed.append((d1, todo)); continue

        links = RB.wait_for_reports(since, len(todo), timeout_s=args.wait, window=(d1, d2))
        if not links:
            RB.log(f"  0/{len(todo)} reports arrived, nothing to load for this month")
            failed.append((d1, todo)); continue
        if len(links) < len(todo):
            RB.log(f"  only {len(links)}/{len(todo)} arrived; loading those, the rest "
                   f"stays outstanding and a re-run will ask only for them")

        conn = L.connect(); conn.autocommit = False
        try:
            with conn.cursor() as cur:
                for item in links:
                    key, rtype = H.resolve_tracker(item["tracker"])
                    text = H.download_csv(H.presigned_for(key, rtype, SESSION))
                    shape = P.detect_shape(text)
                    rows, counts = RB.load_csv(cur, shape, text, (d1, d2))
                    RB.log(f"    {shape:9s} {rows:>8,} rows  {counts}")
            conn.commit()
            if len(links) < len(todo):
                failed.append((d1, todo))
        except Exception as e:
            conn.rollback(); RB.log(f"  load failed, rolled back: {type(e).__name__}: {e}")
            failed.append((d1, todo))
        finally:
            conn.close()
        time.sleep(5)

    if failed:
        RB.log(f"FINISHED WITH GAPS, {len(failed)} months need a re-run:")
        for d1, todo in failed:
            RB.log(f"   {d1:%Y-%m}  {','.join(todo)}")
        return 1
    RB.log("backfill complete, no gaps")
    return 0


if __name__ == "__main__":
    sys.exit(main())
