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

What actually runs today: a macOS launchd agent on Pranjay's Mac, not a cloud cron.
`~/Library/LaunchAgents/in.cremecastle.dashboard.plist` calls `run_dashboard.sh`, which
waits for the network, git-pulls, runs `run_daily.py --allow-unmapped`, and emails the
result. The intended end state is still the always-on cloud server described below, and
moving there removes every problem in this section at a stroke.

The checkout must be on the LOCAL disk (`~/creme-castle-erp`). macOS refuses to let a
launchd agent execute anything under `~/Library/Mobile Documents` (iCloud Drive): it
fails with "Operation not permitted". That is why the 8am job silently did nothing on
24 and 25 July 2026.

### Why there are eight slots, not one (30 July 2026)

The lid was shut at 07:45, so the Mac was asleep at 08:00 and launchd deferred the job.
launchd gives a missed `StartCalendarInterval` exactly **one** catch-up firing, on the
next wake of **any** kind, and it spent that firing on an 08:58 dark wake (a silent
maintenance wake, lid still shut, Wi-Fi not yet associated). Every network call failed
on DNS within seconds, the run died, and because the wrapper then ended in an `echo`,
its exit status was the echo's: launchd recorded **success**. No dashboard, no email,
no retry, no alert. The only symptom was an absence, noticed hours later.

Note the shape of this: it is not a rare race. The Mac dark-wakes every few minutes
while the lid is closed, so the catch-up firing will nearly always land on a wake with
no network. Any morning the lid is shut at 08:00 would have failed the same way.

Four defences, all in `run_dashboard.sh`:

1. **Success stamp** (`.last_success`, gitignored). Holds the date of the last delivered
   morning. Later slots see it and exit in milliseconds, so extra slots cost nothing and
   cannot double-send. `--force` overrides it for manual re-runs.
2. **Lock** (`.run.lock`). One run at a time, so a slow 08:00 run and the 08:20 slot
   cannot both scrape and both email. A lock with no live pid is reclaimed only if it is
   over 30 minutes old; otherwise the slot stands down. The bias is deliberately towards
   doing nothing, because guessing wrong means two emails.
3. **Network gate.** Nothing starts until the Supabase host from `.env` actually answers
   over HTTPS (DNS plus TLS plus egress, not just a link light). If it never does, the
   run exits 75 and does **not** write the stamp, so the next slot picks it up. The
   budget is counted in attempts, not wall clock, on purpose: the process is frozen while
   the Mac sleeps, so a wall-clock deadline would expire during sleep and reintroduce the
   bug. `CC_NET_PROBE_HOST` / `CC_NET_TRIES` / `CC_NET_SLEEP` exist for testing.
4. **Honest exit code plus an alert.** The wrapper `exit`s with Python's real status, so
   `launchctl list` stops reporting 0 for a dead morning, and `alert_failure.py` emails
   the owner (first recipient only, not the whole list) once per day with the last 60
   lines of `run.log`. A broken morning now says so instead of being an absence.

Slots: 08:00, 08:20, 08:45, 09:15, 10:00, 11:00, 12:30, 14:00. The spread runs to 14:00
so a laptop that stays shut all morning still delivers.

Manual re-run after a failure:
```
bash ~/creme-castle-erp/dashboard/auto/run_dashboard.sh --force
```

### Target state: cloud server
Run on the same always-on cloud server as the Petpooja ingestion (it shares the scraper
and the saved session). Schedule once per morning, after enough of the prior day is in:
```
# cron (IST server), 08:00 daily
0 8 * * *  cd /path/to/auto && python3 run_daily.py --allow-unmapped >> run.log 2>&1
```
The history parquet must live on that server (persistent disk) so comparisons keep their
full history. An always-on server never sleeps, so the sleep/dark-wake failure mode above
simply does not exist there; the stamp and lock stay useful, the network gate becomes
belt and braces.

## Validated 23 Jul 2026
Enrichment reproduces the hand-made file 100% (aliases/category/city/date), 99.98% Hour.
Dashboard from parquet history is byte-identical to the direct .xlsb run. Re-scrape dedup
is clean (orders +0, items only genuinely-new live orders).
