#!/bin/bash
# Wrapper the macOS scheduler (launchd) calls each morning.
#
# Each run: wait for the network, refresh the code from GitHub, scrape yesterday's
# Petpooja reports, load and verify them into the spine, build the dashboard, archive
# it, and email it.
#
# IMPORTANT: this must live on the LOCAL disk, not in iCloud Drive. macOS refuses to
# let a launchd background agent execute anything under ~/Library/Mobile Documents
# ("Operation not permitted"), which is why the 8am job silently failed on 24 and 25
# July 2026. The runtime checkout is ~/creme-castle-erp.
#
# 30 July 2026 failure, and why this script now looks the way it does. The lid was
# shut at 07:45, so the Mac was asleep at 08:00 and launchd deferred the job. launchd
# gives a missed StartCalendarInterval exactly ONE catch-up firing, on the next wake
# of any kind, and it spent that firing on a 08:58 dark wake (a silent maintenance
# wake, lid still shut, Wi-Fi not yet associated). Every network call failed on DNS
# inside a few seconds, the run died, and because the old version of this script ended
# in an `echo` its exit status was the echo's, so launchd recorded SUCCESS. No email,
# no retry, no alert: the only symptom was an absence. Five defences below, in order:
#   1. a success stamp, so extra retry slots through the morning are free
#   2. a lock, so overlapping slots cannot double-scrape
#   3. a network gate, so a dark wake defers instead of burning the day's chance
#   4. the real exit code plus a failure alert, so a dead morning says so
#   5. a caffeinate hold, so the Mac cannot fall back asleep mid-run (added 31 July)
#
# 31 July 2026 failure, and why defence 5 exists. The 07:58 pmset wake fired but, on
# battery with the lid shut, produced only a DARK wake: 45 seconds awake, then straight
# back to sleep, so the 08:00/08:20/08:45 slots were all deferred. At 08:49 a maintenance
# dark wake finally ran the coalesced job; the network gate waited, Wi-Fi came up, and
# the scrape SUCCEEDED. Then ~90 seconds in, the Mac did what a dark wake always does
# next, it returned to sleep, and tore the network down underneath the run: the spine
# sync died on "No route to host" and the sub-order scrape on ERR_INTERNET_DISCONNECTED.
# The gate only guards the START of a run; nothing kept the machine awake THROUGH it.
# Defence 5 takes a power assertion the instant the gate passes, held until the run ends.
#
# Paths are resolved relative to this script, so the same file works in any checkout.
# --allow-unmapped keeps the run alive if a new item lacks a glossary alias (it is
# flagged in the email instead of halting the morning).
#
# Pass --force to run even if today already succeeded (for manual re-runs).
set -o pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE" || exit 1

PYTHON="${CC_PYTHON:-/Library/Frameworks/Python.framework/Versions/3.14/bin/python3}"
[ -x "$PYTHON" ] || PYTHON="$(command -v python3)"

TODAY="$(date +%Y-%m-%d)"
LOG="$HERE/run.log"
STAMP="$HERE/.last_success"
ALERT_STAMP="$HERE/.last_alert"
LOCK="$HERE/.run.lock"

log() { echo "$*" >> "$LOG"; }

# 1. Already delivered today? Then this is one of the later retry slots with nothing
# to do. Exit quietly: no log noise, so run.log keeps one entry per real morning.
if [ "$1" != "--force" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$TODAY" ]; then
  exit 0
fi

# 2. One run at a time. The retry slots are close together and a scrape takes minutes,
# so without this a slow 08:00 run and the 08:20 slot would both scrape and both email.
if ! mkdir "$LOCK" 2>/dev/null; then
  lock_pid="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
    log "===== slot at $(date): skipped, run already in progress (pid $lock_pid) ====="
    exit 0
  fi
  # A lock with no live pid is ambiguous: either a genuinely stale lock (run killed,
  # or the Mac rebooted mid-run), or a sibling slot that created its lock microseconds
  # ago and has not written its pid yet. Reclaim ONLY if it is demonstrably old, and
  # otherwise stand down. Getting this backwards means two runs and two emails, so the
  # bias is deliberately towards doing nothing.
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    log "===== slot at $(date): clearing stale lock (no live pid, older than 30 min) ====="
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || exit 0
  else
    log "===== slot at $(date): skipped, lock held and too recent to reclaim ====="
    exit 0
  fi
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"; [ -n "$CAFFEINATE_PID" ] && kill "$CAFFEINATE_PID" 2>/dev/null' EXIT

log "===== run at $(date) ====="

# 3. Do not touch anything until the network actually answers. This is the fix for
# 30 July: on a dark wake we now wait rather than fail.
#
# The budget is counted in ATTEMPTS, not wall clock, and that is deliberate. While the
# Mac is asleep this loop is frozen, so a wall-clock deadline would quietly expire
# during sleep and we would be back to the same bug. Attempts only tick while the
# machine is actually awake, so "30 attempts" means 30 real tries, spread across
# however many wakes it takes.
#
# Probe the Supabase host from .env: that is the dependency that actually failed, and
# reaching it proves DNS plus TLS plus egress, not just that a cable is plugged in.
# Any HTTP status counts as reachable (the bare origin answers 404, which is fine).
#
# CC_NET_PROBE_HOST, CC_NET_TRIES and CC_NET_SLEEP exist so this gate can be tested
# without waiting ten minutes or unplugging the Wi-Fi. Leave them unset in normal use.
NET_HOST="${CC_NET_PROBE_HOST:-$(sed -n 's#^SPINE_SUPABASE_URL=[[:space:]]*https\{0,1\}://##p' .env 2>/dev/null | head -1 | tr -d '/\r"'"'"' ')}"
[ -n "$NET_HOST" ] || NET_HOST="github.com"
NET_TRIES="${CC_NET_TRIES:-30}"
NET_SLEEP="${CC_NET_SLEEP:-20}"

net_up() { curl -sS -o /dev/null --max-time 8 "https://$NET_HOST" >/dev/null 2>&1; }

tries="$NET_TRIES"
until net_up; do
  tries=$((tries - 1))
  if [ "$tries" -le 0 ]; then
    log "no network after $NET_TRIES tries (probe host: $NET_HOST). Deferring to the next slot;"
    log "today's stamp is NOT written, so the next scheduled slot will pick this up."
    log "----- exit 75 (deferred, no network) -----"
    exit 75
  fi
  sleep "$NET_SLEEP"
done

# 5. Network is up, so we are committed to a real run. Hold the Mac awake for its whole
# duration. A scheduled slot usually fires during a DARK wake (lid shut, on battery),
# which by design lasts only seconds before the machine returns to sleep. On 31 July
# that return-to-sleep landed ~90s into the run and killed the network mid-scrape. An
# assertion taken NOW blocks it until this script exits.
#   -i  prevent idle system sleep (effective on battery, the case that bit us)
#   -m  prevent disk idle sleep
#   -s  prevent system sleep (an added guard, effective on AC power)
#   -w  tie the assertion's life to THIS script's pid, so it always releases, even if
#       the run is killed; the EXIT trap also kills it belt-and-braces.
# Placed AFTER the gate on purpose: a genuine no-network morning defers above without
# ever holding the machine awake, so a closed laptop with no Wi-Fi is not drained by
# eight slots each caffeinating for nothing. CC_NO_CAFFEINATE disables it for tests.
if [ -z "$CC_NO_CAFFEINATE" ] && command -v caffeinate >/dev/null 2>&1; then
  caffeinate -imsw $$ &
  CAFFEINATE_PID=$!
  log "caffeinate holding the Mac awake (pid $CAFFEINATE_PID) for the duration of this run"
fi

# Stay current with whatever has been pushed, so the scheduled run never drifts from
# the repo. Failure here is not fatal: yesterday's code is better than no run.
if command -v git >/dev/null 2>&1 && git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$HERE" pull --ff-only >> "$LOG" 2>&1 || log "git pull skipped/failed"
fi

"$PYTHON" run_daily.py --allow-unmapped >> "$LOG" 2>&1
status=$?
log "----- exit $status -----"

if [ "$status" -eq 0 ]; then
  echo "$TODAY" > "$STAMP"
else
  # 4. A real failure, not a no-network deferral: the network answered before we got
  # here, so an alert can actually be delivered. Once per day, so eight retry slots
  # cannot turn one broken morning into eight emails.
  if [ "$(cat "$ALERT_STAMP" 2>/dev/null)" != "$TODAY" ]; then
    if "$PYTHON" alert_failure.py "$status" >> "$LOG" 2>&1; then
      echo "$TODAY" > "$ALERT_STAMP"
    fi
  fi
fi

# Spine cron watch, added 23 Aug 2026 (automation audit): the database runs its own
# scheduled refreshes (pg_cron) and a failed one used to die in silence (the identity
# refresh did exactly that on 16 Aug). Check the last day of runs and mail the owner
# if any failed or went missing. Never fatal to the morning: the dashboard matters more.
"$PYTHON" check_spine_cron.py >> "$LOG" 2>&1 || log "spine cron check could not run"

# Hand launchd the truth, so `launchctl list` stops reporting 0 for a failed morning.
exit $status
