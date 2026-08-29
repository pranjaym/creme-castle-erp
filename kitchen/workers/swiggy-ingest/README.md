# swiggy-ingest

Loads the Swiggy Daily-MTD email report (11-sheet xlsx, one brand, whole month
restated daily) into the spine's landing schema.

Plan: `erp-plan/swiggy-database-plan.md` and `erp-plan/swiggy-dashboard-plan.md`.
Schema and the six loader contracts: `kitchen/migrations/210_swiggy_daily_mtd.sql`
(plus 211: coupon_code is nullable, the sheet is one row per ORDER, coupon or not).

## Phase 1 (built and verified 28 Aug 2026)

    python3 run_file.py "<path to Daily-MTD xlsx>" [--force] [--dry-run]

- `parse.py` reads the sheets by name, tolerates the pre-Feb-2026 variant
  (missing sheets, extra Rest Name column, no swiggy_trade_discount), converts
  every value through one canonical TEXT conversion, strips the literal quote
  wrapping on item names, aggregates NTR-RR (no stable row key in the source),
  and assigns dup_seq per natural key.
- `load.py` is the supersede loader (same contract as zomato-ingest and
  zomato-business): new rows insert, changed rows supersede, unchanged rows
  skip. `landing.swiggy_change_log` records new/changed/unchanged per sheet
  per business day. The register is `landing.ingest_runs`
  (source_system swiggy, report_key daily_mtd); a file whose sha256 is already
  loaded is skipped without `--force`.
- The whole load is one transaction: a failure rolls everything back and the
  register never says loaded for a partial load.

Verified on the Aug-19-2026 file: 92,239 rows across 11 sheets, every per-sheet
count equal to the file, re-run 100% unchanged (hash-stable), and file-side vs
SQL-side sums identical to the last decimal for sales orders/gmv, item
quantity/subtotal, NTR-RR orders/gmv, and coupon discount.

## Phase 2 (built 29 Aug 2026): Gmail fetch + schedule

    python3 run_daily.py         # what the launchd slots run

- `run_daily.py` reads CC_MAIL_USER's inbox over IMAP (the Swiggy mail goes
  there directly since 24 Aug 2026), saves every Daily-MTD attachment from the
  last 5 days to `archive/`, sha-skips files the register already holds,
  uploads new ones to the `swiggy-raw` storage bucket (the immutable receipt,
  recorded as raw_file_path), then loads via `run_file.load_path`.
- Schedule (`in.cremecastle.swiggy.plist`, installed in ~/Library/LaunchAgents):
  07:15 catch-up, then 14:00, 18:00, 21:30, because the mail's arrival swings
  between 10:30 and 20:45 IST. `run_swiggy.sh` carries the five standard
  defences (stamp, lock, network gate, honest exit codes, caffeinate).
- Exit policy: 0 once a loaded file covers yesterday (stamps the day);
  75 defers silently (mail not arrived, transport blip, F23 rule);
  1 alerts, only from the 21:30 slot and only when the newest loaded report
  day is 2 or more days stale, meaning the MTD self-heal already missed a
  cycle.
- First live run 29 Aug 2026: fetched and loaded the Aug-23 through Aug-27
  reports (ingest_runs 456 to 460), then correctly deferred waiting for the
  Aug-28 mail. The change log confirmed MTD behaviour: each file adds one new
  day (~41 outlets) and restates a little of the past (slot-level aov/gmv
  move the most).
