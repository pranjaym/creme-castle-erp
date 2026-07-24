# Petpooja ingest worker

Pulls a Petpooja report and loads it into the spine landing zone. This is the
Build 1a punch source path. Our own code; Rishabh's `petpooja_pipeline.py` is
reference only (login/session/download knowledge lifted, never the file, never its
secrets).

## The pieces

- `ingest.py` : parse + load. Pure parsers, idempotent inserts, an offline
  `--dry-run`, and `--scrape` which chains the browser download into the load.
- `scrape.py` : the browser agent (Path B). Login once, save the session, reuse it.
- `Dockerfile`: the always-on cloud runner (Cloud Run / Railway, ~$5/mo).

## Two ways to get data in

### A. Interim manual load (works today, no scraper, no OTP)

Download the Material Purchase Report from Petpooja by hand (at the vendor-OMS
outlet), then:

```bash
# offline check first: no DB, no creds, just proves the parse
python3 ingest.py --report oms_purchase --file /path/to/report.xls --dry-run

# real load: needs the spine DB + storage creds in the env
export SPINE_DATABASE_URL=...                     # Supabase > Project Settings > Database
export SPINE_SUPABASE_URL=...                     # for the immutable raw receipt
export SPINE_SUPABASE_SERVICE_ROLE_KEY=...
python3 ingest.py --report oms_purchase --file /path/to/report.xls
```

The load stores the raw file as an immutable receipt (sha256 named) in Supabase
Storage, links that receipt and the business-day window onto the `ingest_runs` row,
and inserts rows idempotently: re-loading the same file loads zero new rows.

### B. Automated browser agent (the target, cloud-hosted)

One-time, from a laptop (the only step that needs a human for the OTP):

```bash
pip install -r requirements.txt && python -m playwright install chromium
export PETPOOJA_USERNAME=... PETPOOJA_PASSWORD=...
export SPINE_SUPABASE_URL=... SPINE_SUPABASE_SERVICE_ROLE_KEY=...
python3 scrape.py bootstrap        # opens a browser, you enter the OTP once
```

That saves the Playwright session and pushes it to Supabase Storage. The cloud
runner then reuses it and never sees the OTP again. If the session ever expires,
the runner fails loudly and asks for one more `bootstrap` from a laptop.

Deploy the runner (Cloud Run Job shown; Railway is the same idea):

```bash
gcloud run jobs deploy petpooja-ingest \
  --source workers/petpooja-ingest \
  --set-env-vars PETPOOJA_USERNAME=...,PETPOOJA_PASSWORD=...,\
SPINE_DATABASE_URL=...,SPINE_SUPABASE_URL=...,SPINE_SUPABASE_SERVICE_ROLE_KEY=...
# then schedule it once per business day (Cloud Scheduler -> run the job)
```

## Env vars

| Var | Used by | Notes |
|---|---|---|
| `SPINE_DATABASE_URL` | load | Postgres conn string for the spine |
| `SPINE_SUPABASE_URL` / `SPINE_SUPABASE_SERVICE_ROLE_KEY` | receipt, session | Storage for raw receipts and the OTP session |
| `SPINE_STORAGE_BUCKET_PETPOOJA` | receipt | default `petpooja-raw` |
| `PETPOOJA_USERNAME` / `PETPOOJA_PASSWORD` | scrape | never in code, never in chat |
| `PETPOOJA_SESSION_BUCKET` | scrape | default `petpooja-session` |
| `PETPOOJA_HEADLESS` | scrape | `1` on cloud; bootstrap forces headed |
| `PETPOOJA_DOWNLOAD_DIR` | scrape | default system temp |

## Confirm against the live portal before the first production scrape

Rishabh's pipeline scrapes different reports (`online_orders_report_all`,
`order_summary_item`). The Material Purchase Report at the vendor-OMS outlet has a
URL, an outlet-scoping step, and an export button that have not yet been observed
live. All three are isolated in `scrape.py`'s `REPORTS` table and are env-overridable
(`PETPOOJA_REPORT_URL_OMS_PURCHASE`, `PETPOOJA_OMS_OUTLET_LABEL`,
`PETPOOJA_OMS_PURCHASE_STRATEGY`), so pinning them needs no code change. Until
confirmed, use path A (manual load); the parser and loader are already proven on
real files.

## Build 1a data reality (F13)

Real reconciliation volume begins at **OMS billing go-live**, when the team hand-types
OMS order numbers into vendor-OMS transfers. Every sample seen so far is internal
CK -> Central Dispatch traffic whose invoice numbers are Petpooja transfer-doc
numbers, not OMS order numbers. The machinery here is ready so that go-live is the
only remaining gate.
