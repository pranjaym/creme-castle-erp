#!/bin/bash
# Wrapper the macOS scheduler (launchd) calls each morning.
#
# Each run: refresh the code from GitHub, scrape yesterday's Petpooja reports, load
# and verify them into the spine, build the dashboard, archive it, and email it.
#
# IMPORTANT: this must live on the LOCAL disk, not in iCloud Drive. macOS refuses to
# let a launchd background agent execute anything under ~/Library/Mobile Documents
# ("Operation not permitted"), which is why the 8am job silently failed on 24 and 25
# July 2026. The runtime checkout is ~/creme-castle-erp.
#
# Paths are resolved relative to this script, so the same file works in any checkout.
# --allow-unmapped keeps the run alive if a new item lacks a glossary alias (it is
# flagged in the email instead of halting the morning).
set -o pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE" || exit 1

PYTHON="${CC_PYTHON:-/Library/Frameworks/Python.framework/Versions/3.14/bin/python3}"
[ -x "$PYTHON" ] || PYTHON="$(command -v python3)"

echo "===== run at $(date) =====" >> run.log

# Stay current with whatever has been pushed, so the scheduled run never drifts from
# the repo. Failure here is not fatal: yesterday's code is better than no run.
if command -v git >/dev/null 2>&1 && git -C "$HERE" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$HERE" pull --ff-only >> run.log 2>&1 || echo "git pull skipped/failed" >> run.log
fi

"$PYTHON" run_daily.py --allow-unmapped >> run.log 2>&1
echo "----- exit $? -----" >> run.log
