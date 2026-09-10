#!/bin/bash
# One-off backfill of the two Petpooja logs, one day per run so each day commits on
# its own (F21: never one giant transaction from a laptop).
#
#   bash backfill_logs.sh 2026-08-01 2026-09-07
#
# Rules learned the hard way on 9/10 Sep 2026:
#   * NO owner mails. A 38-day loop that mails per failing day sent 17 overnight
#     (CC_NO_ALERT=1). The summary at the end of this log is the report.
#   * A day that fails is RETRIED twice with a pause, because the usual cause is
#     the laptop's network dropping, not the data.
#   * A day already loaded is skipped, so re-running this after a bad night only
#     picks up what is missing.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE" || exit 1
export CC_NO_ALERT=1
d="$1"; end="$2"; LOG="$HERE/backfill.log"
PYTHON="${CC_PYTHON:-/Library/Frameworks/Python.framework/Versions/3.14/bin/python3}"
[ -x "$PYTHON" ] || PYTHON="$(command -v python3)"
ok=0; failed=0; skipped=0; failed_days=""

loaded_already() {   # a day is done when the store log already holds rows for it
  "$PYTHON" - "$1" <<'PY' 2>/dev/null
import sys, os
sys.path.insert(0, os.getcwd())
import load as L
L.load_env_file(os.path.join(os.getcwd(), "..", "..", ".env.local"))
c = L.connect(); cur = c.cursor()
cur.execute("select count(*) from landing.petpooja_store_status_log "
            "where superseded_at is null and business_date = %s", (sys.argv[1],))
n = cur.fetchone()[0]; c.close()
raise SystemExit(0 if n > 0 else 1)
PY
}

while [ "$d" != "$(date -j -v+1d -f %Y-%m-%d "$end" +%Y-%m-%d)" ]; do
  if loaded_already "$d"; then
    echo "===== $d already loaded, skipping =====" >> "$LOG"; skipped=$((skipped+1))
  else
    status=1
    for attempt in 1 2 3; do
      echo "===== backfill day $d (attempt $attempt) at $(date) =====" >> "$LOG"
      "$PYTHON" run_daily.py --no-activity --from "$d" --to "$d" >> "$LOG" 2>&1
      status=$?
      echo "----- exit $status -----" >> "$LOG"
      [ "$status" -eq 0 ] && break
      echo "retrying $d in 120s (network is the usual cause)" >> "$LOG"; sleep 120
    done
    if [ "$status" -eq 0 ]; then ok=$((ok+1)); else failed=$((failed+1)); failed_days="$failed_days $d"; fi
  fi
  d="$(date -j -v+1d -f %Y-%m-%d "$d" +%Y-%m-%d)"
done
echo "===== backfill finished at $(date): $ok loaded, $skipped already there, $failed failed =====" >> "$LOG"
[ -n "$failed_days" ] && echo "      days still missing:$failed_days" >> "$LOG"
