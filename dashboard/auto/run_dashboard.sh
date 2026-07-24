#!/bin/bash
# Wrapper the macOS scheduler (launchd) calls each morning. It cd's into the tool and
# runs the daily dashboard with the full Python path (launchd has a minimal PATH).
# Output is appended to run.log next to it. --allow-unmapped keeps the run alive if a
# new item lacks a glossary alias (it is flagged in the email instead of halting).
cd "/Users/Pranjay/Library/Mobile Documents/com~apple~CloudDocs/Downloads Drive/Claude Co Work Experiment V1/Sales Dashboard V5/auto" || exit 1
echo "===== run at $(date) =====" >> run.log
/Library/Frameworks/Python.framework/Versions/3.14/bin/python3 run_daily.py --allow-unmapped >> run.log 2>&1
echo "----- exit $? -----" >> run.log
