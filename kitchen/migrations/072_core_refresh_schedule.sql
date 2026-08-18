-- 072: schedule core.refresh_orders inside the database with pg_cron, so the
-- derived tables refresh even if the laptop is asleep (lesson F14: never
-- depend on launchd for anything that can run server side; lesson F21, 15 Aug
-- 2026: a laptop-held connection died mid full rebuild and rolled it back, so
-- long refreshes always run server side via pg_cron).
--
-- Two runs daily, incremental 11 day window (matches the ingest change window):
--   04:30 UTC = 10:00 IST, after the morning Petpooja ingest has landed.
--   14:30 UTC = 20:00 IST, after the 18:00 IST Zomato evening pull.
-- statement_timeout is cleared per job because cron jobs inherit role defaults.
-- A full rebuild remains a manual, server side call: schedule a one off cron
-- job running "select core.refresh_orders(null)" and unschedule it after.

create extension if not exists pg_cron;

select cron.schedule('core_refresh_morning', '30 4 * * *',
  $$set statement_timeout = 0; select core.refresh_orders(11)$$);
select cron.schedule('core_refresh_evening', '30 14 * * *',
  $$set statement_timeout = 0; select core.refresh_orders(11)$$);
