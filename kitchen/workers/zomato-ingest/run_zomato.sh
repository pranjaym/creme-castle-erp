#!/bin/bash
# Wrapper launchd calls for the evening Zomato pull (in.cremecastle.zomato.plist,
# slots 18:00 / 18:20 / 20:00 / 22:00). Same five defences as the morning
# dashboard wrapper (dashboard/auto/run_dashboard.sh), same reasons:
#   1. success stamp: later slots exit in milliseconds once the evening delivered
#   2. lock: overlapping slots cannot double-pull
#   3. network gate: a dark wake defers instead of burning the slot
#   4. honest exit code: launchd sees the truth (alerting lives in run_evening.py)
#   5. caffeinate hold: the Mac cannot sleep mid-pull
#
# One contract beyond the dashboard wrapper: run_evening.py exits 75 to DEFER
# (Zomato's data not materialised yet, F16, or no session bootstrapped yet). A
# deferral writes no stamp and raises no alert; the next slot simply tries again,
# and after the last slot the 8 am D-2 catch-up in run_daily.py covers the gap.
#
# Must live on the LOCAL disk (launchd cannot execute from iCloud Drive).
# Pass --force to run even if this evening already succeeded.
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

log "===== zomato slot at $(date) ====="

# Network gate: probe the Supabase host from the shared .env (attempts, not wall
# clock, for the same asleep-loop reason as the dashboard wrapper).
ENVFILE="$HERE/../../../dashboard/auto/.env"
NET_HOST="${CC_NET_PROBE_HOST:-$(sed -n 's#^SPINE_SUPABASE_URL=[[:space:]]*https\{0,1\}://##p' "$ENVFILE" 2>/dev/null | head -1 | tr -d '/\r"'"'"' ')}"
[ -n "$NET_HOST" ] || NET_HOST="github.com"
NET_TRIES="${CC_NET_TRIES:-30}"
NET_SLEEP="${CC_NET_SLEEP:-20}"

net_up() { curl -sS -o /dev/null --max-time 8 "https://$NET_HOST" >/dev/null 2>&1; }

tries="$NET_TRIES"
until net_up; do
  tries=$((tries - 1))
  if [ "$tries" -le 0 ]; then
    log "no network after $NET_TRIES tries (probe host: $NET_HOST); deferring to the next slot."
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

"$PYTHON" run_evening.py >> "$LOG" 2>&1
status=$?
log "----- exit $status -----"

if [ "$status" -eq 0 ]; then
  echo "$TODAY" > "$STAMP"
fi
# 75 = deferred (data lag or no session): no stamp, no alert, next slot retries.
# Other non-zero: run_evening.py already sent the once-per-day owner alert.
exit $status
