"""SupplyNote daily pull into the spine, for the inventory module.

What it reads (all read-only), for the Noida Central Warehouse:
  products                the whole product master
  outlet-products         book stock per item, kept as one row per item per IST day
  inventory-log           stock movements, the last LEDGER_DAYS days (re-read to catch late entries)
  purchase-orders         the last PO_DAYS days of purchase orders
  purchase-order-lines    every line (the dataset has no date filter)

Flags:
  --dry-run               read and check everything, write nothing, no database connection
  --from YYYY-MM-DD       ledger and PO window start (backfill); default is the rolling window
  --to YYYY-MM-DD         window end, default today (IST)
  --only a,b              only these datasets (products, stock_daily, inventory_log,
                          purchase_orders, purchase_order_lines)

Exit codes (same as the sibling workers): 0 loaded; 75 defer (network or
transport trouble: no alert, the next slot retries); 1 real failure.
Alerts follow the flood rule (F50): at most one owner mail a day, only from
the last slot of the half day, never on a deferral, never when CC_NO_ALERT is set.
"""
from __future__ import annotations
import argparse
import os
import sys
import traceback
from datetime import datetime, timedelta, timezone

import api as A
import load as L
import shapes as S

HERE = os.path.dirname(os.path.abspath(__file__))
IST = timezone(timedelta(hours=5, minutes=30))
WAREHOUSE = os.environ.get("SUPPLYNOTE_WAREHOUSE_OUTLET_ID", "5dd9015b742a4b9b20c45677")   # Noida-Central Warehouse
LEDGER_DAYS = 5
PO_DAYS = 366               # the API caps an interactive date range at 366 days
LAST_SLOT_HOURS = (7, 23)   # the last slot of the morning and of the evening
ALL = ["products", "stock_daily", "inventory_log", "purchase_orders", "purchase_order_lines"]


def log(*a):
    print(*a, flush=True)


def alert(subject, body):
    if os.environ.get("CC_NO_ALERT"):
        log("alert suppressed (CC_NO_ALERT)")
        return
    stamp = os.path.join(HERE, ".last_alert")
    today = datetime.now(IST).strftime("%Y-%m-%d")
    try:
        if open(stamp).read().strip() == today:
            log("alert already sent today, not repeating (F50)")
            return
    except OSError:
        pass
    import smtplib
    from email.message import EmailMessage
    try:
        user = os.environ["CC_MAIL_USER"]
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = user, user, subject
        msg.set_content(body)
        s = smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=45)
        s.login(user, os.environ["CC_MAIL_APP_PASSWORD"].replace(" ", ""))
        s.send_message(msg)
        s.quit()
        open(stamp, "w").write(today)
        log("owner alert sent")
    except Exception as e:
        log(f"alert could not be sent: {type(e).__name__}: {e}")


def fetch(key, which, d_from, d_to, now):
    """Read from the API and shape every row. Returns {report_key: [rows]}."""
    out = {}
    wh = dict(outlet_ids=WAREHOUSE)
    if "products" in which:
        out["products"] = [S.product(r) for r in A.pull(key, "products", log)]
    if "stock_daily" in which:
        snap, pulled = now.date().isoformat(), now.isoformat()
        out["stock_daily"] = [S.stock(r, snap, pulled) for r in A.pull(key, "outlet-products", log, **wh)]
    if "inventory_log" in which:
        out["inventory_log"] = [S.ledger(r) for r in A.pull(key, "inventory-log", log,
                                                            start_date=d_from["ledger"], end_date=d_to, **wh)]
    if "purchase_orders" in which:
        out["purchase_orders"] = [S.po(r) for r in A.pull(key, "purchase-orders", log,
                                                          start_date=d_from["po"], end_date=d_to, **wh)]
    if "purchase_order_lines" in which:
        out["purchase_order_lines"] = [S.po_line(r) for r in A.pull(key, "purchase-order-lines", log, **wh)]
    for k, rows in out.items():
        S.check_keys(k, rows)
    return out


def sanity(out):
    """Refuse a pull that is plainly truncated, before anything is written."""
    floors = {"products": 500, "stock_daily": 500, "purchase_order_lines": 10000}
    for k, floor in floors.items():
        if k in out and len(out[k]) < floor:
            raise A.Contract(f"{k}: only {len(out[k])} rows, expected at least {floor}; refusing to load a truncated pull")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--from", dest="d_from")
    ap.add_argument("--to", dest="d_to")
    ap.add_argument("--only")
    args = ap.parse_args()

    L.load_env_file(os.path.join(HERE, "..", "..", ".env.local"))
    now = datetime.now(IST)
    which = [w.strip() for w in args.only.split(",")] if args.only else ALL
    bad = [w for w in which if w not in ALL]
    if bad:
        log(f"unknown dataset(s): {bad}; choose from {ALL}")
        return 1
    d_to = args.d_to or now.date().isoformat()
    end = datetime.strptime(d_to, "%Y-%m-%d").date()
    d_from = {"ledger": args.d_from or (end - timedelta(days=LEDGER_DAYS)).isoformat(),
              "po": args.d_from or (end - timedelta(days=PO_DAYS - 1)).isoformat()}
    backfill = bool(args.d_from)
    log(f"===== supplynote run_daily at {now:%Y-%m-%d %H:%M} IST, ledger {d_from['ledger']} to {d_to}, "
        f"POs {d_from['po']} to {d_to}{', DRY RUN' if args.dry_run else ''} =====")

    last_slot = now.hour in LAST_SLOT_HOURS
    conn = None
    try:
        out = fetch(L.env("SUPPLYNOTE_API_KEY"), which, d_from, d_to, now)
        if not backfill and not args.only:
            sanity(out)
        if args.dry_run:
            for k in which:
                rows = out[k]
                log(f"  {k}: {len(rows):,} rows shaped, keys unique"
                    + (f"; sample key {tuple(rows[0][c] for c in S.TABLES[k][1])}" if rows else ""))
            log("dry run: nothing written.")
            return 0
        conn = L.connect()
        with conn:                      # one transaction: all datasets land, or none
            with conn.cursor() as cur:
                for k in which:
                    wf = d_from["ledger"] if k == "inventory_log" else d_from["po"] if k == "purchase_orders" else d_to
                    run_id = L.open_run(cur, k, wf, d_to)
                    new, changed, same = L.load_rows(cur, k, out[k], run_id)
                    L.close_run(cur, run_id, len(out[k]), note=f"new {new}, changed {changed}, unchanged {same}")
                    log(f"  {k}: new {new:,}, changed {changed:,}, unchanged {same:,}")
        log("loaded.")
        return 0
    except (A.Transport, OSError) as e:
        log(f"transport trouble, deferring: {type(e).__name__}: {str(e)[:300]}")
        return 75
    except Exception as e:
        log(traceback.format_exc())
        if type(e).__name__ in ("OperationalError", "InterfaceError"):
            log("database connection trouble, deferring.")
            return 75
        if last_slot and not backfill:
            alert("SupplyNote pull failed (inventory module)",
                  "The SupplyNote pull for the inventory module failed and this was the last slot of the half day.\n"
                  "The inventory screens keep the last good reading until a pull succeeds.\n"
                  "Before acting, check whether a later slot already succeeded (tail run.log).\n\n"
                  + traceback.format_exc()[-3000:])
            return 1
        log("not the last slot: deferring without an alert.")
        return 75
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
