#!/usr/bin/env python3
"""Exercise the whole mailer end to end WITHOUT sending anything.

It runs main() with the SMTP connection replaced by a recorder, so every page
renders, every mail is assembled with its attachments, and the recipient list
is checked, but nothing leaves the machine. Run it after any change to
render.py or pages.py, and before the 07:30 job ever sees the change:

    python3 test_render.py            # the latest settled day
    CC_MAILER_DATE=2026-08-15 python3 test_render.py
"""
from __future__ import annotations
import os
import re
import sys

os.environ.pop("CC_MAILER_DRYRUN", None)
os.environ.pop("CC_MAILER_TEST", None)

import run_mailer as M


class FakeSMTP:
    sent = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def login(self, *a):
        pass

    def send_message(self, msg):
        FakeSMTP.sent.append(msg)


# A Python None that reached the page looks like one of these. The bare word
# "None." is NOT one: that is the deliberate empty state of a folded list, the
# same text the portal shows.
LEAKS = [">None<", "None%", "&#8377;None", "None min", "None sec", "None of",
         "nan", "undefined", "&amp;middot;", "&amp;rsquo;", "&amp;#8377;"]


def main():
    M.smtp_connect = lambda host, port: FakeSMTP()
    rc = M.main()
    if rc != 0:
        print(f"main() returned {rc}, expected 0")
        return 1

    sent = FakeSMTP.sent
    subjects = [m["Subject"] for m in sent]
    n_store = len([s for s in subjects if s.startswith("Store Daily")])
    n_area = len([s for s in subjects if s.startswith("Area Daily")])
    n_net = len([s for s in subjects if s.startswith("Network Daily")])
    n_all = len([s for s in subjects if s.startswith("All store pages")])
    atts = sum(len([p for p in m.iter_attachments()]) for m in sent)

    problems = []
    if n_area != 5:
        problems.append(f"expected 5 area mails, got {n_area}")
    if n_net != 1 or n_all != 1:
        problems.append(f"expected 1 network + 1 all-stores mail, got {n_net} + {n_all}")
    if n_store < 35:
        problems.append(f"only {n_store} store mails")
    for m in sent:
        for part in m.iter_attachments():
            body = part.get_content()
            if "<html" not in body or "</html>" not in body:
                problems.append(f"{m['Subject']}: attachment {part.get_filename()} is not a whole page")
            for leak in LEAKS:
                if leak in body:
                    problems.append(f"{m['Subject']}: {part.get_filename()} contains {leak!r}")
            if body.count("<table") != body.count("</table>"):
                problems.append(f"{m['Subject']}: {part.get_filename()} has unbalanced tables")

    print(f"assembled {len(sent)} mails, {atts} attachments "
          f"({n_store} store, {n_area} area, {n_net} network, {n_all} all-stores). Nothing was sent.")
    if problems:
        print("PROBLEMS:")
        for p in problems:
            print("  -", p)
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
