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
result.

A cloud server is NOT the exit path, and a section of this README used to say it was.
Petpooja blocks datacenter IPs: confirmed by running the scraper from Google Cloud Run
(Mumbai) and an Oracle Cloud VM, both failing identically while the same saved login
worked from a residential connection at the same moment (bot detection serves
datacenter IPs a stripped page with no export controls). See "The single most important
operational finding" in `HANDOFF.md`. The real end state is an always-on machine on a
trusted office or home connection (per HANDOFF: a small network of trusted
office/home machines), or Petpooja API/report access so scraping stops being needed.

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

Five defences, all in `run_dashboard.sh`:

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
5. **Caffeinate hold** (added 31 July 2026). The instant the network gate passes, the
   run takes a `caffeinate -imsw $$` power assertion, held until the script exits (via
   `-w` on its own pid, plus the EXIT trap). This stops macOS returning to sleep
   mid-run. See the next section for why. `CC_NO_CAFFEINATE` disables it for tests.

### Why defence 5 exists: the 31 July 2026 failure

The 07:58 pmset wake fired, but on **battery with the lid shut** it produced only a
*dark wake*: awake for 45 seconds, then straight back to sleep, so the 08:00, 08:20 and
08:45 slots were all deferred. At 08:49 a maintenance dark wake finally ran the coalesced
job. The network gate waited, Wi-Fi came up, and the scrape **succeeded**. Then about 90
seconds in, the Mac did what a dark wake always does next: it returned to sleep and tore
the network down underneath the still-running job (`spine sync FAILED: No route to host`,
`sub_order_wise: ERR_INTERNET_DISCONNECTED`). The run died partway through, and the
alert email could not send either because DNS was already gone.

The lesson: the network gate (defence 3) guards only the **start** of a run; nothing kept
the machine awake **through** it. Defence 5 does. Verified that `caffeinate -imsw`
registers a live `PreventUserIdleSystemSleep` assertion with `powerd` (the one honored on
battery) and releases the moment the run ends.

**This is a mitigation, not a cure.** A power assertion holds a dark wake open, but the
underlying fragility is running a multi-minute networked job on a closed-lid laptop on
battery, which macOS is built to prevent. The two things that make it genuinely reliable
are outside the script: keep the Mac **plugged in** overnight (on AC, dark wakes stay
alive and the network holds), and ultimately move the job to an always-on machine on a
trusted IP. Tracked as F14.

Slots: 08:00, 08:20, 08:45, 09:15, 10:00, 11:00, 12:30, 14:00. The spread runs to 14:00
so a laptop that stays shut all morning still delivers.

Manual re-run after a failure:
```
bash ~/creme-castle-erp/dashboard/auto/run_dashboard.sh --force
```

### The silent spine outage (2 August 2026): pooler, alert, lookback

Three runs (31 July to 2 August) delivered the dashboard normally while their spine
load failed, so the ERP portal's report downloads silently froze at 31 July ~11:00.
Nobody was told, because the spine steps are best effort ("dashboard unaffected"):
the run exits 0, the stamp is written, and defence 4 never fires. Root cause was
environmental: Supabase's direct DB hostname (`db.<ref>.supabase.co`) is **IPv6
only** (AAAA record, no A record), and the Mac's network stopped providing IPv6.
The HTTPS APIs kept working (the project hostname has IPv4 via Cloudflare), which
is exactly why the failure was invisible from the inbox. Three changes:

1. **Pooler connection.** `SPINE_DATABASE_URL` in `.env` now uses the Supavisor
   session pooler (`postgres.<ref>@aws-1-ap-south-1.pooler.supabase.com:5432`),
   which is IPv4 compatible. Never point it back at `db.<ref>.supabase.co` on a
   machine that roams between networks.
2. **Spine failure alert.** `run_daily.py` collects spine sync and sub-order load
   failures and, after the dashboard and email have gone out, mails the owner via
   `alert_failure.send_alert` (subject "CC dashboard delivered BUT spine load
   FAILED"). Best effort itself: an alert problem cannot fail a delivered run.
3. **Sub-order lookback.** The sub-order loader used to pull only yesterday, so a
   failed morning lost that day permanently (31 July and 1 August were backfilled by
   hand). It now loads every day missing from the spine in the last
   `SUB_ORDER_LOOKBACK_DAYS` (7), oldest first, so it heals itself. The insert is
   idempotent on `(business_date, row_hash)`, so re-loading a day is harmless.

Orders and items always healed themselves (the sync verifies a rolling window);
the lookback gives the sub-order report the same property. Tracked as F15 in
`erp-plan/integration-notes.md`.

### Target state: an always-on machine on a trusted IP

An earlier version of this section prescribed a cloud server. That was tried and does
not work: Petpooja blocks datacenter IPs (see the note at the top of this section, and
`HANDOFF.md`). The `deploy/` folder and its `DEPLOY.md` are the Cloud Run packaging
from before that finding; the container itself is host-agnostic (state lives in
Supabase Storage, `DASH_CLOUD=1`), so it remains useful for any future host with a
trusted IP, but there is no datacenter it can usefully run in.

The target is an always-on machine on an office or home connection (a spare Mac mini
or small PC that never sleeps), scheduled once per morning:
```
# cron (IST, always-on machine on a residential/office IP), 08:00 daily
0 8 * * *  cd /path/to/auto && python3 run_daily.py --allow-unmapped >> run.log 2>&1
```
With `DASH_CLOUD=1` the history parquet is pulled from and pushed to Supabase Storage
each run, so the machine needs no precious local state. A machine that never sleeps has
no deferral and no dark wake, so the failure mode above does not exist there; the stamp
and lock stay useful, the network gate becomes belt and braces. Alternatively, Petpooja
API or scheduled-report access (pending admin questions, `petpooja-admin-checklist.md`)
would remove the scrape, and with it the IP sensitivity, entirely.

## Validated 23 Jul 2026
Enrichment reproduces the hand-made file 100% (aliases/category/city/date), 99.98% Hour.
Dashboard from parquet history is byte-identical to the direct .xlsb run. Re-scrape dedup
is clean (orders +0, items only genuinely-new live orders).
