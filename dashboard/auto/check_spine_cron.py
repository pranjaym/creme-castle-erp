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
Question 2 used to assume every spine job was daily: an active job with no run
inside the window was reported missing. That assumption broke on 15 Sep 2026 when
the recipe module added recipes_month_end_snapshot ('0 19 28-31 * *'), a job that
is due once a month. From then on the check cried wolf every single morning about
a job that was not due, which is exactly the alert fatigue F23 and F50 exist to
prevent. Since 18 Sep 2026 the check reads each job's cron expression, works out
whether it was actually due inside the window, and only then insists on a run. A
job that was not due is skipped in silence; a monthly job that misses its one
slot is still caught.

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
GRACE_MIN = 10  # a run due in the last few minutes may not have started yet

_MACROS = {
    "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *",
    "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *",
    "@hourly": "0 * * * *",
}


def _field(spec, lo, hi):
    """Expand one cron field into the set of values it matches. Raises ValueError on
    anything this parser does not understand, so the caller can fall back to watching
    the job every day rather than quietly watching it never."""
    out = set()
    for part in spec.split(","):
        step = 1
        if "/" in part:
            part, _, step_s = part.partition("/")
            step = int(step_s)
            if step < 1:
                raise ValueError(spec)
        if part == "*":
            a, b = lo, hi
        elif "-" in part:
            a_s, _, b_s = part.partition("-")
            a, b = int(a_s), int(b_s)
        else:
            a = b = int(part)
        if a < lo or b > hi or a > b:
            raise ValueError(spec)
        out.update(range(a, b + 1, step))
    if not out:
        raise ValueError(spec)
    return out


def _due_times(schedule, now, window_h=WINDOW_H, grace_min=GRACE_MIN):
    """Every minute in (now - window_h, now - grace_min] at which this schedule was due
    to fire. Returns None when the expression is not a five-field calendar schedule,
    which the caller treats as "watch it the old way".

    pg_cron on the spine evaluates schedules in UTC (cron.timezone = GMT and the server
    TimeZone = UTC, both checked 18 Sep 2026), so `now` must be UTC as well.
    """
    spec = _MACROS.get(schedule.strip().lower(), schedule).strip()
    fields = spec.split()
    if len(fields) != 5:
        return None          # pg_cron also accepts '30 seconds': not a calendar rule
    try:
        minute = _field(fields[0], 0, 59)
        hour = _field(fields[1], 0, 23)
        dom = _field(fields[2], 1, 31)
        month = _field(fields[3], 1, 12)
        dow = _field(fields[4], 0, 7)
    except ValueError:
        return None
    if 7 in dow:
        dow = (dow - {7}) | {0}          # cron takes both 0 and 7 for Sunday
    dom_any = fields[2].strip() == "*"
    dow_any = fields[4].strip() == "*"

    end = (now - dt.timedelta(minutes=grace_min)).replace(second=0, microsecond=0)
    start = now - dt.timedelta(hours=window_h)
    out, t = [], end
    while t > start:
        if t.minute in minute and t.hour in hour and t.month in month:
            day_ok = t.day in dom
            week_ok = (t.weekday() + 1) % 7 in dow      # cron counts Sunday as 0
            # Vixie rule: day-of-month and day-of-week are OR'd when both are
            # restricted, AND'd when either one is '*'.
            if (day_ok and week_ok) if (dom_any or dow_any) else (day_ok or week_ok):
                out.append(t)
        t -= dt.timedelta(minutes=1)
    return out


def _late(jobs, window_h=WINDOW_H):
    """Of (jobname, schedule, last_run, now) rows, the ones that were due inside the
    window and have no run to show for it. A job that was not due is skipped."""
    out = []
    for name, schedule, last_run, now in jobs:
        due = _due_times(schedule, now, window_h)
        if due is None:
            # Not a calendar schedule, so it runs far more often than daily: keep the
            # old rule and insist on a run somewhere inside the window.
            expected = now - dt.timedelta(hours=window_h)
        elif due:
            expected = max(due)
        else:
            continue          # not due in this window at all: monthly, weekly, yearly
        if last_run is None or last_run < expected - dt.timedelta(minutes=1):
            out.append((name, schedule, expected, last_run))
    return out


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
    conn = psycopg2.connect(os.environ["SPINE_DATABASE_URL"], connect_timeout=30, keepalives=1, keepalives_idle=30, keepalives_interval=10, keepalives_count=5)
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
                select j.jobname, j.schedule,
                       (select max(d.start_time) from cron.job_run_details d
                         where d.jobid = j.jobid),
                       now()
                from cron.job j
                where j.active
                order by j.jobname
                """)
            jobs = cur.fetchall()
            cur.execute(
                """
                select count(*) from cron.job_run_details
                where start_time > now() - interval '%s hours'
                """ % WINDOW_H)
            total = cur.fetchone()[0]
    finally:
        conn.close()

    missing = _late(jobs)

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
        for name, schedule, expected, last_run in missing:
            seen = "never run" if last_run is None else f"last run {last_run:%Y-%m-%d %H:%M} UTC"
            lines.append(f"  {name}  (schedule: {schedule}, "
                         f"due {expected:%Y-%m-%d %H:%M} UTC, {seen})")
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
