# zomato-ingest

Evening pull of the Zomato partner dashboard's Order history and Customer details
exports into `landing.zomato_order_details` (spine). Design and verified facts:
`erp-plan/zomato-order-details-feed.md`; flags F16 to F19 in `integration-notes.md`.

## One-time setup (Pranjay, ~2 minutes)

```bash
cd ~/creme-castle-erp/kitchen/workers/zomato-ingest
python3 scrape.py bootstrap
```

A browser window opens on the partner dashboard. Log in by hand (phone, OTP).
The session is saved and pushed to Supabase Storage; the evening headless runs
reuse it indefinitely. Until this is done, every scheduled slot defers quietly
(exit 75, no alert, no noise).

Install the schedule (once):

```bash
cp in.cremecastle.zomato.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/in.cremecastle.zomato.plist
```

## What runs when

- 18:00 / 18:20 / 20:00 / 22:00: `run_zomato.sh` -> `run_evening.py`, one 7-day
  range export ending yesterday (Order history, then Customer details), landed
  with supersede semantics. Data-lag failures (F16) defer to the next slot.
- 8 am (inside the dashboard run): if no evening slot succeeded yesterday,
  `run_daily.py` runs a D-2 catch-up window via `run_evening.py --end <D-2>`.

## Manual operations

```bash
python3 run_evening.py                        # pull now, window ending yesterday
python3 run_evening.py --end 2026-07-30       # pull an explicit window end
python3 ingest.py --file <export> --dry-run   # inspect a file, no DB
python3 ingest.py --file <export>             # load a file by hand
```

## Contracts that must not drift

- `row_hash` excludes `kpt_duration_minutes` (F19) and hashes `items_in_order`
  in sorted order; changing either rule silently superseded-storms the table.
- Always the SAME export shape (the range export): KPT differs between range and
  single-day exports, so shape consistency keeps its bias constant.
- The change log (`landing.zomato_change_log`) is the evidence for shrinking the
  7-day window; review it after two weeks of runs.
