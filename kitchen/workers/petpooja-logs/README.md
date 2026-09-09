# petpooja-logs: Petpooja's own event logs as the second witness

Built 9 September 2026 on Pranjay's go, after area manager feedback showed that
Zomato's labels cannot be taken at face value (flag F49 in
`erp-plan/integration-notes.md`). Whenever a Zomato or Swiggy figure is
disputed, these tables hold what the POS itself recorded.

## What it pulls, every day, for every outlet

| Screen in Petpooja | Spine table | What it answers |
|---|---|---|
| Logs > Online Store Logs | `landing.petpooja_store_status_log` | Was the store switched off on an app, by whom, when. `event_kind`: `poll` (Petpooja asked the app, about every 12 min with gaps of hours, never a continuous timeline), `manual` (a person switched the store from the POS, named), `platform` (the app itself told Petpooja it closed or opened the outlet, e.g. Zomato's network-wide close/open blip at 13:48 on 8 Sep 2026). |
| Logs > Online Item On/Off Logs | `landing.petpooja_item_toggle_log` | Which item was switched off or on, on which app, for how long, and whether a PERSON did it (`trigger = manual`, user "biller") or Petpooja's stock rule did it (`trigger = automatic`, user "System"). Pranjay's rule: the two are recorded separately, always. |
| Reports > Online Order Activity Report | `landing.petpooja_order_activity` | Per order, both apps: received, accepted, mark ready, rider arrival, picked up, delivered, cancelled, returned to store. |

Plus `landing.petpooja_outlet_map`: Petpooja outlet id, label, client hash, our code.

## How it runs

* `run_petpooja_logs.sh` is what launchd calls (`in.cremecastle.petpooja-logs.plist`,
  slots 09:30, 10:30, 12:00, 15:00). It is the Swiggy wrapper with the name
  changed: success stamp, lock, network gate, caffeinate hold, honest exit code.
* `run_daily.py` does the work. Default window is yesterday (IST). Flags:
  `--from YYYY-MM-DD --to YYYY-MM-DD` (backfill), `--outlet 317707` (one store),
  `--no-activity`, `--only-activity`, `--dry-run` (read and count, write nothing).
* Exit 0 loaded; 75 defer (network, transport, session copy unavailable: no
  alert, next slot retries); 1 real failure with an owner mail (session expired
  = F24, a parse contract broke, or the outlet scope could not be restored).
* Session: the same saved login the 8am scraper uses, pulled from the
  `petpooja-session` Storage bucket through the sibling worker's own functions.
  No second login, no second OTP. When that login expires (about monthly) both
  jobs fail the same way and the same hand re-login fixes both.
* The two logs are read with plain HTTP through the page's own search endpoint
  (`POST /logs/online_log_status_ajax/?page=N`, 15 rows a page). No browser.
* The activity report needs the session pointed at one outlet at a time
  (`change_restaurant(id)`, the step the inventory scrape already uses), so it
  runs in a headless browser and ALWAYS ends by pointing the session back at
  All Outlets (`change_restaurant(0)`) and verifying it. If that verification
  fails the run alerts, because the 8am scrape reads All Outlets.
* Loads insert-or-supersede on a natural key; nothing is updated or deleted.
  Every connection carries TCP keepalives (F47).

## Sizes measured on 9 Sep 2026

Janakpuri, one day: store log 82 rows (about 6 pages), item log 52 rows (4
pages). At 41 outlets that is roughly 400 to 500 small requests a day for the
two logs, a few minutes. Spine growth about 5,000 rows a day.

## The activity half, tested 9 Sep 2026 17:57 by Pranjay from Terminal

Janakpuri, 8 Sep: 124 orders read, record types 1 = Latest current days records and 2 = Get old records, scope verified back on All Outlets. All-outlet run the same evening: 4,165 orders for 38 outlets. REACH: the two record types together cover only today and yesterday (calendar), so the daily pull must never miss a day: a day not pulled by the next evening is gone from this source. Outlets with no online orders (Lucknow, SK, Central Kitchen) show no table and are zero, not errors. To re-test one outlet by hand:

The outlet switch and the report page cannot be driven from Claude's sandbox,
so the first activity run is done by hand once:

    cd ~/creme-castle-erp/kitchen/workers/petpooja-logs && python3 run_daily.py --only-activity --outlet 317707

Read the "record types" line it prints and check the session ends on All
Outlets (the run prints "scope restore: verified All Outlets").
