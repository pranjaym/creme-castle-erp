# platform-check

Proves whether Zomato and Swiggy restated the numbers a conclusion was built on.

Both platforms revise figures after the fact, and Swiggy's report mail arrives
1 to 3 days late. The spine keeps every version through supersede loads, so the
live answer can quietly move under an analysis that was already circulated.
This script freezes the figures at a point in time and diffs a later freeze
against them.

Read only. It never writes to the spine.

## Use

```
cd ~/creme-castle-erp/kitchen/workers/platform-check
python3 platform_check.py --check
```

`--check` takes a fresh snapshot and diffs it against the previous one. It
prints three things:

1. **Coverage.** Whether a platform has caught up, for example Swiggy moving
   from 27 August to 30 August. Flagged with `<== NEW DAYS`.
2. **Restatements.** Every figure that moved, largest change first, with the
   outlet, the day, the metric, both values and the percent change.
3. **A verdict.** Either the earlier reading stands, or the funnel analysis has
   to be re-run before the conclusion is repeated.

Other modes:

```
python3 platform_check.py --snapshot                     freeze only, no diff
python3 platform_check.py --diff OLD.json NEW.json       diff two saved freezes
python3 platform_check.py --check --from 2026-09-01 --to 2026-09-07
```

Default window is 22 to 30 August 2026, the window behind the Faridabad
finding. Change it with `--from` and `--to` for a new question.

## What it captures

Per outlet per day, from the spine (`superseded_by is null` throughout):

| Source | Table | Metrics |
|---|---|---|
| `zomato_funnel` | `landing.zomato_outlet_day_segment` | impressions, menu opens, cart builds, orders placed, net sales, delivered, subtotal, and the six menu open sources |
| `zomato_ads` | `landing.zomato_outlet_day_ads_segment` | ad impressions, ad menu opens, orders from ads, spend, ad sales |
| `zomato_quality` | `landing.zomato_outlet_day_quality` | online time, rejections, cancellations, offline minutes |
| `swiggy_funnel` | `landing.swiggy_funnel_daily` | menu, cart, payment and order sessions |
| `swiggy_sales` | `landing.swiggy_sales_daily` | orders, GMV |

Snapshots land in `snapshots/` as timestamped JSON and are small enough to keep.

## Notes

- Connects with `SPINE_DATABASE_URL` from `kitchen/.env.local`, which is the
  `aws-1-ap-south-1` pooler. Do not switch it to the direct `db.<ref>` host,
  which is IPv6 only (F15).
- The connection retries four times, because this network is NAT64 and a lost
  IPv6 source address drops sockets mid-run (F22).
- Landing columns are text; the script casts with
  `coalesce(nullif(replace(col,',',''),''),'0')::numeric`.
- The Zomato segment cube runs about 1 percent light on order counts (F37). It
  is right for funnel shape and percentages, not for a headline order count.

Written 31 August 2026, to serve the routine in
`erp-plan/platform-drop-diagnosis-routine.md`.
