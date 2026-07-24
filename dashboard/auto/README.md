# Creme Castle — automated daily dashboard

Builds and emails `cc_daily.html` on its own each morning. It pulls the two Petpooja
reports, enriches the item side (Zomato/Swiggy + glossary + 7am business day), keeps a
running history, runs the existing dashboard (`../cc_dashboard`), and emails the result.
No manual Google-Sheets step, no manual file drops.

## Pieces
- `enrich.py` — raw item export -> the enriched item sheet the dashboard needs. Flags
  any item missing from the glossary. Validated to reproduce the hand-made file 100%.
- `glossary/*.csv` — editable maps (item->Alias/Category, outlet->City/Type/Code). Add a
  row when a new item appears; that is the ONE thing a human maintains.
- `history_store.py` — the running history as two parquet files under `history/`
  (`orders.parquet`, `items.parquet`), appended each day and deduplicated.
- `run_daily.py` — the orchestrator: scrape -> enrich -> append -> build -> email.

## One-time setup
```bash
pip3 install -r ../cc_dashboard/requirements.txt pyarrow playwright
python3 -m playwright install chromium
```
Seed the history once from the "1 April onwards" exports (already done 23 Jul 2026):
```python
python3 -c "import history_store as h; h.seed_from_samples('<order .xlsx>', '<item .xlsb>')"
```
The Petpooja login session is the same one the kitchen ingestion uses (saved in Supabase
Storage); no OTP needed here.

## Run it (manual, ~3 minutes)
```bash
python3 run_daily.py                 # scrape yesterday, build, email
python3 run_daily.py --no-email      # build only, open auto/cc_daily.html
python3 run_daily.py --no-scrape     # rebuild from existing history (fast)
```
If a new item has no glossary mapping, the run STOPS and lists the items. Add them to
`glossary/item_glossary.csv` (item_name, Alias, Category) and re-run. To let the run
finish anyway (item counts under its raw name, flagged in the email), add `--allow-unmapped`.

## Env
Scraping reuses the kitchen worker's env (`SPINE_SUPABASE_URL`, `SPINE_SUPABASE_SERVICE_ROLE_KEY`
for the saved session; `PETPOOJA_HEADLESS=1`). Email needs:
```
DASH_SMTP_HOST=smtp.gmail.com
DASH_SMTP_PORT=587
DASH_EMAIL_SENDER=<from address>
DASH_EMAIL_APP_PASSWORD=<16-char Gmail App Password, NOT your login password>
DASH_EMAIL_RECIPIENTS=a@x.com,b@y.com
```

## 8am automation
Run on the same always-on cloud server as the Petpooja ingestion (it shares the scraper
and the saved session). Schedule once per morning, after enough of the prior day is in:
```
# cron (IST server), 08:00 daily
0 8 * * *  cd /path/to/auto && python3 run_daily.py --allow-unmapped >> run.log 2>&1
```
The history parquet must live on that server (persistent disk) so comparisons keep their
full history.

## Validated 23 Jul 2026
Enrichment reproduces the hand-made file 100% (aliases/category/city/date), 99.98% Hour.
Dashboard from parquet history is byte-identical to the direct .xlsb run. Re-scrape dedup
is clean (orders +0, items only genuinely-new live orders).
