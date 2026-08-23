"""Watch the spine database's own scheduled jobs (pg_cron) and mail the owner
when one fails or goes missing.

Added 23 August 2026 after the automation audit. The spine runs its heavy
refreshes server-side on pg_cron (core_refresh morning and evening, the identity
refresh). When one of those fails, pg_cron writes the failure into
cron.job_run_details and nothing else happens: no mail, no visible symptom. The
identity refresh failed exactly that way on 16 Aug 2026 and nobody knew until
this audit found it a week later.

This check runs every morning from run_dashboard.sh, after the dashboard work,
never fatal to it. Two questions are asked over the last WINDOW_H hours:
  1. did any run FAIL?
  2. is any ACTIVE job simply missing a run (scheduler stuck, job wedged)?
Every current spine job is daily, so one clean day means one run per job inside
the window. If jobs on a longer cadence are ever added, widen WINDOW_H or scope
the missing-run check, otherwise mornings will cry wolf.

Alerts reuse alert_failure.send_alert (same mailbox, same recipient rule) and are
stamped once per day, so the morning retry slots cannot repeat the same message.
Exit is 0 unless the check itself could not run; run_dashboard.sh logs that but
never fails the morning over it.

Pass --dry-run to print instead of send (for tests).
"""
import datetime as dt
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STAMP = os.path.join(HERE, ".last_spine_cron_alert")
WINDOW_H = 26   # a daily job plus slack for drift; see the module docstring


def main():
    dry = "--dry-run" in sys.argv[1:]
    sys.path.insert(0, HERE)
    import alert_failure
    alert_failure._load_env_file()

    today = dt.date.today().isoformat()
    if not dry:
        try:
            if open(STAMP).read().strip() == today:
                print("spine cron check: already alerted today, skipping.")
                return 0
        except OSError:
            pass

    import psycopg2
    conn = psycopg2.connect(os.environ["SPINE_DATABASE_URL"])
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                select j.jobname, d.start_time, d.status,
                       left(coalesce(d.return_message, ''), 300)
                from cron.job_run_details d
                join cron.job j using (jobid)
                where d.start_time > now() - interval '%s hours'
                  and d.status not in ('succeeded', 'running', 'starting')
                order by d.start_time
                """ % WINDOW_H)
            failed = cur.fetchall()
            cur.execute(
                """
                select j.jobname, j.schedule
                from cron.job j
                where j.active
                  and not exists (
                    select 1 from cron.job_run_details d
                    where d.jobid = j.jobid
                      and d.start_time > now() - interval '%s hours')
                order by j.jobname
                """ % WINDOW_H)
            missing = cur.fetchall()
            cur.execute(
                """
                select count(*) from cron.job_run_details
                where start_time > now() - interval '%s hours'
                """ % WINDOW_H)
            total = cur.fetchone()[0]
    finally:
        conn.close()

    if not failed and not missing:
        print(f"spine cron check: {total} run(s) in the last {WINDOW_H}h, all OK.")
        return 0

    lines = []
    if failed:
        lines.append("Failed runs:")
        for name, start, status, msg in failed:
            lines.append(f"  {name}  at {start}  status={status}")
            if msg:
                lines.append(f"    {msg}")
    if missing:
        lines.append("Jobs that should have run but did not:")
        for name, schedule in missing:
            lines.append(f"  {name}  (schedule: {schedule})")
    body = (
        f"The spine database's scheduled jobs (pg_cron) had a problem in the last "
        f"{WINDOW_H} hours.\n\nThese jobs keep the order and identity tables fresh; "
        f"the portal and reports read what they produce, so a broken refresh means "
        f"quietly stale numbers.\n\n" + "\n".join(lines) + "\n\n"
        f"Run history lives in cron.job_run_details on the spine project "
        f"(cremecastle-spine). This alert is sent at most once per day.\n")
    subject = f"CC spine cron problem, {dt.date.today().strftime('%d %b %Y (%A)')}"

    if dry:
        print(subject)
        print(body)
        return 0
    if alert_failure.send_alert(subject, body, include_log_tail=False):
        with open(STAMP, "w") as f:
            f.write(today)
    return 0


if __name__ == "__main__":
    sys.exit(main())
