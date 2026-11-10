# supplynote-ingest: SupplyNote into the spine, for the inventory module

Written 10 November 2026 on Pranjay's go ("Yes, start"). Build step 1 of
`erp-plan/inventory-module-plan.md`.

**Status, 10 Nov 2026 19:30 IST: migration 252 applied (Pranjay's go), first
load done by hand and verified. NOT scheduled:** the launchd plist in this
folder is not installed, so the tables stand at the 10 Nov evening reading
until the next hand run or until the schedule is switched on.

First load, 10 Nov 2026: products 1,465, stock 1,210, purchase orders 4,604,
PO lines 32,230, ledger 29,955 rows back to 1 Aug 2026. A second run straight
after reported every row unchanged. Checked against the prototype: packaging
open PO lines 115 and past due over 10 days 89 (both match); stock equals the
last ledger figure on 638 of 640 items that moved. The "changed" path (a row
superseded) has not fired yet, because nothing had changed between the runs.

## What it pulls, for the Noida Central Warehouse

| SupplyNote dataset | Spine table | Pull each run |
|---|---|---|
| `products` | `landing.supplynote_products` | whole master |
| `outlet-products` | `landing.supplynote_stock_daily` | all items, kept as one row per item per IST day |
| `inventory-log` | `landing.supplynote_inventory_log` | last 5 days (re-read, because entries arrive late) |
| `purchase-orders` | `landing.supplynote_purchase_orders` | last 366 days (the API's cap) |
| `purchase-order-lines` | `landing.supplynote_purchase_order_lines` | every line (no date filter exists) |

All categories are landed, not only packaging. Read-only: nothing is ever
written to SupplyNote. API facts and traps: `erp-plan/supplynote-api-notes.md`.

## How it runs

* `run_daily.py` does the work. `--dry-run` reads and checks everything and
  writes nothing (no database connection at all). `--from YYYY-MM-DD` backfills
  the ledger and POs. `--only products,stock_daily` limits the datasets.
* Exit 0 loaded; 75 defer (transport trouble, no alert, next slot retries);
  1 real failure, with at most one owner mail a day (F50), only from the last
  slot of the half day, never when `CC_NO_ALERT` is set.
* All five datasets load in ONE transaction: they all land or none do.
* Loads insert-or-supersede on the natural key. Nothing is updated or deleted.
  A batch with an empty or repeated key is refused before any write, and a
  plainly truncated pull (too few rows) is refused too.
* `run_supplynote.sh` is what launchd would call: per half day success stamp,
  lock, network gate, caffeinate hold, 40 minute wall-clock cap.
* Secrets come from `kitchen/.env.local`: `SUPPLYNOTE_API_KEY`,
  `SPINE_DATABASE_URL`, and for alerts `CC_MAIL_USER`, `CC_MAIL_APP_PASSWORD`.

## Tested on 10 Nov 2026

* `python3 test_shapes.py`: 7 checks pass (timestamps, lossless numbers, stable
  hash, key refusal, new / changed / unchanged split).
* `python3 run_daily.py --dry-run` at 19:08 IST: products 1,465, stock 1,210,
  ledger 1,672 (5 days), purchase orders 4,604, PO lines 32,230; every key
  unique; about 90 seconds; 44 API calls.

## Still to do (each step is Pranjay's go)

1. Install the plist: copy to `~/Library/LaunchAgents/`, `launchctl load` it.
2. Watch the first scheduled evening and morning runs, and the first run in
   which a row is superseded.
3. Commit the worker and migration 252 (nothing is committed yet).

## 10 Nov 2026, later: the scheduled sync moved to the portal

Pranjay's decision: SupplyNote has an API, so the sync runs on the portal
(`portal/app/api/cron/supplynote`, `portal/lib/supplynote-sync.ts`), not from
launchd. **Do not install the plist in this folder.** This worker stays as a
hand tool for backfills.

**Before running this worker again:** its loader (`load.py`) decides "changed"
by comparing `row_hash`, while the portal loads through
`public.supplynote_ingest` (migration 253), which compares the stored source
row and writes a different style of hash. Rows loaded by the portal would look
"changed" to this loader and be superseded needlessly. Switch `load_rows` to
call `public.supplynote_ingest` first; until then, do not run it against tables
the portal has written to.
