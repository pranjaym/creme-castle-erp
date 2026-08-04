# Zomato Order Details feed (new spine dataset)

Added 4 August 2026. Status: **BUILT AND PROVEN END TO END, 4 August 2026** (Pranjay's go the same afternoon). Migration 060 applied to the spine; worker at `creme-castle-erp/kitchen/workers/zomato-ingest/`; launchd agent `in.cremecastle.zomato` loaded with slots 18:00/18:20/20:00/22:00; D-2 catch-up wired into the 8 am `run_daily.py`; Pranjay's session bootstrapped and stored. Final verification run (run 138/139): the real 7-day window 27 Jul to 2 Aug, both exports, 19,431 orders, 6,344 late mutations superseded, 0 lineage orphans, receipts stored, exit 0. Nothing further is needed for the evening pulls to run on their own.

**Operational note: the browser is VISIBLE, not headless.** Zomato's edge refuses headless browsers outright (see section 4d), so each slot opens a Chromium window for a few minutes and closes it. This needs the Mac awake and logged in at that hour, the same dependency as the 8 am dashboard (F14).

## 1. What this is

Zomato's partner dashboard exports an order-level report ("Order history") that carries information Petpooja never sees. Pranjay supplied a manual export covering 1 January to 2 August 2026 (`Zomato Order Details.xlsx`, 47 MB): 304,992 orders, 30 columns, all 44 active outlet listings (the account maps 45; one had no orders in the period), 5 cities. One row per order, exactly 1 duplicate Order ID in 305k rows, dates parse cleanly with no gaps.

Format of `Order Placed At`: `12:00 AM, January 01 2026` (12-hour time, comma, month name, day, year). Parse with `%I:%M %p, %B %d %Y`.

## 2. Why it earns a spine table (what is new vs the Petpooja item report)

- **Customer identity**: hashed Customer ID on 260k of 305k orders, 183,346 unique customers. Enables repeat rate, new vs returning, lifetime value per outlet. Nothing else in the spine has this.
- **Ratings and reviews**: 24,667 order-level ratings, 3,931 written reviews, tied to order and items.
- **Complaints**: per-order complaint tags (packaging/spillage 736, taste/quality 413, wrong item 412, missing item 385, non-refunded 2,293 over the 7 months).
- **Kitchen operations**: KPT duration (minutes), rider wait time (minutes), order-ready marking correctness. Direct input for the kitchen module's KPI baselines.
- **Order outcomes**: rejection reasons and penalties, cancellation compensation, returns (4,408 rejected, 484 returned in the period).
- **Discount anatomy**: promo vs flat-off vs Gold vs brand-pack split, plus the construct string.
- **Geography**: subzone and delivery distance per order.

The 30 columns, in export order: Restaurant ID, Restaurant name, Subzone, City, Order ID, Order Placed At, Order Status, Delivery, Distance, Items in order, Instructions, Discount construct, Bill subtotal, Packaging charges, Restaurant discount (Promo), Restaurant discount (Flat offs, Freebies & others), Gold discount, Brand pack discount, Total, Rating, Review, Cancellation / Rejection reason, Restaurant compensation (Cancellation), Restaurant penalty (Rejection), KPT duration (minutes), Rider wait time (minutes), Order Ready Marked, Customer complaint tag, Customer ID, Customer Phone.

## 3. The dashboard path (verified live, 4 August 2026)

Everything happens on one page: `https://www.zomato.com/partners/onlineordering/orderHistory/` (left sidebar: "Order history"), logged in as the owner account (Pranjay's Chrome profile session; no OTP was prompted on this visit).

1. Top bar date-range control (shows for example "3rd to 4th Aug"). Plain from/to calendar; a single day is selected by clicking the same date twice. Wide ranges are allowed (the 7-month manual export came from here).
2. "Download data" dropdown, two options:
   - **Order history**: the report described above.
   - **Customer details**: separate export; its modal says "Only orders with customer details are included." Contents NOT yet verified (F17).
3. Clicking an option opens a confirmation modal ("Download order history for 3rd Aug"), then "Download now" starts an asynchronous report job. A "Download in progress. Downloading order history for 45 restaurants..." toast shows while the job runs; the on-screen outlet selector (max 10) is irrelevant to the download, which always covers all mapped outlets.
4. On success the browser receives a direct download: a **.zip containing one .csv** named `order_history_<from>_<to>.csv` (verified 4 Aug on the 30 Jul pull). No email flow. It lands wherever Chrome's download folder points; on Pranjay's Mac that is the iCloud "Downloads Drive" folder, not ~/Downloads. The 47 MB manual file being .xlsx suggests very large ranges may come as .xlsx; the loader should accept both.

### Mechanics under the hood (observed via network inspection)

- Trigger: `POST https://api.zomato.com/merchant-gw/web/order/history/get-all-v2`.
- Poll: `GET https://api.zomato.com/merchant-gw/web/order/history/download/status?uuid=<user>&query_id=merchant-api-gateway::mx_order_history_download_v4::...&download_type=all_orders`, roughly every 5 seconds.
- The endpoints require the web app's own auth headers on top of cookies (a bare cookie-authenticated fetch from the page context is rejected), so the automation should drive the page UI (Playwright, same pattern as the Petpooja scraper), not call the API directly, at least until the header recipe is captured and proven stable.

## 4. Reliability finding: it is DATA LAG, not general flakiness (corrected 4 Aug afternoon, Pranjay's diagnosis, then verified)

On 4 August between roughly 13:05 and 13:30 IST, four consecutive export attempts for YESTERDAY (3 Aug, all outlets) failed with "Download failed, please try again" after 4 to 6 minutes of churn each. Pranjay's read: Zomato has not finished materialising yesterday's data yet, and the failure is the export hitting not-ready data, not a degraded service. Verified immediately after: a single-day export for an OLDER day (30 Jul) succeeded in under a minute on the first attempt, same account, same hour. So:

- Exports for days Zomato has finished processing are fast and reliable.
- Exports that include yesterday fail while the data is still being prepared, and the failure mode is a several-minute churn ending in "Download failed", indistinguishable from a real outage from the outside.
- **Readiness boundary, measured 4 Aug 2026: yesterday is NOT ready at 13:30 but IS ready by 17:47** (a 17:47 production run pulled 3 Aug complete: 2,219 orders, consistent with the Mon-to-Thu weekday pattern of 2,230 to 2,370, so not a partial day). The 18:00 primary slot is therefore correctly placed, with 20:00 and 22:00 as the ladder. Do not move it earlier without re-measuring.
- Design consequence stands: bounded retries with spacing, alert on final failure, trailing-window self-heal. See F16.

## 4b. Parity verification (4 Aug, 30 Jul single-day pull vs the manual 7-month export)

The automated 30 Jul CSV was compared field-by-field against the 30 Jul rows of Pranjay's manual export (downloaded 70 minutes earlier). Result: **the feed is trustworthy, and the differences are exactly the late-mutating fields**:

- Row parity exact: 2,368 orders in both, identical Order ID sets, bill Total sums identical to the paisa (1,112,184.24).
- All money, discount, distance, geography, status-economics columns: identical.
- "Items in order": identical items, only the ordering inside the string differs between runs (0 mismatches after sorting). Loader should not diff on raw string order.
- Late mutations visible in 70 minutes: 4 statuses progressed to Delivered, 87 new ratings, 11 new reviews, 5 complaint-tag changes, 41 phone numbers present in the later run that the earlier one lacked. This confirms the trailing re-pull window design.
- Encoding: the CSV carries clean UTF-8 emoji where the .xlsx path had mojibake; CSV is the better source.
- Customer Phone values end in trailing control characters (0x14 repeated); strip on ingest.
- **KPT duration is NOT stable between runs**: 2,328 of 2,368 rows had completely different KPT values (for example 3.88 vs 1.03 minutes for the same order), with the earlier export's values looking more plausible. Until this is understood, KPT is stored as-received per pull but not trusted for KPIs. Flag F19.

## 4c. Customer details export, decoded (F17 resolved 4 Aug)

Pranjay's 12:44 "Customer details" download (July range) produced `order_history_20260701_20260731.zip`, same 30 columns, which is why it looked like the order history file. It is actually the SUBSET of orders where Zomato shares the customer's real phone number: 1,158 rows for all of July (vs 2,368 orders on 30 Jul alone), every row with Customer Phone filled, only Delivered and Rejected statuses. So: same schema, filter = has real phone. It needs no separate table; it feeds the same `zomato_order_details` rows, upgrading hashed identity to a real phone for the small slice that has one, and is the bridge from Zomato customers to a future customer master (join on phone with OMS `customer_mobile`).

## 4d. Browser constraints found on the first real automated runs (4 Aug 2026)

- **The worker runs FIREFOX HEADLESS: no window ever appears.** The refusal is specific to the Chrome-family headless fingerprint, not to automation, so nothing is disguised; we simply drive an engine the site serves. Measured against the live site:

  | engine / mode | result |
  |---|---|
  | chromium headless (plain, real UA, `--headless=new`) | `ERR_HTTP2_PROTOCOL_ERROR` in under 1s |
  | real Google Chrome headless | same |
  | chromium headed | works, but the window CANNOT be hidden (see below) |
  | **firefox headless** | **works; full download flow verified** |
  | webkit headless | works (documented fallback) |

  `--disable-http2` made the Chrome case worse (instant error became a 60s hang). `ZOMATO_BROWSER=firefox|webkit|chromium` overrides.
- **A visible window could not be hidden on macOS**, which is why the engine change mattered: macOS clamps any `--window-position` back on screen (asking for -3000,-3000 still landed at 221,33), and AppleScript cannot minimise or hide the automation browser (it is not scriptable under its own name). Off-screen and minimise were both dead ends.
- **The one-time bootstrap login stays headed Chromium**, because that step is a human logging in. Its saved cookies work in Firefox, so no second login is ever needed.
- **Both exports run in ONE browser session** (page loaded once, range set once), rather than a session per export.
- **HARD PLATFORM LIMIT: 10 days per export.** With more than 10 outlets mapped (we have 45), Zomato refuses any longer range: the page says "You have selected more than 10 outlets and a date range exceeding 10 days" and the export never starts, which reads exactly like a timeout. A 14-day sweep hit this. Windows are clamped to 10 in code and the scraper now recognises the message and fails fast with the real reason. Anything wider must be walked in chunks. (This also means the 7-month manual export Pranjay supplied is NOT reproducible through this page's normal flow at that size.)
- **The page is a React SPA behind an API call**: `domcontentloaded` fires while it is still a skeleton, so every wait is on an actual element with a generous budget, never a fixed sleep.
- **The date picker (react-date-range) must be driven like a user.** Its month `<select>` can be set without React noticing, leaving the grid on the old month while day cells (which carry no date attribute) sit under the wrong dates. Navigation uses the picker's own arrows, verified to move after each press. The picker opens on the current month and cannot go into the future, so the "next" arrow is legitimately inert there.
- **The chosen range is read back from the picker's own fields and must match exactly**, else the pull fails rather than proceeds. This is the guard against the worst outcome: silently ingesting the wrong days.
- **Menu labels are wrapped in several nested elements**, so a text match hits all of them. The innermost must be clicked; clicking the outermost wrapper does nothing at all and the run then waits out the full download timeout for a job that never started.

## 5. Proposed spine table (for review, not yet built)

`zomato_order_details`, one row per Zomato order, append-only with supersede-on-reimport (no hard deletes, CLAUDE.md rule 6):

- Natural key: `zomato_order_id` (bigint). The one observed duplicate means the loader takes latest-file-wins with the superseded row retained and flagged, not a hard unique constraint at ingest.
- All 30 export columns stored as-received (raw text preserved for audit), plus: `order_placed_at timestamptz` (parsed, Asia/Kolkata), `source_file`, `imported_at`, `superseded_by` (nullable).
- Late-mutating fields (status, complaint tag, compensation, penalty, rating, review) mean the daily job re-pulls a trailing window (proposed: 7 days) and supersedes changed rows, same pattern as the Petpooja online-orders dedup.
- Join to the existing spine item report on order number = `zomato_order_id` for Zomato orders: expected to hold but NOT yet verified (F18). Item-level detail stays in the item report; this table is the order-level overlay.

Import traps already known from the historical backfill apply here too: pandas dayfirst month/day swaps on ISO-looking text, and Excel scientific-notation destruction of long order numbers if anyone round-trips the file through Excel. The loader reads the .xlsx directly with dtype=str on IDs.

## 6. Scheduling (revised 4 Aug after the lag finding)

**The pull does NOT join the 8 am run for yesterday's data.** Pranjay's call, confirmed by the test: yesterday is not ready in the morning (still failing at 13:30). Design:

- **Primary slot: evening, first attempt 18:00 IST, covering the last 3 days ending yesterday** (Order history and Customer details, both all-outlets, both in ONE browser session that loads the page and sets the range once). On failure retry at 18:20, 20:00 and 22:00. Each slot: bounded poll up to ~12 minutes per export. If all fail, alert and stop; the next evening's window covers the gap. Every Monday the window widens to 10 days (see below).
- **Safety net inside the existing 8 am run: same range export ending day-before-yesterday** (data certain to be ready) ONLY if the previous evening's pull did not complete. Keeps the spine's worst-case staleness at D+2 even when evenings fail.
- **Trailing supersede window: 3 days daily, 10 days every Monday (final, 4 Aug 2026).** Every pull supersedes changed rows and keeps the superseded values, so each order retains its full revision history. Getting to that number took three measurements, and the first two were misleading. First (run 138, window 27 Jul to 2 Aug):

  | order date | age (days) | rows changed | % of that day |
  |---|---|---|---|
  | 2 Aug | 2 | 3,705 | 98.4% |
  | 1 Aug | 3 | 712 | 20.8% |
  | 31 Jul | 4 | 538 | 17.6% |
  | 30 Jul | 5 | 92 | 3.9% |
  | 29 Jul | 6 | 436 | 18.9% |
  | 28 Jul | 7 | 414 | 18.2% |
  | 27 Jul | 8 | 447 | 20.1% |

  First reading (WRONG, corrected below): "days 3 to 8 old still change ~20% each, so 7 days is needed."

  **Correction, same day 17:47 (run 140, window 28 Jul to 3 Aug, the first pull compared against a SAME-SHAPE predecessor):**

  | order date | age (days) | new | changed | unchanged |
  |---|---|---|---|---|
  | 3 Aug | 1 | 2,219 | 0 | 0 |
  | 2 Aug | 2 | 0 | **0** | 3,767 |
  | 1 Aug | 3 | 0 | **0** | 3,421 |
  | 31 Jul | 4 | 0 | **0** | 3,064 |
  | 30 Jul | 5 | 0 | **0** | 2,368 |
  | 29 Jul | 6 | 0 | **0** | 2,308 |
  | 28 Jul | 7 | 0 | **0** | 2,274 |

  So the earlier 20% was almost entirely **export-shape noise**, not late mutation: run 138 compared CSV pulls against the xlsx backfill, run 140 compared CSV against CSV and found nothing moving on days 2 to 7. This is the same family of artefact as F19 (KPT), and it is exactly why the daily job pins one export shape.

  **Decided 4 Aug 2026 (Pranjay's call): the daily window is 3 days.** A third measurement settled it. Run 146 re-read 10 days and found 1,023 changes, but every one of them fell on 25 and 26 Jul, the only two days still holding original xlsx-backfill rows. Every day already pulled in the same CSV shape (ages 1 to 8) showed exactly zero changes:

  | order date | age | changed | note |
  |---|---|---|---|
  | 25 Jul | 10 | 531 | still xlsx-backfill rows |
  | 26 Jul | 9 | 492 | still xlsx-backfill rows |
  | 27 Jul to 3 Aug | 8 down to 1 | **0** | already pulled in CSV shape |

  So export-shape noise accounts for ALL of the apparent late mutation seen so far, and nothing genuine has yet been observed moving after the order day.

  **Two guards remain, because the evidence is still hours-apart, not days-apart.** Ratings, complaints and refunds genuinely do arrive over days, and no pull yet has compared the same day 24 hours apart. So: (a) a **weekly sweep** every Monday widens the window to 10 days (the platform maximum), so a late correction on day 4 or later still reaches the spine and the change log can keep measuring what a 3-day window cannot see; (b) the change log keeps accumulating, and if genuine day-4-plus changes appear the daily window goes back up. `--no-weekly-sweep` disables the sweep; `DAILY_WINDOW_DAYS` sets the daily window.
- **Always the same export shape.** The F19 comparison showed KPT differing between a range export and a single-day export of the same old day, so the daily job uses one consistent shape (the range export) to keep any per-shape bias constant. KPT acceptance rule once F19 is resolved: a KPT value is trusted when it is identical across two consecutive pulls.
- Mechanics per pull: Playwright with the persisted Chrome-profile session (login manual, once; the job never touches credentials or OTPs), set single-day range, download, unzip, parse CSV (accept xlsx fallback), keep the raw zip as the immutable receipt, load to spine via the ap-south-1 pooler, dtype=str on IDs, strip 0x14 from phones, never diff on raw "Items in order" string order.
- F14 realities (laptop awake, AC power) apply to the evening slots exactly as they do to the 8 am run, until the always-on host exists. Evening slots have one advantage: the Mac is more likely to be in active use.

## 7. Flags raised

- **F16 (revised)**: Zomato exports fail while a requested day's data is still being materialised (yesterday was still not ready at 13:30 IST on 4 Aug), with a failure mode indistinguishable from an outage. Older days export fast and reliably (verified). Readiness boundary unknown; the evening-slot logs will locate it empirically.
- **F17 RESOLVED 4 Aug**: Customer details export = same 30-column layout, filtered to orders with the customer's real phone number, delivered under an `order_history_...` filename. Feeds the same table; no separate table needed.
- **F18**: The join `zomato_order_details.zomato_order_id` = spine item report order number is expected but unverified against the spine.
- **F19 (new)**: KPT duration values differ wholesale between export runs for the same orders (2,328 of 2,368 rows on the 30 Jul comparison, with the earlier run's values more plausible). Store as-received, do not use for KPIs until the discrepancy is understood (re-pull 30 Jul after some days and compare again).
