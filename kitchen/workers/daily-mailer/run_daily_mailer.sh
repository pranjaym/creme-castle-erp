#!/bin/bash
# Wrapper for the 7:30 daily dashboard mailer (in.cremecastle.daily-mailer.plist,
# slots 07:30 / 08:00 / 08:45). House defences (F14/F28 checklist):
#   1. success stamp   2. lock   3. network gate   4. honest exit codes
#   5. caffeinate hold. run_mailer.py exits 75 to defer (silent, next slot
#   retries) and alerts the owner itself on a last-slot hard failure.
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

if [ "$1" != "--force" ] && [ "$(cat "$STAMP" 2>/dev/null)" = "$TODAY" ]; then exit 0; fi

if ! mkdir "$LOCK" 2>/dev/null; then
  lock_pid="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
    log "===== slot at $(date): skipped, run in progress (pid $lock_pid) ====="; exit 0
  fi
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    log "===== slot at $(date): clearing stale lock ====="; rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || exit 0
  else
    log "===== slot at $(date): skipped, lock held ====="; exit 0
  fi
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"; [ -n "$CAFFEINATE_PID" ] && kill "$CAFFEINATE_PID" 2>/dev/null' EXIT

log "===== daily-mailer slot at $(date) ====="
NET_HOST="smtp.gmail.com"
tries=20
until curl -sS -o /dev/null --max-time 8 "https://www.google.com" >/dev/null 2>&1; do
  tries=$((tries - 1))
  [ "$tries" -le 0 ] && { log "no network; deferring"; log "----- exit 75 -----"; exit 75; }
  sleep 15
done
if [ -z "$CC_NO_CAFFEINATE" ] && command -v caffeinate >/dev/null 2>&1; then
  caffeinate -imsw $$ & CAFFEINATE_PID=$!
fi
if command -v git >/dev/null 2>&1 && git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$HERE" pull --ff-only >> "$LOG" 2>&1 || log "git pull skipped/failed"
fi

"$PYTHON" run_mailer.py >> "$LOG" 2>&1
status=$?
log "----- exit $status -----"
if [ "$status" -eq 0 ]; then echo "$TODAY" > "$STAMP"; fi
exit $status
