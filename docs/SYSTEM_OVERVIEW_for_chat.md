# CC Dispatch Console — Complete System Overview

**Purpose of this document:** a self-contained description of the CC Dispatch Console —
what it is, how it is built, what its modules are, and how it works in detail — written
so a reader with no access to the repo or prior chats can reason about **whether a new
tool should be an extension of this system or a separate tool**. Compiled 21 Jul 2026
from the repo (the project's only memory: specs, decisions log, migrations, code).

**Owner:** Pranjay (Creme Castle). **Live at:** https://cc-dispatch-console.vercel.app
**Repo:** github.com/pranjaym/cc-dispatch-console (private).

---

## 1. What this system is, in plain English

Creme Castle is a bakery chain in North India: one central kitchen supplies **~40
outlets** (Delhi-NCR, Jaipur, Meerut, Chandigarh; 4 Lucknow outlets exist but are
excluded from the model and supplied separately — 44 shops total in the network) with
perishable products (cakes, desserts, cheesecakes, cookies, croissants — shelf lives of
2–5 days). Every day someone must decide **how many units of each item to dispatch to
each outlet**: too many → wastage, too few → stockouts. The primary KPI is **W/S
(Wastage ÷ Sales), target ~6%**.

That decision is made by **CC_DISPATCH V20**, a production Python model (EMA
forecasting + per-pair regime classification) that used to be run by hand: two scripts,
13 config CSVs, five output files, emailed around manually. The **CC Dispatch Console**
is the web application built around that model. Its core covenant:

> **The model is never modified.** Everything under `/model` (the two production
> scripts + 13 config CSVs) and `/model_dashboard` (the Inventory Dashboard kit V5) is
> verbatim and read-only. The console *runs* them, stores every input and output
> forever, and proves — byte-for-byte — that a run through the app equals a run done
> by hand on the same inputs.

Today the console does, in production: real sign-in with roles, daily feed upload,
validation, a date-confirmation gate, cloud execution of the untouched model, every
output as a native screen plus one-click downloads, permanent reproducible run history,
config editing with a propose→approve workflow, Pawan's manual additions folded into a
"final plan", and next-day reconciliation of what outlets actually received. The manual
script workflow remains untouched as the fallback.

---

## 2. The timeline concept (the vocabulary everything uses)

The model plans **two days ahead**, because supply for tomorrow is already in motion:

| Day | Meaning |
|---|---|
| **Day N** | Last complete data day in the uploaded feed (auto-detected as the latest date with Sales > 0; manual override exists). Source of closing stock and the EMA training window. |
| **N+1** | Supply already arriving (from the feed's `Supply_N_Plus_1` column). A given, not planned. |
| **N+2** | **The dispatch being planned.** All output quantities target this day. |
| **N+3** | Extra coverage day, used only for **alternate-day outlets** (their forecast window spans N+2 + N+3). |

Example of record: Day N = Fri 10-Jul-2026 → the model plans the dispatch for
Sun 12-Jul-2026.

Alt-day outlets (9 in the model config: Meerut, 4× Chandigarh, 4× Lucknow — the
Lucknow ones are also excluded outright) receive supply every other day. If an alt
outlet already receives supply on N+1, the whole outlet is skipped for N+2
(`SKIP_ALT_NP1`).

---

## 3. Architecture as deployed

```
Browser
  └─ Vercel · Next.js App Router (functions pinned bom1/Mumbai)
       — server routes only; role checked on EVERY handler; no client-side Supabase
       ├─ Supabase Auth      (email+password, invite-only, no public signup)
       ├─ Supabase Postgres  (ap-south-1: profiles, runs, config tables/rows,
       │                      change_trail [append-only, DB-enforced], dispatch_lines,
       │                      config_proposals, plan_additions, outlet_aliases)
       └─ Supabase Storage   (private bucket `dispatch`: feeds, config snapshots,
                              artifacts, payloads, bundles)
              ▲ service-role key, server-side only (zero NEXT_PUBLIC_ vars)
Runner · Railway container (FastAPI + pandas/numpy/scipy/openpyxl
                            + /model + /model_dashboard copied in VERBATIM)
        POST /validate         (sync: stock-identity check + Day-N detect at upload)
        POST /execute          (202 → async pipeline; progress written to the run row;
                                frontend polls — Vercel timeouts irrelevant)
        POST /parse-additions  (parse Pawan's manual-additions workbook)
        POST /receiving        (read what outlets received on a date, from a later feed)
```

- Stack: Next.js 16 (App Router, React 19) + TypeScript, plain-CSS design tokens (no
  Tailwind — a deliberate, logged decision to protect the approved visual design).
- Cost ≈ **$30/mo** (Supabase Pro ~25 + Railway ~5 + Vercel Hobby 0).
- Env vars (names only): `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `RUNNER_URL`, `RUNNER_SECRET`. Secrets never in code,
  repo, or chat.
- The runner is **stateless** — its only job is pull inputs → run the untouched
  scripts → push artifacts/status. It exists because the model is Python
  (pandas/scipy) and is never rewritten; this is the one documented deviation from the
  company's standard web stack.

---

## 4. The model core (CC_DISPATCH V20) in detail

Two programs: `cc_dispatch_v20.py` (the dispatch engine) and `cc_postprocess_v20.py`
(readiness + visibility matrices), plus the separate dashboard kit (§4.7).

### 4.1 Input feed

One file — the "Daily Inventory Plan" export (xlsx or CSV, ~7 MB, ~52k rows): a tidy
panel of one row per **Date × Outlet × Item** covering at least the 14-day window
ending on Day N. Columns (export name → internal): `Outletname`→Outlet, `Item`→
Item_Name, `Shelf Life (in days)`→Shelf_Life, `Opening_N`→Opening_Stock,
`Receiving_N`→Qty_Received, `Sales_N`→Sales, `Wastage_N`→Wastage,
`Closing_N`→Closing_Stock, `Supply_N_Plus_1`→Supply_NP1, plus Date and Category
(and Sales amount / Wastage Cost / MRP, used by the dashboard). Dates parse
multi-format with a hard 2024–2030 sanity guard.

### 4.2 Validation (fail-loud)

Every row must satisfy the **stock identity**:
`Opening + Receiving − Sales − Wastage = Closing` (|residual| > 0.01 = failing row).
If **more than 5%** of rows fail, the model raises and refuses to dispatch — this
guards against column-shifted exports (a real historical incident). The console runs
this same check at upload time (via the runner) *and* the model re-checks in the
pipeline as defence in depth. Excluded items (20) and excluded outlets (4 Lucknow) are
dropped from the dataset at load.

### 4.3 Forecasting (per Item × Outlet)

- **Window:** last 14 days ending Day N (`Lookback_Days = 14`).
- **Valid days:** a day is *excluded* from training if it falls in a configured
  excluded-date range (festivals etc.) or if the outlet had no stock to sell that day
  (`Opening + Receiving == 0`, "StartOOS"). `n_valid` = count of remaining days.
- **Seasonality normalization before training:** each day's sales are divided by
  `DOW_Factor × DOM_Factor` (day-of-week × day-of-month), so the EMA learns the
  underlying level, not the weekly shape.
- **EMA:** iterative `ema = α·sales + (1−α)·ema`, **α = 0.25**, seeded at the oldest
  valid value, floored at `Min_Forecast = 0.5`.
- **P85:** the 85th percentile of normalized valid sales — feeds the spike cap.
- **Projection:** the EMA is re-seasonalized for the target date(s):
  `Forecast_N+2 = ema × factor(N+2)` for daily outlets;
  `Forecast_2Day = ema × (factor(N+2) + factor(N+3))` for alt-day outlets.
- **Factor resolution priority:** date-specific override (wins outright) →
  category-DOW × DOM → default DOW. Defaults: Mon 0.90 … Fri/Sat/Sun 1.07; DOM:
  1st = 1.15 (payday), 30th = 1.08.

### 4.4 Regime classification (the decision order — first match wins)

Every Item × Outlet pair gets exactly one regime per run:

1. **SKIP_ALT_NP1** — the outlet is alt-day and already receives supply on N+1: the
   *whole outlet* is skipped before any per-pair calculation. Dispatch 0.
2. **ZERO_OVERRIDE** — the (Item, Outlet) pair is in `zero_overrides.csv` (manual
   mute, 286 rows). Checked **first** inside the calculation — no regime can beat it.
   Dispatch 0.
3. **ZERO_ALL_OOS** — `n_valid == 0` (no sellable history in the window). Dispatch 0.
4. **LOW_DATA** — `0 < n_valid < 5`: target = 1 unit, flagged for manual review.
5. **Regime A** (high movers / bypass items) — EMA ≥ 1.7 (daily) / 1.75 (alt), or the
   item is in `bypass_items.csv` (9 top-revenue items forced to A).
   **Target = Poisson inverse-CDF at the service level** for the forecast demand:
   `target = round(poisson.ppf(sl, forecast_window))`, where `sl` comes from
   `sl_matrix.csv` by shelf life × outlet type (e.g. shelf 2 → 0.90 daily / 0.75 alt;
   shelf 5 → 0.99 / 0.94). Probabilistic fill: cover demand with probability `sl`.
6. **D / D2** (slow movers, EMA < 0.8) — fixed cap of 1 unit. D = shelf life ≥ 3,
   D2 = shelf life < 3.
7. **B / C1 / C2** (mid-band, 0.8 ≤ EMA < threshold) — split by shelf life
   (B ≥ 4 days, C1 = 3, C2 ≤ 2). **Cap = max(floor 2, min(base, spike))** where
   `base = ceil(cycle_ema × mult)` (cycle_ema = EMA×2 for alt outlets),
   `spike = ceil(P85 × spike_mult)` (only binding when P85 ≥ 2).
   Multipliers (daily/alt/spike): B 2.0/1.3/2.5 · C1 1.7/1.2/2.0 · C2 1.3/0.8/1.8.

**Final dispatch, uniformly:** `dispatch = max(0, target − Usable_Opening_N+2)`.
`Usable_Opening_N+2` comes from a **FIFO shelf-life simulation**: take Day-N closing
stock + N+1 receipts, simulate N+1 selling at the forecast, age the remainder one day
against per-batch shelf life (batches reconstructed from the last 10 days of receiving
history), and count only what is still sellable (SAFE + AT_RISK, not EXPIRED) on the
morning of N+2.

### 4.5 Readiness classification (post-processor, the N+1 morning view)

Per pair: `stock = Closing(N) + Supply(N+1)`; `doc` = days of cover at the
DOW-adjusted EMA (alt outlets not resupplied use a 2-day coverage window). Bands,
first match wins: **BLANK** (no demand, no stock) · **ORPHAN** (stock but zero
demand) · **ZERO** (demand, zero stock) · **SHORT** (doc < coverage) · **TIGHT**
(doc < 1.2× coverage) · **OK** (doc < 85% of shelf life) · **EXCESS** (doc < shelf
life) · **WASTAGE_PRONE** (doc ≥ shelf life — money burning).

### 4.6 The 13 config files (the model's entire tuning surface)

| File | Rows | Controls |
|---|---|---|
| `parameters.csv` | 27 | Every scalar knob. Production values: Alpha 0.25 · Lookback 14 · Min_Valid_Days 5 · Min_Forecast 0.5 · A thresholds 1.7/1.75 · D threshold 0.8 · caps/multipliers as in §4.4 · Floor_Cap 2 · Low_Data_Target 1 · shelf splits 4/3/3 · Alt_Cycle_Multiplier 2. **The CSV wins over in-code defaults** (several differ — always display what the file says). |
| `sl_matrix.csv` | 4 | Shelf life → Poisson service level (daily & alt columns) for Regime A. |
| `item_buckets.csv` | 67 | Item → shelf life (the model's sole shelf-life source). |
| `bypass_items.csv` | 9 | Items forced into Regime A regardless of EMA. |
| `zero_overrides.csv` | 286 | (Item, Outlet) pairs muted to zero, with rationale. |
| `alt_day_outlets.csv` | 9 | The alternate-day outlets. |
| `excluded_items.csv` | 20 | Items removed from the data entirely. |
| `excluded_outlets.csv` | 4 | Outlets removed entirely (the 4 Lucknow shops). |
| `excluded_dates.csv` | 13 | Date ranges excluded from EMA training (festivals, anomalies). |
| `dow_factors.csv` | 7 | Default weekday factors. |
| `dow_factors_category.csv` | 5 | Per-category weekday factors. |
| `dow_factors_date.csv` | 2 | Specific-date overrides (win outright). |
| `dom_factors.csv` | 2 | Day-of-month (payday) factors. |

### 4.7 Model outputs (the five files, per run)

1. **`output_dispatch.csv`** — the kitchen file: Outlet, Item, Category,
   `Supply_<N+2 date>`. This is the byte-parity reference artifact.
2. **`output_detailed.csv`** — the planner file: per pair, 7 days of sales, EMA, P85,
   n_valid, regime, caps, SL used, target, the full stock chain (Closing N → Supply
   N+1 → Usable Opening N+2 → dispatch), shelf life, wastage/OOS history.
3. **`cc_menu_visibility_<N+2>.html`** — Items×Outlets matrix; each cell shows
   EMA · regime · cap, with hover detail and filters. Self-contained HTML.
4. **`cc_readiness_<N+1>.html`** — the 7-band readiness matrix with shortfall
   summaries. Self-contained HTML.
5. **`cc_lowdata_items_<N+2>.csv`** — the LOW_DATA pairs sorted by EMA — the manual
   review list.

### 4.8 The Inventory Dashboard kit (V5) — a second, separate production package

`/model_dashboard` generates a single self-contained `cc_inventory_dashboard.html`
(~850 KB, Chart.js inlined): daily briefing, yesterday at a glance, trends, wastage
anatomy, "real-basis" OOS analysis (zero-override pairs excluded from both numerator
and denominator), tomorrow's risk map, alt-day sub-dashboard, item reference and
drilldown. It has its **own config CSVs that deliberately diverge from the model's**
(13 alt outlets vs 9; a 513-row zero-overrides master vs the model's 286; its own
excluded/discontinued lists) and its own methodology rules (W/S = wasted units ÷ sold
units; sum components, divide last; descriptive windows with no excluded-dates logic).
It supports analyst `observations.json` cards; console-generated runs currently embed
an empty list (analyst commentary is still a chat workflow — a documented limitation).

---

## 5. How a run works (the lifecycle) and the parity guarantee

### 5.1 Run lifecycle

1. **Upload** — Planner/Admin drops the day's export. The browser uploads **directly
   to Supabase Storage** via a single-use signed URL (the ~7 MB file never transits
   Vercel). The server moves it under the new run's folder and calls the runner's
   sync `/validate`.
2. **Validating → aborted or queued** — stock-identity check + Day-N auto-detect.
   \>5% failing rows → the run is recorded as `aborted` with a real-numbers failure
   screen (worst 10 offenders shown). Otherwise `queued`.
3. **The date gate** — the single most protected step (wrong date = the #1 historical
   failure mode). A card shows Day N → N+3 each with weekday, the L14 training
   window, excluded-date ranges in force inside it, date-specific DOW overrides in
   the dispatch window, and DOM factors. Day N can be manually overridden while
   queued. Planner/Admin must explicitly Confirm. A queued run can be **discarded**
   with a required reason (recorded, never deleted).
4. **Running** — confirm fires the runner's async `/execute` (202). The runner:
   downloads the feed → **materializes the 13 configs from Postgres to CSVs**
   (§5.2) → snapshots + hashes them → re-validates → runs `cc_dispatch_v20` then
   `cc_postprocess_v20` verbatim (stdout captured) → builds the dashboard → uploads
   6 artifacts + 8 JSON payloads + `bundle.zip` → loads `dispatch_lines` (2,656
   rows) → writes totals/distributions on the run row. Progress is written to the
   run row at each step; the frontend polls. ~60–90 s end to end.
5. **Done / failed** — failed runs show full stdout and can be requeued (same
   inputs, must re-confirm the gate). **One active run at a time**, enforced by a
   DB partial unique index, not UI.

Storage layout per run: `runs/<id>/input/<feed>` · `config_snapshot.zip` +
`config_manifest.sha256.json` · `artifacts/*` (dispatch CSV, detailed CSV, both
HTMLs, low-data CSV, dashboard HTML) · `payloads/*.json` (run_meta, dispatch,
detailed, visibility, readiness, distribution_plan, validation, orphans) ·
`stdout.log` · `bundle.zip`. Runs store ~5 MB forever — that is the
reproducibility promise (~2 GB/yr at one run/day).

### 5.2 The parity guarantee (the load-bearing design)

The configs live in Postgres as **positional arrays of raw cell strings** (never
dicts — `parameters.csv` has duplicate empty header names that a dict would
collapse), with per-file byte quirks (CRLF, missing trailing newlines) recorded at
import. At run start, **the runner** materializes them to CSVs with one Python
serializer (`runner/serde.py`) — the same module the importer used, which refuses
any file that does not round-trip byte-for-byte at import time (all 13 production
files verified). The snapshot zip + SHA-256 manifest + `config_hash` (hash of the
sorted per-file manifest — stable across zip timestamps) are stored **before the
model executes**.

`scripts/parity_check.py <run_id>` is the standing regression: it downloads any
run's raw inputs from Storage, runs the untouched scripts directly, and byte-diffs
`output_dispatch.csv` against the stored artifact. The deployed app's reference run
produced a file **byte-identical** to the manually-run original
(sha256 `443796c2e5ea5e4d…`), and the check passed again on later real days. Same
feed + same configs = same hash, forever. An approved config edit changes the
`config_hash` on the next run — drift is visible by construction.

---

## 6. Database schema (Supabase Postgres, migrations 001–004)

All tables have RLS enabled with **zero policies on purpose** — nothing is readable
by the anon/authenticated roles; every access goes through server handlers holding
the service-role key plus an explicit per-handler role gate. No hard deletes exist
anywhere in the schema.

| Table | Purpose / notable mechanics |
|---|---|
| `profiles` | Console users → auth.users. role enum (admin/planner/viewer), `active`, `must_change_password`. |
| `runs` | One row per dispatch run: day_n, dispatch_date, status enum (queued/validating/running/done/failed/aborted), live `progress` text, created_by/confirmed_at/finished_at, totals + regime & readiness distributions (jsonb), validation report (jsonb), `config_hash`, all Storage paths. **Partial unique index `runs_one_active`** = one queued/validating/running run globally. |
| `config_tables` | The 13 config files' metadata: column order (jsonb), per-file serde (line terminator, trailing newline), source file path. |
| `config_rows` | The cells: (table_name, seq) → positional string array (jsonb), `active` flag (deactivate, never delete). |
| `change_trail` | **Append-only audit log** — a DB trigger raises on UPDATE/DELETE *even for the service role*. Rows from imports (13 config files, 98 tracker entries), config edits, system events. Carries actor, old/new (with sha256 fingerprints), rationale, source enum. |
| `dispatch_lines` | Per run × outlet × item: `planned_qty` (the model) and `actual_shipped_qty` (filled by M4b reconciliation, see §8.3). |
| `config_proposals` | M3: table_name, proposer, required rationale, full proposed row set (jsonb), `base_hash` (stale-base conflict detector), status enum (pending/approved/rejected/withdrawn), decider + decision note (a rejection *must* carry a note — check constraint). **One pending proposal per table** (partial unique index). |
| `plan_additions` | M4a: Pawan's manual-addition uploads per run — rows (jsonb), summary, original file + sha256 in Storage. **One active per run**; re-upload supersedes (`superseded_by`), never deletes. |
| `outlet_aliases` | Maps a sheet's outlet name → the canonical feed/model name (e.g. `CC-ND-Gaur City 1` → `CC-ND-Diamond Plaza`, `CC-GGN-Sector 37` → `CC-GGN-Sector 52`). Deliberately a **console table, not a 14th model config** — the model package, materializer, and parity check stay untouched. |

Migration ritual: every migration runs → STOP → verification script output → human
witness before anything is built on top (001: 8/8, 002: 9/9, 003: 9/9, 004: 7/7 —
all witnessed, logged in `migrations/VERIFICATIONS.md`).

---

## 7. The console's modules (screens) and roles

**Roles:** **Admin** (Pranjay — approves config changes, manages users) · **Planner**
(uploads feed, runs model, proposes changes — Pawan, Rishabh) · **Viewer** (read-only
outputs + downloads — area managers / supply chain / kitchen). Enforced **server-side
on every handler** — a Viewer calling a Planner endpoint provably gets 403; hidden
buttons are not security. `pranjay@` is untouchable in-app (cannot be deactivated,
demoted, or removed).

| Screen | What it shows | Roles |
|---|---|---|
| **Daily Run** (`/run`) | The live 5-step stepper: upload → validation report → date gate → live progress → run summary (regime distribution in regime colors, total units, daily vs alt split, attention counts). Discard with reason; requeue on failure. | Admin, Planner |
| **Dispatch table** (`/outputs/dispatch`) | Every dispatch line; filters (city/outlet/category/item/regime/non-zero), sort, CSV export, per-outlet A4 print slip. | All |
| **Distribution plan** (`/outputs/plan`) | The kitchen's N-Format pivot: items down in the sheet's category blocks, 40 outlets across in the sheet's column order, its four grouping totals + category subtotals, print + CSV. |All |
| **Production plan** (`/outputs/production`) | Per-item production totals for the kitchen. | All |
| **Final plan** (`/outputs/final`) | **Model + Pawan's manual additions = final dispatch**, three numbers side by side, alias-resolved, with a "Topped up (last N)" counter per pair (see §8.2). | All |
| **Menu visibility** (`/outputs/visibility`) | Native port of the production Items×Outlets matrix (EMA · regime · cap per cell, hover detail, 6 filters, KPI strip). | All |
| **Readiness** (`/outputs/readiness`) | Native port of the 7-band N+1 readiness matrix (status pills, presets, 4 cell display modes, sparkline tooltips). | All |
| **Low-data items** (`/outputs/lowdata`) | The run's LOW_DATA pairs with context + export of the production CSV. | All |
| **Regime changes** (`/outputs/regimes`) | Run-over-run: every pair whose regime moved, grouped by transition. | All |
| **Inventory dashboard** (`/outputs/dashboard`) | The kit-V5 HTML embedded + downloadable. | All |
| **Run history** (`/history`) | Every run ever: status, totals, config-hash short, who ran it, duration; open any run's outputs; one-click `bundle.zip` (6 artifacts + stdout). A run selector in the top bar drives **all** output screens to any completed run. | All |
| **Config Center** (`/config`, `/config/[name]`) | All 13 configs as clean tables, sensitive files badged, parameters grouped by section; entry point to propose a change. | Admin, Planner |
| **Config changes / Approvals** (`/approvals`) | The proposal queue: LCS-based before/after diff, proposer + rationale, Approve / Reject (reason required) / Withdraw; pending badge in the nav. | Admin, Planner (only Admin decides) |
| **Change Trail** (`/trail`) | The append-only history (tracker imports + console-written rows), filterable, CSV export. | Admin, Planner |
| **Orphan report** (`/reports/orphans`) | Config-vs-feed cross-check (see §8.4). | Admin, Planner |
| **Users & roles** (`/admin/users`) | Add user (one-time temp password shown once), deactivate/reactivate, change role, reset password. | Admin |
| **Design** (`/design`) | The approved regime/readiness palette mapping on real matrix excerpts. | Admin, Planner |

Frontend architecture note: screens consume **only a typed service layer**
(`app/src/services/`) — in M1 it resolved static JSON; in M2 the implementations
swapped to API calls without touching the screens. That bet is why the Vite→Next.js
port kept every screen verbatim.

---

## 8. Workflows beyond the daily run

### 8.1 Config editing (M3): propose → approve → apply

Any Planner opens a config table, edits a cell / adds a row / removes a row (removal
= deactivate), types a **required rationale**, and submits. Rules: one pending
proposal per table (the second person is told who holds it); the proposer can
withdraw. The Admin sees a pending badge and a **real diff** — LCS sequence diff
with best-match pairing, so "remove row A + edit row B" reads exactly like that, not
as a 286-row cascade. Approve applies with importer-identical semantics (upsert by
seq, deactivate surplus, never delete), asserts the DB re-materializes to exactly
the approved bytes, and writes one `change_trail` row carrying proposer, approver,
rationale, and before/after sha256s. Reject requires a reason. A proposal whose base
table changed underneath (`base_hash` mismatch) is refused as stale at approval
time. The change takes effect on the **next run**, visibly, via a new
`config_hash`. Bulk path (rare): edit `config_working/*.csv` + run the re-runnable
importer script — same trail, same round-trip gate.

### 8.2 Manual additions → the final plan (M4a)

Pawan tops up the model's plan with a daily "Manual Additon" workbook (Store Name ·
Item Name · Transfer Qty) — **exceptions of the day, deliberately not a fixed
category** (a logged owner correction: one day's file happened to be gifting items;
the pattern must name itself, not be baked in). Upload → runner parses verbatim →
stored against the run (one active per run; re-upload supersedes). The **Final plan**
screen shows model + manual = final per outlet × item, resolves outlet-name aliases
(so the same physical store never appears twice), flags names that resolve to
nothing, and shows **"Topped up (last N)"** — how many of the last 14 sheets topped
up each pair, so a standing correction (12/14) stands out from a one-off and can
graduate into a config change via §8.1.

### 8.3 Actual-shipped reconciliation (M4b) — derived, never typed

Nobody logs what shipped. The daily feed already carries `Receiving` per outlet ×
item × date — a dispatch for day D appears as Receiving on D in the **next day's
feed**. The console finds the first later run whose feed covers the dispatch date,
reads Receiving via the runner, and shows plan vs actual (gap per line + unplanned
receipts); one click pins it into `dispatch_lines.actual_shipped_qty`. Zero added
daily work. Stated caveat: Receiving is what the *outlet booked*, not what the
kitchen loaded — transit and late bookings live in the gap. (Measured: 12-Jul
planned 5,786 → received 5,987, +3.5%.)

### 8.4 Orphan report

Cross-checks configs against the feed universe, report-only (cleanup is a human
decision via §8.1). For zero_overrides, the decomposition matters and was corrected
against the V20 order of checks: on the reference run, 286 rows = **207 applied**
(204 distinct pairs; 3 duplicate rows) + **62 on whole-outlet-skipped alt days**
(the ban simply isn't evaluated that day) + **17 truly not in the feed**, plus a
must-be-zero **ANOMALY** bucket (a banned pair carrying any other regime = override
key not matched — alarmed loudly; 0 in production). Per-bucket CSV export includes
last-seen dates — which exposed that 50 of the 62 skipped pairs were silently
discontinued items.

### 8.5 Users and access

Invite-only, no email flows (a logged decision — zero deliverability dependency):
Admin creates a user → one-time password shown **once**, handed over by
call/WhatsApp → forced password change at first sign-in. Deactivation flips the
profile *and* bans the auth user in lockstep, so access dies immediately.
Self-service password change + admin reset both exist.

---

## 9. Design system (locked and approved)

- Tokens single-sourced in `app/src/theme/tokens.css`. Functional pairs: success
  green `#2F5630` on `#E9F2E6` · attention amber `#92400E` on `#FEF3E2` · danger red
  `#872724` on `#FBEAE6`. Accents: butter, pink, lavender, sage. Brand: coral
  `#DB5436` (primary actions), deep maroon `#3C0618`, warm neutrals; no harsh black.
- Georgia (serif) for display; system sans for body/data. English only.
- **Tabular numerics on every number column**; ₹ with en-IN grouping (₹1,23,456);
  **every date carries its weekday** (`12 Jul 2026 · Sunday` / `12-Jul · Sun`).
- The regime and readiness palettes are a formally approved mapping from the team's
  pre-existing color semantics (green-scale A→C2, oranges D/D2, purple LOW_DATA,
  brick-red ZERO_OVERRIDE) into the brand-warm palette — the ordering the team
  already reads fluently was preserved on purpose.
- Acceptance bar: a new hire uses it correctly on day one with zero training.

---

## 10. Engineering rules every CC app carries (the Playbook)

These are the patterns this console shares (deliberately) with the sibling OMS app,
and the defaults any new CC tool would start from:

1. All business logic in IST; store timestamptz, render IST.
2. Mobile-number normalization: last valid 10-digit window, compare normalized only.
3. **No hard deletes, ever** — cancel/void with reason (+ second-person approval
   pattern); rows never disappear.
4. **Append-only event/audit log** on every mutation (the anti-pilferage layer).
5. Edits never silently reset workflow state — they flag "changed — acknowledge".
6. Snapshot on save — documents freeze their own copy of what they referenced.
7. Idempotent ingestion — webhook + sweep backstop, upsert on external ID.
8. Read structured options by name, never by position.
9. **AI is never load-bearing** — assistive pre-fill with a visible verify hint; the
   flow proceeds on timeout; every worker has an off switch with zero business impact.
10. Secrets in env vars only.
11. **Server-side enforcement of role AND data scope on every endpoint.**
12. Sequential gap-free numbering for legal documents.

This console adds two patterns of its own worth reusing: the **byte-parity
materialization** trick (DB is source of truth, but the consumed artifact is
regenerated by one serializer and hash-verified against the original), and the
**stop-and-verify migration ritual** with witnessed verification logs.

---

## 11. Build history and current state

| Milestone | Shipped | What |
|---|---|---|
| **M1** (11–12 Jul 2026, `m1-approved`) | Clickable frontend on the real 10-Jul run, static JSON, visual-only auth. Datagen script runs the real model and aborts on any mismatch with the pinned reference numbers. 16 review findings executed. |
| **M2** (12–15 Jul 2026, `m2-approved`) | Real deployment: Vite→Next.js port, Supabase auth/DB/Storage, Railway runner, live runs, parity gate passed (byte-identical reference run), run history + bundles, orphan report, importer. 18/18 acceptance PASS; 12 review findings executed; approved after 3 live production days (runs by all three users; 4,782–5,786 units/day; zero config drift; the abort path proven live at 8.18%). |
| **M3** (15 Jul 2026) | Config proposals: propose with rationale → admin approve → apply + trail. Owner-instructed, no written brief. One finding (the LCS diff) fixed. |
| **M4a/M4b** (15–16 Jul 2026) | Manual additions + final plan; outlet aliases; actual-shipped derived from the feed's Receiving. Decisions D-012…D-015 logged. |

**Numbers of record** (the golden fixture, Day N = Fri 10-Jul-2026 → dispatch Sun
12-Jul): **5,786 units / 2,656 decisions**. Regimes: A 1,041 · B 277 · C1 189 ·
C2 25 · D 528 · D2 10 · LOW_DATA 27 · SKIP_ALT_NP1 333 · ZERO_ALL_OOS 22 ·
ZERO_OVERRIDE 204. Readiness (11-Jul): ZERO 80 · SHORT 212 · TIGHT 107 · OK 1,655 ·
EXCESS 120 · WASTAGE_PRONE 188 · ORPHAN 4 · BLANK 290. Reference
`output_dispatch.csv` sha256 `443796c2e5ea5e4d…`.

**Deliberately NOT built:** nightly automation (absent until the app earns it — the
open question is what evidence unlocks it and who gets woken on failure); any
sending of files to recipients (removed permanently — replaced by the one-click
bundle); scheduled/effective-dated config changes; per-field config validation
beyond shape (the model is never second-guessed by the console).

**Backlog:** per-pair regime timeline across all runs · assistive analyst-
observations worker (never load-bearing) · **"database of data waves"** — replacing
the daily 52k-row file upload with an inventory facts table (one row per
item×outlet×date, topped up daily ~2.6k rows; runs materialize their window from the
DB with the same snapshot+parity trick as configs; migration via shadow mode). That
last one is the biggest structural candidate on the table.

---

## 12. For the "extension vs separate tool" discussion

What a new tool could plug into, and what is deliberately walled off:

**Reusable / shared surface:**
- The **Supabase project** (Postgres + Auth + Storage) and the invite-only
  email+password identity model with the admin/planner/viewer role pattern.
- The **stateless runner pattern** — any Python batch job can be wrapped the same
  way (validate-sync + execute-async + progress-on-the-row + artifacts-to-Storage).
- The **append-only `change_trail`**, the migration ritual, the parity/snapshot
  trick, the typed service layer, and the design-token system — all portable.
- The **data already accumulating**: every run's full detailed output (regime, EMA,
  targets per pair) is stored forever as payloads; `dispatch_lines` holds planned +
  actual per pair per day. Any analytics/planning tool has this history for free.
- The feed itself: the daily inventory panel (opening/receiving/sales/wastage/
  closing per item×outlet×date) enters the system daily — the facts-table backlog
  item would make it queryable directly.

**Deliberately isolated (do not extend into):**
- `/model` and `/model_dashboard` — verbatim, read-only, forever. Anything new
  that needs model behavior must *run* the scripts or port logic with provable
  parity, never modify them. Console-side metadata (like outlet aliases) lives in
  console tables, never as new model configs.
- The console and the OMS are **separate apps on identical patterns** by design.
  The standing open question (logged, undecided): where do they eventually touch —
  shared identity? shared outlet master? or never?

**Known naming trap for any tool touching outlets:** outlet names differ between
sources (the manual sheet vs the feed — e.g. `CC-ND-Gaur City 1` = feed
`CC-ND-Diamond Plaza`), and `CC-FBD-Sector 37` (Faridabad) is a *different shop*
from `CC-GGN-Sector 37` (Gurgaon). Aliases are keyed on full names only. Any new
tool consuming outlet-named data should use the console's `outlet_aliases` table
(or a shared outlet master, if that ever gets built) rather than inventing its own
matching.
