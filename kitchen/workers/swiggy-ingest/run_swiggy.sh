#!/bin/bash
# Wrapper launchd calls for the Swiggy Daily-MTD pull
# (in.cremecastle.swiggy.plist: 14:00, 18:00, 21:30 and a 07:15 catch-up,
# because the mail's arrival time swings 10:30 to 20:45 IST). Same five
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

log "===== swiggy slot at $(date) ====="

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

"$PYTHON" run_daily.py >> "$LOG" 2>&1
status=$?
log "----- exit $status -----"

if [ "$status" -eq 0 ]; then
  echo "$TODAY" > "$STAMP"
fi
exit $status
