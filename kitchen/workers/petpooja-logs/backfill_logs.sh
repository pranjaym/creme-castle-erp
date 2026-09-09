#!/bin/bash
# One-off backfill of the two Petpooja logs, one day per run so each day commits on its own
# (F21: never one giant transaction from a laptop). Usage: bash backfill_logs.sh 2026-08-01 2026-09-07
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; cd "$HERE" || exit 1
d="$1"; end="$2"; LOG="$HERE/backfill.log"
while [ "$d" != "$(date -j -v+1d -f %Y-%m-%d "$end" +%Y-%m-%d)" ]; do
  echo "===== backfill day $d at $(date) =====" >> "$LOG"
  python3 run_daily.py --no-activity --from "$d" --to "$d" >> "$LOG" 2>&1
  echo "----- exit $? -----" >> "$LOG"
  d="$(date -j -v+1d -f %Y-%m-%d "$d" +%Y-%m-%d)"
done
echo "===== backfill finished at $(date) =====" >> "$LOG"
