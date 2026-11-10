"""SupplyNote Data API client (read-only). Facts: erp-plan/supplynote-api-notes.md.

Base URL is reporting-api.supplynote.in (their documents say api.supplynote.in,
which does not resolve). Keyset paging: pass meta.next_cursor back as cursor and
keep every other parameter identical. 1000 rows a page at most.

Transport is curl, on purpose: Python's urllib has no CA bundle on this Mac.
The key is handed to curl on stdin, so it never appears in the process list.
"""
from __future__ import annotations
import json
import subprocess
import time
import urllib.parse

BASE = "https://reporting-api.supplynote.in"
PAGE = 1000
PAUSE = 1.1          # 60 requests a minute on the standard tier


class Transport(Exception):
    """Network or server trouble that a later slot can heal (defer, no alert)."""


class Contract(Exception):
    """The API answered, but not in the shape we rely on (real failure)."""


def _get(key: str, path: str, params: dict, timeout: int = 120) -> dict:
    url = f"{BASE}{path}?{urllib.parse.urlencode(params)}"
    cfg = f'header = "X-API-Key: {key}"\nurl = "{url}"\n'
    last = None
    for attempt in range(3):
        r = subprocess.run(["curl", "-sS", "--max-time", str(timeout), "-w", "\n%{http_code}", "--config", "-"],
                           input=cfg, capture_output=True, text=True)
        if r.returncode != 0:
            last = Transport(f"curl exit {r.returncode}: {r.stderr.strip()[:200]}")
        else:
            body, _, code = r.stdout.rpartition("\n")
            if code.startswith("5") or code == "429":
                last = Transport(f"HTTP {code} from SupplyNote: {body[:200]}")
            elif code != "200":
                raise Contract(f"HTTP {code} on {path}: {body[:300]}")
            else:
                try:
                    j = json.loads(body)
                except ValueError:
                    raise Contract(f"non-JSON answer on {path}: {body[:200]}")
                if "data" not in j:
                    raise Contract(f"no data key on {path}: {body[:300]}")
                return j
        time.sleep(5 * (attempt + 1))
    raise last


def pull(key: str, dataset: str, log=print, **params) -> list:
    """Every row of one dataset for the given filters."""
    rows, cursor, pages = [], None, 0
    while True:
        q = dict(params, limit=PAGE)
        if cursor:
            q["cursor"] = cursor
        j = _get(key, f"/v2/data/{dataset}", q)
        rows += j["data"]
        pages += 1
        cursor = (j.get("meta") or {}).get("next_cursor")
        if not cursor:
            break
        time.sleep(PAUSE)
    log(f"  api {dataset}: {len(rows):,} rows in {pages} page(s)")
    return rows
