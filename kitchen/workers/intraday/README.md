# The intraday pulse

Hourly snapshots of today's sales, while today is still happening, with the day
judged against the same slice of a normal day of the same weekday.

Built 28 August 2026 (Raksha Bandhan) on Pranjay's instruction: "I want to track my
sales on an hourly basis."

## Reading it, right now

```bash
cat ~/creme-castle-erp/kitchen/workers/intraday/latest.txt
```

That is the last completed pulse, as a plain text file. No database, no browser, no
scrape. It carries its own clock and its own freshness line, so it can never be
mistaken for a fresher picture than it is.

## Running one on demand

```bash
~/creme-castle-erp/kitchen/workers/intraday/run_pulse.sh
```

Takes about 25 seconds. Safe to run at any time and as often as you like: the loads
are idempotent, so a run that sees nothing new stores nothing new.

Variants, all from `kitchen/workers/intraday`:

```bash
python3 run_pulse.py --report-only    # re-read what is stored, pull nothing (instant)
python3 run_pulse.py --no-items       # order side only, about 10 seconds
python3 run_pulse.py --date 2026-08-28 --occasion "Raksha Bandhan"
```

## The schedule

`~/Library/LaunchAgents/in.cremecastle.pulse.plist`, every hour at :05.

The wrapper, not the schedule, decides whether to act:

- outside trading hours (07:00 to 02:59) it skips, because a stale feed overnight is
  correct and must not alarm;
- while the 08:00 dashboard job holds the Petpooja session it yields, because two
  browsers driving one saved session is how that session gets corrupted. The pulse
  loses that hour and picks up at 09:05;
- it holds its own lock, so a slow hour is never overtaken by the next slot;
- it holds the Mac awake for the duration.

```bash
launchctl unload ~/Library/LaunchAgents/in.cremecastle.pulse.plist   # stop it
launchctl load   ~/Library/LaunchAgents/in.cremecastle.pulse.plist   # start it
```

## Where the data goes, and where it does NOT go

Into the `intraday` schema on the spine (migration 200), append only:

| Object | What it holds |
|---|---|
| `intraday.pulse_run` | one row per pull: clock, rows parsed, rows new, freshness, outcome |
| `intraday.pp_online_orders` | order level, every state every order has been seen in |
| `intraday.pp_order_items` | item level, the same way |
| `intraday.v_orders_now` | one row per order: its LATEST seen state |
| `intraday.v_items_now` | the same for item lines |
| `intraday.v_pulse_hourly` | today by the hour |
| `intraday.v_settled_hourly` | any past day by the hour, identical arithmetic |

It does **not** write to `landing.petpooja_*`. Those hold the settled record of a
finished business day and the 08:00 job verifies them against a fresh pull each
morning; a part-day write would make that verification argue with itself. Today's
settled rows arrive there tomorrow morning exactly as they always have. Nothing about
the existing daily pipeline was changed to build this.

## The two things to understand before trusting a number

**One. An order is stored many times, on purpose.** An order walks from Placed to
Food Is Ready to Dispatched to Delivered, and each state is a different row. That is
the audit trail. Every figure in the report reads `v_orders_now`, which takes only
the latest state of each order, so nothing is counted twice. If you query the raw
table directly, you must do the same or you will count one sale four times.

**Two. Money is text with commas in it.** Petpooja writes `1,384.14` once a value
passes 999. A bare `::numeric` cast raises on it, and because a part day rarely has a
four figure order, that bug passes every morning test and then fails in the evening
when the day is big. Use `intraday.money(...)`.

## What the report is measuring

- **Sales** is the sum of the order `Total` for every order placed today, excluding
  cancellations. Cancellations are shown beside it, never netted away silently.
- **The day** runs 04:00 to 03:59, the spine's business day, on both sides of every
  comparison.
- **"Normal Friday"** is the mean of the last four settled Fridays, each cut at the
  same number of hours and minutes into its own day. Same window against same window,
  so a part day is never laid against a whole one.
- **The hour in progress** is compared against the same fraction of the baseline
  hour, not the whole one.
- **Everything except the "where the day lands" block is measured.** That block is
  clearly fenced and is the only estimate in the report.

## Why the projection is a range and not a number

At 11:20 on 28 August the same morning projected to Rs 1.09 crore on a normal
Friday's shape and Rs 40.5 lakh on last Rakhi's shape. That is not a rounding
difference, it is the whole question.

A normal Friday has only about 5 percent of its sales in by 11am, because Creme
Castle's day is an evening day. Raksha Bandhan 2025 had 14 percent in by the same
point, because gifting is bought in the morning and dinner is not. Multiply a
festival morning by a normal day's remaining-day curve and you get an answer that is
nearly three times too large.

So the projection is anchored on the shape of a *named* reference day, more than one
shape is always shown, and the spread between them is presented as the finding. Which
shape today turns out to follow is not knowable at 11am, and a single number would
have hidden that.

Add a festival and its anchor in `occasions.json`. The anchor should be the SAME
festival last year, never a normal day.

## Failures, and why one is not worth waking up for

An hourly job that fails has lost an hour and the next slot heals it. So:

- exit 0: fine, the success stamp moves, `latest.txt` is rewritten;
- exit 75: a transport failure (the network flapping). Logged, **not** alerted. This
  is F23: a transport failure is only a real problem once a later slot has failed too;
- exit 1: something a person has to look at.

The alarm is not "a run failed". The alarm is "the newest data is more than 150
minutes old while the shops are trading", which is judged on the age of the last
success and is the only version of this that costs Pranjay anything.

By far the most likely real failure is an expired Petpooja login, which no retry ever
fixes and which needs a hand OTP re-login (F24):

```bash
cd ~/creme-castle-erp/kitchen/workers/petpooja-ingest && python3 scrape.py bootstrap
```

## Proven on the day it was built

- Database against the raw downloaded file, same window: 800 orders and Rs 5,83,065
  on both sides, exact.
- Against the settled landing table over 04:00 to 08:00, which the morning job had
  already loaded independently: 76 orders vs 77, a single Rs 865 order that was
  "Prepared" when the 08:00 job saw it and has since been cancelled. No order missing
  in either direction. The two paths reconcile, and the one difference is the pulse
  doing its job.
