# oms-feed: the wide OMS to spine feed

Lands OMS order headers, order items, and customers into the spine landing zone
(`landing.oms_order_header`, `landing.oms_order_item`, `landing.oms_customer`),
from which `core.refresh_orders()` derives `core.orders` rows with
`source = 'oms'`. Spec: `erp-plan/oms-spine-feed-spec.md`. Built 24 Aug 2026.

This is NOT the Build 1a recon feed. `../oms-ingest/pull_oms_orders.mjs` and
`landing.oms_orders` stay untouched: that feed is delivery date based and
pre-aggregated for reconciliation; this one is placed date based and full
fidelity. They disagree on which day an order belongs to, by design.

## What normally happens

- launchd runs `run_oms_feed.sh` on a morning ladder: 09:05 / 09:35 / 10:15 /
  11:15 IST (`in.cremecastle.oms-feed.plist`, a copy lives in
  `~/Library/LaunchAgents/`). First success stamps `.last_success`; later slots
  exit instantly.
- The worker reads the OMS change feed (`order_events` above the cursor in
  `landing.oms_feed_state`), re-reads every touched order in full, plus a
  rolling 3 day re-read, plus on Mondays a 30 day order sweep and a full
  customer sweep.
- Changed rows supersede (new row, old row stamped `superseded_by` /
  `superseded_at`); nothing is ever deleted. Current state = rows where
  `superseded_at is null`.
- Every run writes a receipt into `landing.ingest_runs`
  (`source_system = 'oms'`, `report_key = 'oms_feed'`) with a JSON summary in
  `note`.
- The 10:00 and 20:00 IST server side core refresh derives the landed rows
  into `core.orders` / `core.order_items` (the OMS step re-derives all OMS
  rows every refresh, so late cancellations are always caught).

## Reading and writing

- Reads the OMS via supabase-js, selects only. The key in
  `dashboard/auto/.env` (`OMS_SUPABASE_KEY`) is currently the OMS service role
  key, because the OMS has RLS with zero policies and no lesser key can read
  anything (integration-notes F29). Read-only is enforced BY CODE until a
  scoped Postgres reader role is created (needs Pranjay, steps in F29).
- Writes the spine over the ap-south-1 pooler (`SPINE_DATABASE_URL`), never
  `db.<ref>` (IPv6 only, F15). Chunked short transactions (F21).
- Never, under any circumstances, writes to the OMS. It runs live GST billing.

## Failure behaviour (the F28 birth checklist, all present)

- OMS reads retry 3 times, 10 s apart (F22).
- Transport failures (network, 5xx, dead spine connection, pg 08/57 classes)
  exit 75: no stamp, no alert, the next slot retries. At the last slot
  (>= 11:00 IST, `CC_OMS_LAST_SLOT_HOUR`) they alert the owner and exit 1 (F23).
- Logic failures (schema drift, bad SQL, missing env) alert immediately, at
  most once per day (`.last_alert`).
- Rollback is guarded so a dead connection cannot mask the real error (F20).
- A partial run never advances the event cursor; the landing is idempotent, so
  the retry re-processes the same window harmlessly.

## What to do when it breaks

Always check whether a later slot already succeeded before treating an alert
as live (`tail run.log`, `cat .last_success`). To run by hand:

    cd ~/creme-castle-erp/kitchen/workers/oms-feed
    node pull_oms_feed.mjs                # normal incremental
    node pull_oms_feed.mjs --sweep 30     # force a 30 day order re-read
    node pull_oms_feed.mjs --customers-full

A gap of any length self-heals: the event cursor picks up where it stopped,
and `--sweep N` re-reads any window. Re-running never duplicates
(row hashes make unchanged rows no-ops).

## Row hash rules (do not change silently; must match the landing DDL notes)

sha256 over the source columns in map order, nulls as empty string. Excluded
(stored but not hashed): header `updated_at`; customer `order_count` and
`last_order_at` (derived counters that churn daily, the F19 lesson).

## Backfill record

24 Aug 2026: orders backfilled from 1 Aug 2026 (the D2C cutover; earlier D2C
is already in the spine via Petpooja POS rows, spec section 2), customers in
full with no floor. The event cursor was initialised the same run.
