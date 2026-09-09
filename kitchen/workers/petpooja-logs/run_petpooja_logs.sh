#!/bin/bash
# Wrapper launchd calls for the Petpooja witness logs pull
# (in.cremecastle.petpooja-logs.plist: 09:30, 10:30, 12:00 and 15:00,
# after the 8am dashboard mail has gone out, so this can never delay it). Same five
# defences as the sibling zomato wrappers, same reasons:
#   1. success stamp: later slots exit in milliseconds once a slot delivered
#   2. lock: overlapping slots cannot double-pull
#   3. network gate: a dark wake defers instead of burning the slot
#   4. honest exit code: launchd sees the truth (alerting lives in run_daily.py)
#   5. caffeinate hold: the Mac cannot sleep mid-pull
#
# run_daily.py exits 75 to DEFER (mail not arrived, or a transport blip).
# A deferral writes no stamp and raises no alert; the next slot retries.
# The MTD file restates the whole month, so a fully missed day self-heals on
# the next successful load.
#
# Must live on the LOCAL disk (launchd cannot execute from iCloud Drive).
# Pass --force to run even if today already succeeded.
set -o pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE" || exit 1

PYTHON="${CC_PYTHON:-/Library/Frameworks/Python.framework/Versions/3.14/bin/python3}"
[ -x "$PYTHON" ] || PYTHON="$(command -v python3)"

TODAY="$(date +%Y-%m-%d)"
LOG="$HERE/run.log"
STAMP="$HERE/.last_success"
LOCK="$HERE/.run.lock"

log() { echo "$*" >> "$LOG"; }

if [ "$1" != "--force" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$TODAY" ]; then
  exit 0
fi

if ! mkdir "$LOCK" 2>/dev/null; then
  lock_pid="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
    log "===== slot at $(date): skipped, run already in progress (pid $lock_pid) ====="
    exit 0
  fi
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +45 2>/dev/null)" ]; then
    log "===== slot at $(date): clearing stale lock (no live pid, older than 45 min) ====="
    rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || exit 0
  else
    log "===== slot at $(date): skipped, lock held and too recent to reclaim ====="
    exit 0
  fi
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"; [ -n "$CAFFEINATE_PID" ] && kill "$CAFFEINATE_PID" 2>/dev/null' EXIT

log "===== petpooja-logs slot at $(date) ====="

# Network gate: attempts, not wall clock, so an asleep Mac defers rather than loops.
ENVFILE="$HERE/../../.env.local"
NET_HOST="${CC_NET_PROBE_HOST:-$(sed -n 's#^SPINE_SUPABASE_URL=[[:space:]]*https\{0,1\}://##p' "$ENVFILE" 2>/dev/null | head -1 | tr -d '/\r"'"'"' ')}"
[ -n "$NET_HOST" ] || NET_HOST="github.com"
NET_TRIES="${CC_NET_TRIES:-30}"
NET_SLEEP="${CC_NET_SLEEP:-20}"

net_up() { curl -sS -o /dev/null --max-time 8 "https://$NET_HOST" >/dev/null 2>&1; }

tries="$NET_TRIES"
until net_up; do
  tries=$((tries - 1))
  if [ "$tries" -le 0 ]; then
    log "no network after $NET_TRIES tries (probe host: $NET_HOST); deferring."
    log "----- exit 75 (deferred, no network) -----"
    exit 75
  fi
  sleep "$NET_SLEEP"
done

if [ -z "$CC_NO_CAFFEINATE" ] && command -v caffeinate >/dev/null 2>&1; then
  caffeinate -imsw $$ &
  CAFFEINATE_PID=$!
  log "caffeinate holding the Mac awake (pid $CAFFEINATE_PID)"
fi

if command -v git >/dev/null 2>&1 && git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$HERE" pull --ff-only >> "$LOG" 2>&1 || log "git pull skipped/failed"
fi

# F47 (10 Sep 2026): a hard wall-clock cap. A stalled database socket used to hang
# a run for 4.5 hours, and launchd will not start a second instance of a label,
# so one hung run silently ate every later slot. macOS ships no timeout(1), so
# a watchdog subshell kills the run after CC_WALL_CAP seconds (default 40 min);
# the exit is non-zero, no stamp is written, and the next slot retries.
WALL_CAP="${CC_WALL_CAP:-2400}"
"$PYTHON" run_daily.py >> "$LOG" 2>&1 &
RUN_PID=$!
( sleep "$WALL_CAP"; if kill -0 "$RUN_PID" 2>/dev/null; then
    echo "wall-clock cap of ${WALL_CAP}s hit at $(date): killing run (pid $RUN_PID)" >> "$LOG"
    kill "$RUN_PID" 2>/dev/null; sleep 15; kill -9 "$RUN_PID" 2>/dev/null; fi ) &
WATCHDOG=$!
wait "$RUN_PID"
status=$?
kill "$WATCHDOG" 2>/dev/null
log "----- exit $status -----"

if [ "$status" -eq 0 ]; then
  echo "$TODAY" > "$STAMP"
fi
exit $status
