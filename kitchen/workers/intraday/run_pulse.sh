#!/bin/bash
# The hourly wrapper for the intraday pulse. Everything the plain python script does
# not do: keep out of the morning job's way, hold the Mac awake, keep a log, keep the
# latest report where a human (or Claude) can read it instantly, and stay QUIET about
# a single failed hour while still speaking up when the feed has actually gone dark.
#
# Built 28 August 2026 (Raksha Bandhan). Run it by hand any time:
#     ~/creme-castle-erp/kitchen/workers/intraday/run_pulse.sh
#
# Alerting posture, and it is deliberately different from the daily jobs. A daily job
# that fails has lost the day. An hourly job that fails has lost an hour and the next
# slot heals it, so one failure must NOT raise an alarm (F23). The alarm here is not
# "a run failed", it is "the newest data is more than STALE_MINUTES old while the
# shops are trading", which is the thing that actually costs Pranjay something.

set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
# The same interpreter the other workers use. /usr/bin/python3 is Apple's and has
# none of the packages, so naming it explicitly is not optional.
PYTHON="${PULSE_PYTHON:-/Library/Frameworks/Python.framework/Versions/3.14/bin/python3}"
[ -x "$PYTHON" ] || PYTHON="$(command -v python3)"
LOG="$HERE/pulse.log"
LATEST="$HERE/latest.txt"
STAMP="$HERE/.last_success"
LOCK="$HERE/.run.lock"
DASH_LOCK="$REPO/dashboard/auto/.run.lock"

# Trading hours in IST. Outside these the shops are shut, so a stale feed is correct
# and must not alarm. 07:00 is the earliest order seen; 02:00 is the last.
OPEN_HOUR="${PULSE_OPEN_HOUR:-7}"
CLOSE_HOUR="${PULSE_CLOSE_HOUR:-2}"
STALE_MINUTES="${PULSE_STALE_MINUTES:-150}"

log() { echo "$@" | tee -a "$LOG"; }

hour=$(date +%-H)
in_hours() {
  if [ "$OPEN_HOUR" -le "$CLOSE_HOUR" ]; then
    [ "$hour" -ge "$OPEN_HOUR" ] && [ "$hour" -le "$CLOSE_HOUR" ]
  else   # the window wraps past midnight
    [ "$hour" -ge "$OPEN_HOUR" ] || [ "$hour" -le "$CLOSE_HOUR" ]
  fi
}

if ! in_hours; then
  log "===== slot at $(date): outside trading hours (${OPEN_HOUR}:00 to ${CLOSE_HOUR}:59), skipped ====="
  exit 0
fi

# The morning dashboard job drives the SAME Petpooja session through the same
# browser. Two of them at once is how a saved session gets corrupted, so the pulse
# always yields to it. It loses one hour and picks up at the next slot.
if [ -d "$DASH_LOCK" ]; then
  dash_pid="$(cat "$DASH_LOCK/pid" 2>/dev/null)"
  if [ -n "$dash_pid" ] && kill -0 "$dash_pid" 2>/dev/null; then
    log "===== slot at $(date): the morning dashboard job is running (pid $dash_pid), yielding ====="
    exit 0
  fi
fi

# Our own lock, so a slow hour cannot be overtaken by the next slot.
if ! mkdir "$LOCK" 2>/dev/null; then
  lock_pid="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
    log "===== slot at $(date): previous pulse still running (pid $lock_pid), skipped ====="
    exit 0
  fi
  # No live pid: a killed run or a reboot mid-run. A pulse takes well under a minute,
  # so anything older than 15 minutes is certainly dead.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
    log "===== slot at $(date): clearing a stale lock ====="
    rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
echo $$ > "$LOCK/pid"
CAFFEINATE_PID=""
trap 'rm -rf "$LOCK"; [ -n "$CAFFEINATE_PID" ] && kill "$CAFFEINATE_PID" 2>/dev/null' EXIT

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -imsw $$ & CAFFEINATE_PID=$!
fi

log "===== pulse at $(date) ====="
cd "$HERE" || exit 1
OUT="$("$PYTHON" run_pulse.py ${PULSE_ARGS:-} 2>&1)"
rc=$?
echo "$OUT" >> "$LOG"

if [ $rc -eq 0 ]; then
  date +%Y-%m-%dT%H:%M >"$STAMP"
  # The report as a plain file, so the latest picture is one `cat` away and does not
  # need the database, a browser or a scrape to read.
  printf '%s\n' "$OUT" | sed -n '/CREME CASTLE, INTRADAY PULSE/,$p' >"$LATEST"
  # The HTML dashboard, in the CC Spot Check's own format. Best effort and always
  # AFTER the stamp: a rendering problem must never make a successful pull look
  # like a failed one, and latest.txt already carries the same numbers.
  if "$PYTHON" render_pulse.py >>"$LOG" 2>&1; then
    log "dashboard rendered -> pulse_dashboard.html"
  else
    log "dashboard render failed (the pull itself was fine; read latest.txt)"
  fi
  log "pulse ok."
elif [ $rc -eq 75 ]; then
  log "pulse deferred on transport; the next slot heals it. Not alerting (F23)."
else
  log "pulse FAILED hard (exit $rc)."
fi

# The only thing worth waking a person for: the feed has actually gone dark. Judged
# on the age of the last SUCCESS, never on this one run, so a single flap is silent
# and a genuinely dead feed is not.
if [ -f "$STAMP" ]; then
  last_epoch=$(date -j -f "%Y-%m-%dT%H:%M" "$(cat "$STAMP")" +%s 2>/dev/null || echo 0)
  now_epoch=$(date +%s)
  age=$(( (now_epoch - last_epoch) / 60 ))
  # Staleness is counted in TRADING minutes, not wall clock. 29 Aug 2026: a failure
  # at 02:05 plus the 07:05 slot failing produced "gone dark for 365 minutes", of
  # which four hours were the closed window 03:00 to 06:59 when this job does not
  # even run. Wall clock therefore turns any late-night blip into an alarming
  # six-hour number the next morning, every time. Only the hours the shops trade
  # count towards being dark.
  closed_h=$(( CLOSE_HOUR >= OPEN_HOUR ? 0 : OPEN_HOUR - CLOSE_HOUR - 1 ))
  trading_age="$age"
  if [ "$closed_h" -gt 0 ] && [ "$age" -gt $(( closed_h * 60 )) ]; then
    last_h=$(date -j -f "%s" "$last_epoch" +%-H 2>/dev/null || echo 0)
    # The overnight gap is only crossed if the last success was before it started.
    if [ "$last_h" -le "$CLOSE_HOUR" ] || [ "$last_h" -ge "$OPEN_HOUR" ]; then
      trading_age=$(( age - closed_h * 60 ))
      [ "$trading_age" -lt 0 ] && trading_age=0
    fi
  fi
  if [ "$last_epoch" -gt 0 ] && [ "$trading_age" -gt "$STALE_MINUTES" ]; then
    age="$trading_age"
    log "STALE: the last successful pulse was ${age} minutes ago (limit ${STALE_MINUTES})."
    "$PYTHON" - "$age" <<'PY' >>"$LOG" 2>&1 || log "stale alert could not be sent"
import sys, os
sys.path.insert(0, os.path.expanduser("~/creme-castle-erp/dashboard/auto"))
os.chdir(os.path.expanduser("~/creme-castle-erp/dashboard/auto"))
import alert_failure
age = sys.argv[1]
# include_log_tail=False on purpose: alert_failure defaults to attaching the DAILY
# DASHBOARD's run.log, which for a pulse alarm is a completely unrelated file. On
# 29 Aug 2026 that shipped 60 lines about yesterday's 08:00 dashboard run to explain
# a pulse outage, and cost real time in diagnosis. The pulse's own log goes in below.
def _tail(path, n=25):
    try:
        return "".join(open(path, encoding="utf-8", errors="replace").readlines()[-n:])
    except Exception as e:
        return f"(could not read {path}: {e})"
PULSE_LOG = os.path.expanduser("~/creme-castle-erp/kitchen/workers/intraday/pulse.log")
alert_failure.send_alert(
    f"CC intraday pulse has gone dark ({age} min)",
    "The hourly sales pulse has not completed successfully for "
    f"{age} minutes while the shops are trading.\n\n"
    "The last good picture is still readable and is that old:\n"
    "  cat ~/creme-castle-erp/kitchen/workers/intraday/latest.txt\n\n"
    "To see what is wrong, run one by hand:\n"
    "  ~/creme-castle-erp/kitchen/workers/intraday/run_pulse.sh\n\n"
    "The most likely cause by far is an expired Petpooja login, which only a hand "
    "OTP re-login fixes (F24):\n"
    "  cd ~/creme-castle-erp/kitchen/workers/petpooja-ingest && python3 scrape.py bootstrap\n\n"
    "Nothing is lost either way: this feed is a live view, and the settled record of "
    "today still arrives in the spine through the normal 08:00 job tomorrow.")
PY
  fi
fi

# Keep the log from growing without bound over a long festival day.
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 5000000 ]; then
  tail -c 2000000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
exit 0
