#!/bin/bash
# Wrapper launchd calls for the SupplyNote pull (inventory module).
# (in.cremecastle.supplynote.plist: 06:45 and 07:30 for the morning reading,
# 21:30, 22:30 and 23:15 for the closing reading after the day's entries.)
# The Swiggy wrapper with the name changed, and one difference: the success
# stamp is per HALF DAY, because this job must land twice a day (a morning
# reading for the day's order list, a closing reading for the stock history).
# Same five defences as the sibling wrappers, same reasons:
#   1. success stamp: later slots of the half day exit in milliseconds
#   2. lock: overlapping slots cannot double-pull
#   3. network gate: a dark wake defers instead of burning the slot
#   4. honest exit code: launchd sees the truth (alerting lives in run_daily.py)
#   5. caffeinate hold: the Mac cannot sleep mid-pull
#
# run_daily.py exits 75 to DEFER (transport trouble). A deferral writes no
# stamp and raises no alert; the next slot retries.
#
# Must live on the LOCAL disk (launchd cannot execute from iCloud Drive).
# Pass --force to run even if this half day already succeeded.
set -o pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE" || exit 1

PYTHON="${CC_PYTHON:-/Library/Frameworks/Python.framework/Versions/3.14/bin/python3}"
[ -x "$PYTHON" ] || PYTHON="$(command -v python3)"

HALF="am"
[ "$(date +%H)" -ge 12 ] && HALF="pm"
TODAY="$(date +%Y-%m-%d)-$HALF"
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

log "===== supplynote slot at $(date) ====="

# Network gate: attempts, not wall clock, so an asleep Mac defers rather than loops.
NET_HOST="${CC_NET_PROBE_HOST:-reporting-api.supplynote.in}"
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

# F47: a hard wall-clock cap. macOS ships no timeout(1), so a watchdog subshell
# kills the run after CC_WALL_CAP seconds (default 40 min); the exit is
# non-zero, no stamp is written, and the next slot retries.
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
