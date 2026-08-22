#!/bin/bash
# Wrapper launchd calls for the evening ratings mail (in.cremecastle.ratings.plist,
# slots 19:00 / 19:30 / 21:00 / 22:30). Same five defences as the Zomato pull
# wrapper (workers/zomato-ingest/run_zomato.sh), same reasons:
#   1. success stamp: later slots exit in milliseconds once the mail went out
#   2. lock: overlapping slots cannot double-send
#   3. network gate: a dark wake defers instead of burning the slot
#   4. honest exit code: launchd sees the truth
#   5. caffeinate hold: the Mac cannot sleep mid-send
#
# Ordering contract: this MUST run after the 18:00 Zomato pull has landed
# yesterday. run.py --defer-if-stale exits 75 when the spine's newest day is not
# yesterday, so an early slot waits rather than mailing a stale day. The LAST
# slot drops that flag and mails whatever the newest day is, so a bad Zomato
# evening still produces a report rather than silence.
#
# Must live on the LOCAL disk (launchd cannot execute from iCloud Drive), and the
# outlet glossary is read from outlets.json for the same reason.
# Pass --force to run even if this evening already sent.
set -o pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE" || exit 1

PYTHON="${CC_PYTHON:-/Library/Frameworks/Python.framework/Versions/3.14/bin/python3}"
[ -x "$PYTHON" ] || PYTHON="$(command -v python3)"

TODAY="$(date +%Y-%m-%d)"
HOUR="$(date +%H)"
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
    log "===== slot at $(date): skipped, send already in progress (pid $lock_pid) ====="
    exit 0
  fi
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    log "===== slot at $(date): clearing stale lock ====="
    rm -rf "$LOCK"; mkdir "$LOCK" 2>/dev/null || exit 0
  else
    log "===== slot at $(date): skipped, lock held and too recent to reclaim ====="
    exit 0
  fi
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"; [ -n "$CAFFEINATE_PID" ] && kill "$CAFFEINATE_PID" 2>/dev/null' EXIT

log "===== ratings slot at $(date) ====="

ENVFILE="$HERE/../../../dashboard/auto/.env"
NET_HOST="${CC_NET_PROBE_HOST:-$(sed -n 's#^SPINE_SUPABASE_URL=[[:space:]]*https\{0,1\}://##p' "$ENVFILE" 2>/dev/null | head -1 | tr -d '/\r"'"'"' ')}"
[ -n "$NET_HOST" ] || NET_HOST="github.com"
NET_TRIES="${CC_NET_TRIES:-30}"; NET_SLEEP="${CC_NET_SLEEP:-20}"
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
  caffeinate -imsw $$ & CAFFEINATE_PID=$!
  log "caffeinate holding the Mac awake (pid $CAFFEINATE_PID)"
fi

if command -v git >/dev/null 2>&1 && git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$HERE" pull --ff-only >> "$LOG" 2>&1 || log "git pull skipped/failed"
fi

# Last slot (22:00 onwards) sends whatever the newest day is rather than deferring.
FRESH="--defer-if-stale"
if [ "$HOUR" -ge 22 ]; then
  FRESH=""
  log "last slot: sending the newest available day even if yesterday never landed."
fi

# CC_RATINGS_RECIPIENTS_FILE overrides the recipient list (used for safe end-to-end
# tests without mailing the whole team). Unset in normal operation.
RECIP=""
[ -n "$CC_RATINGS_RECIPIENTS_FILE" ] && RECIP="--recipients $CC_RATINGS_RECIPIENTS_FILE"
"$PYTHON" run.py --send $FRESH $RECIP >> "$LOG" 2>&1
status=$?
log "----- exit $status -----"
[ "$status" -eq 0 ] && echo "$TODAY" > "$STAMP"
exit $status
