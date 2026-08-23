# zomato-business

Ingest for the Zomato **enterprise** console at `zomato.com/partners/business/`.

This is NOT the same source as `workers/zomato-ingest`, which scrapes the older
order-history page. Different surface, richer data, different delivery. The two
run independently and neither touches the other's tables.

- Design and evidence: `erp-plan/zomato-business-reports-catalogue.md`
- Table proposal and coverage proof: `erp-plan/zomato-spine-tables-proposal.md`
- Schema: `kitchen/migrations/130_zomato_business_reports.sql`

## How a pull works

Zomato's submit endpoint returns no job id and no polling endpoint, so **the email
is the only carrier of the download key**. The chain is:

1. `request.py` opens the reporting page in headless Firefox with the saved
   session, lets the app fetch its own `download-form-config`, then replays the
   submit POST from inside the page. No form driving, no calendar clicking.
   It lifts `brandIds`, the outlet/city/legal-entity `postbackParams` and the
   `x-zomato-*` headers off the app's own request, so nothing is hardcoded.
2. Zomato emails `pranjay.mittal@gmail.com` about five minutes later. A Gmail
   filter forwards it to `CC_MAIL_USER`.
3. `harvest.py` reads that mailbox over IMAP, resolves the tracker link to a
   download key, loads the key in the same session to get a **presigned S3 url
   valid 3 hours**, and fetches the CSV. The presigned url needs no cookies.
4. `parse.py` identifies the shape from the CSV itself (every mail has the same
   subject) and parses it.
5. `load.py` inserts with supersede lineage, exactly like `zomato-ingest`.

## Shapes

Five requests per window. They cannot be merged: ticking a breakdown removes whole
metric groups, and all four at once leaves nothing selectable.

| shape | aggLevel | breakdowns | metrics | table |
|---|---|---|---|---|
| `quality` | outlet | none | 101 asked, 100 delivered | `zomato_outlet_day_quality` (the 28 unique ones) |
| `segment` | outlet | nrl + offerSensitive + mealtime | 59 asked, 58 delivered | `zomato_outlet_day_segment` |
| `ads_sp` | outlet | spendingPotential | 14 | `zomato_outlet_day_ads_segment` |
| `ads_nrl` | outlet | nrl | 14 | `zomato_outlet_day_ads_segment` |
| `order` | order | none | 55 | `zomato_business_order` + `_order_item` |

`ads_sp` and `ads_nrl` are different cuts of the same 14 metrics and **neither
derives the other**, which is why both are pulled.

Weekly and monthly grains are never pulled: daily rolls up. Brand and city
aggregation are never pulled: they roll up through `landing.zomato_outlet`.

## Limits

- **31 days per pull**, history back to 1 January 2024.
- One metric, "Total restaurant discount", is selectable but never arrives. There
  is no column for it.

## Running it

    python3 run_business.py --from 2026-08-12 --to 2026-08-13
    python3 run_business.py --harvest-only --since 2026-08-22T10:48:00Z --from ... --to ...

Exit codes match the house contract: `0` loaded, `75` defer to a later slot
(transport, or reports not arrived yet), `1` a fault more slots cannot fix.

## Tests

    python3 test_parse.py      # 30 offline assertions against erp-plan/data-samples/

They cover the six loader contracts, including the two that silently corrupt data
if broken: the quality cube must be read positionally (its header has duplicate
names and `csv.DictReader` drops two columns), and order timestamps are labelled
`+0000 UTC` but are IST.

## Env

From `kitchen/.env.local`:

    SPINE_DATABASE_URL           spine Postgres (ap-south-1 pooler, see F15)
    CC_MAIL_USER                 mailbox the Zomato reports are forwarded to
    CC_MAIL_APP_PASSWORD         Google app password (spaces are stripped on use)
    ZOMATO_SESSION_FILE          optional, default ~/.creme-castle/zomato_session.json

The browser session is the same file `zomato-ingest` maintains. Verified 21 Aug
2026 to authenticate on this console headless in Firefox with no extra login.

## Not done yet

- Track ads (`campaign` shape): direct download, not emailed. Table exists, loader
  does not.
- The reconciliation writer for `landing.zomato_recon_log`: the quality cube's 72
  overlapping metrics should be diffed against the summed cubes on every load.
- Scheduling. The settling horizon is unmeasured for this feed, so the pull window
  and slot times are not yet fixed. `landing.zomato_business_change_log` is
  recording new/changed/unchanged per day per shape to answer that.
