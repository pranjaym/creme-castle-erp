# cc-ratings: the evening Zomato ratings mail

Built 21 August 2026. Sends one report per evening covering **yesterday**.

## What it produces

One build, three surfaces:

| surface | what it is |
|---|---|
| digest | static HTML, no JavaScript, inline styles, table layout. Becomes the **email body**. |
| `CC_Daily_Ratings_<date>.html` | the full interactive dashboard, attached. Download and open in a browser: date picker and window toggles work. |
| `CC_Daily_Ratings_<date>.pdf` | printable A4, attached. |

Two recipient groups in `recipients.json`: **HTML Daily** (8 people, gets the .html)
and **PDF Daily** (4 people, gets the .pdf). Both get the same email body.
Edit that file, not the code.

## Schedule

`in.cremecastle.ratings.plist`, slots **19:00 / 19:30 / 21:00 / 22:30**, wrapped by
`run_ratings.sh` with the same five defences as the Zomato pull: success stamp, lock,
network gate, honest exit code, caffeinate hold.

**Ordering matters.** This must run after the 18:00 Zomato pull has landed yesterday.
`run.py --defer-if-stale` exits **75** when the spine's newest day is not yesterday, so
early slots wait rather than mailing a stale day. The **22:30 slot drops that flag** and
mails whatever the newest day is, so a bad Zomato evening still produces a report rather
than silence.

## Manual use

    python3 run.py                      # build only, send nothing
    python3 run.py --dry-run            # show who would get what
    python3 run.py --send               # send to both groups
    python3 run.py --send --only "PDF Daily"
    python3 run.py --day 2026-08-14 --send   # re-send an older day
    bash run_ratings.sh --force         # run a slot ignoring today's success stamp

    CC_RATINGS_RECIPIENTS_FILE=recipients_test.json bash run_ratings.sh --force
        # full end-to-end test that mails only Pranjay

## Outlet identity

Outlets are keyed on **Zomato `restaurant_id`** and displayed by their **internal
Creme Castle name**. Never key on the Zomato subzone: Zomato relabelled `306520` from
"Alpha 2" to "Gamma 2" on 25 Jul 2026 and `22521042` from "Sector 21" to "Moti Bagh",
and keying on their name splits one store's history in two.

The glossary lives in **`outlets.json`**, frozen from `erp-plan/Outlet Master.xlsx`.
The scheduled job never reads iCloud Drive (launchd cannot reach it reliably).
Refresh deliberately after the master changes:

    python3 glossary.py --refresh

**Known master defect:** the Outlet Master has `22521042` as `CC-GGN-Udyog Vihar`
(Gurgaon). It is `CC-DL-South Campus`. Pranjay's correction is applied in
`glossary.OVERRIDES` and wins over the file. The master should be fixed at source, and
someone should check whether other rows are stale.

## Definitions

- **Bad = 1 to 3 star. Good = 4 to 5 star.** (Pranjay's call, 20 Aug.)
- **Orders** is every order, so it ties to other reports. **Rated %** is measured against
  *delivered* orders only, since a rejected order cannot be rated.
- **Escalation has two tiers.** Tier 1 "Act today" is a physical contaminant, an illness
  report, or an expiry or allergen failure: ~23 in 45 days. Tier 2 "Quality alert" is
  spoilage and staleness, ~70 in 45 days, routed to central production. Splitting them
  matters: with spoilage in tier 1 the red box fired daily and stopped meaning anything.
- **Rated % is a store manager metric.** Zomato exposes the customer number while the
  order is live so managers call and ask for a rating; Swiggy does not. Across 45 days
  rated % runs 5.2% to 13.4% between stores and correlates +0.61 with average rating.
  An outlet's average is therefore **not comparable** to another's without reading rated %
  beside it. Never put Zomato and Swiggy averages on one axis.
- **Maturity.** Ratings settle over ~3 days: at age 1 about 88% of eventual 1-star are in
  but only 70% of 5-star, so a fresh day always reads worse than it finishes. The header
  badge benchmarks the day's rated % against **the same weekday over the last four weeks,
  settled days only**. Counts are real; percentages are provisional.

## Gotchas paid for once already

- Port **587 is STARTTLS**, not implicit SSL. `SMTP_SSL` on 587 gives
  `WRONG_VERSION_NUMBER`.
- This python.org build ships **no CA bundle**; verification against smtp.gmail.com fails
  unless the SSL context points at `certifi`. Do not "fix" this by disabling verification.
- The digest is written both as a fragment (email body) and wrapped by
  `digest.standalone()` with `<meta charset="utf-8">` for the file and the PDF. Without the
  charset the star glyphs and any Hindi or emoji in reviews mojibake.
