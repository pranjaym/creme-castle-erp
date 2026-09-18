-- 231: recipes_month_end_snapshot fires on the wrong night (F59)
--
-- APPLIED 18 Sep 2026 on Pranjay's approval, in one transaction with its
-- schema_migrations row, the same way migrate.mjs applies a file. Staged first in
-- erp-plan/migrations-staging/ and moved here only after approval, because an
-- unapproved file in this folder is executed by the next migrate.mjs run from any
-- concurrent session (F41, and the dry-run hazard note). migrate.mjs now skips it
-- as already applied. Verified against the live cron.job row after the apply.
--
-- Found 18 Sep 2026 while clearing the false cron alarm (F58).
--
-- What migration 229 intended, in its own comment:
--   "Runs at 00:30 IST on the 1st (19:00 UTC on the last day)"
-- What it actually does: the guard adds a day to an IST clock that has already
-- crossed midnight, so it compares the day AFTER tomorrow to the start of the
-- month. Evaluated on the spine for every fire in Sep and Oct 2026:
--
--   UTC fire          IST local         guard as written   should be
--   2026-09-28 19:00  2026-09-29 00:30  false              false
--   2026-09-29 19:00  2026-09-30 00:30  TRUE  (wrong)      false
--   2026-09-30 19:00  2026-10-01 00:30  false (wrong)      TRUE
--   2026-10-30 19:00  2026-10-31 00:30  TRUE  (wrong)      false
--   2026-10-31 19:00  2026-11-01 00:30  false (wrong)      TRUE
--
-- Consequence if left alone. The job runs one night early, on the second to last
-- day of the month, and month_end_snapshot() defaults as_of to "yesterday IST",
-- so on 29 Sep 19:00 UTC it would write rows stamped as_of = 2026-09-29 and
-- snapshot_kind = 'month_end'. September's real month end, 30 Sep, is never
-- snapshotted at all. The costing history is the asset that outlives the app
-- (canonical rule 1), so a month_end row on the wrong date is the expensive kind
-- of wrong: it is wrong quietly, and it is wrong forever.
--
-- This would NOT have been caught by the pg_cron watch. A guard that evaluates
-- false is still a successful run as far as pg_cron is concerned, so
-- cron.job_run_details shows 'succeeded' either way.
--
-- Fix: compare today's IST date to the start of today's IST month. At 00:30 IST
-- on the 1st that is 1st = 1st, true, and on every other night in the 28 to 31
-- window it is false.

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'recipes_month_end_snapshot') then
      perform cron.unschedule('recipes_month_end_snapshot');
    end if;
    perform cron.schedule('recipes_month_end_snapshot', '0 19 28-31 * *',
      $j$ select recipes.month_end_snapshot() where (now() at time zone 'Asia/Kolkata')::date = date_trunc('month', (now() at time zone 'Asia/Kolkata'))::date $j$);
  end if;
end $$;

-- Proof to run after applying: the only true night in each month is the one whose
-- IST local time is the 1st at 00:30. Expect exactly one true per month.
--
-- with fires as (
--   select generate_series(timestamptz '2026-09-28 19:00Z', timestamptz '2027-03-31 19:00Z', interval '1 day') as t)
-- select to_char(t,'YYYY-MM-DD HH24:MI') as utc_fire,
--        to_char(t at time zone 'Asia/Kolkata','YYYY-MM-DD HH24:MI') as ist,
--        (t at time zone 'Asia/Kolkata')::date = date_trunc('month',(t at time zone 'Asia/Kolkata'))::date as runs
-- from fires where extract(day from t) between 28 and 31 order by t;
